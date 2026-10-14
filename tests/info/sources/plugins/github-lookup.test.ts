// The GitHub plugin's lookup slot (docs/88): one repo's facts from three
// anonymous REST calls, and RepoLookups, the per-run counter that caps repos
// and stops when GitHub reports the quota spent. Scripted fetch. Run: bun test.

import { expect, test } from "bun:test";
import {
  GithubRateLimitError,
  lookupRepoFacts,
  repoHandle,
  RepoLookups,
} from "../../../../src/info/sources/plugins/github-lookup";
import { githubPlugin } from "../../../../src/info/sources/plugins/github";
import type { FetchFn } from "../../../../src/platform/app/host";

const REPO = {
  full_name: "openai/whisper",
  html_url: "https://github.com/openai/whisper",
  description: "Robust Speech Recognition via Large-Scale Weak Supervision",
  stargazers_count: 72000,
  forks_count: 8600,
  created_at: "2022-09-16T20:02:54Z",
  default_branch: "main",
  license: { key: "mit", name: "MIT License", spdx_id: "MIT" },
};
const COMMITS = [{ sha: "abc", commit: { committer: { date: "2026-06-26T17:39:21Z" }, author: { date: "2026-06-25T00:00:00Z" } } }];
const RELEASE = { tag_name: "v20250625", published_at: "2025-06-26T01:06:22Z" };

function json(body: unknown, status = 200, remaining: number | null = 50): Response {
  const headers: Record<string, string> = {};
  if (remaining !== null) headers["x-ratelimit-remaining"] = String(remaining);
  return new Response(JSON.stringify(body), { status, headers });
}

// Routes by path suffix; records every URL.
function scripted(routes: { repo?: Response | (() => Response); commits?: () => Response; release?: () => Response }): {
  fetchFn: FetchFn;
  urls: string[];
} {
  const urls: string[] = [];
  const fetchFn: FetchFn = async (url) => {
    urls.push(url);
    const path = new URL(url).pathname;
    if (path.endsWith("/releases/latest")) return routes.release ? routes.release() : json(RELEASE);
    if (path.endsWith("/commits")) return routes.commits ? routes.commits() : json(COMMITS);
    const r = routes.repo;
    return typeof r === "function" ? r() : r ?? json(REPO);
  };
  return { fetchFn, urls };
}

test("repoHandle reads owner/repo and any github.com link into a repo", () => {
  expect(repoHandle("openai/whisper")).toEqual({ owner: "openai", repo: "whisper" });
  expect(repoHandle("openai/whisper.git")).toEqual({ owner: "openai", repo: "whisper" });
  expect(repoHandle("https://github.com/openai/whisper/releases/tag/v1")).toEqual({ owner: "openai", repo: "whisper" });
  expect(repoHandle("https://github.com/topics/robotics")).toBeNull();
  expect(repoHandle("whisper")).toBeNull();
  expect(repoHandle("a/b/c")).toBeNull();
  expect(repoHandle("https://gitlab.com/a/b")).toBeNull();
});

test("a repo's facts come from /repos, the default branch's head commit and the latest release", async () => {
  const { fetchFn, urls } = scripted({});
  const facts = await lookupRepoFacts("openai/whisper", { fetchFn });
  expect(facts).toEqual({
    fullName: "openai/whisper",
    url: "https://github.com/openai/whisper",
    description: "Robust Speech Recognition via Large-Scale Weak Supervision",
    stars: 72000,
    forks: 8600,
    createdAt: "2022-09-16T20:02:54Z",
    defaultBranch: "main",
    lastCommitAt: "2026-06-26T17:39:21Z",
    release: { tag: "v20250625", publishedAt: "2025-06-26T01:06:22Z" },
    license: "MIT",
  });
  expect(urls).toEqual([
    "https://api.github.com/repos/openai/whisper",
    "https://api.github.com/repos/openai/whisper/commits?sha=main&per_page=1",
    "https://api.github.com/repos/openai/whisper/releases/latest",
  ]);
});

test("a renamed repo is asked about under its new name after the first call", async () => {
  const { fetchFn, urls } = scripted({ repo: json({ ...REPO, full_name: "openai/whisper-v2" }) });
  await lookupRepoFacts("openai/whisper", { fetchFn });
  expect(urls[1]).toStartWith("https://api.github.com/repos/openai/whisper-v2/commits");
});

test("no release, an empty repo and a license without an SPDX id leave those facts null or named", async () => {
  const { fetchFn } = scripted({
    repo: json({ ...REPO, license: { name: "Other", spdx_id: "NOASSERTION" } }),
    commits: () => json({ message: "Git Repository is empty." }, 409),
    release: () => json({ message: "Not Found" }, 404),
  });
  const facts = await lookupRepoFacts("openai/whisper", { fetchFn });
  expect(facts?.lastCommitAt).toBeNull();
  expect(facts?.release).toBeNull();
  expect(facts?.license).toBe("Other");

  const bare = await lookupRepoFacts("openai/whisper", scripted({ repo: json({ ...REPO, license: null }) }));
  expect(bare?.license).toBeNull();
});

test("a repo GitHub does not have is null; other failures throw", async () => {
  expect(await lookupRepoFacts("nobody/nothing", scripted({ repo: json({ message: "Not Found" }, 404) }))).toBeNull();
  await expect(lookupRepoFacts("openai/whisper", scripted({ repo: json({}, 502) }))).rejects.toThrow(/HTTP 502/);
  await expect(
    lookupRepoFacts("openai/whisper", scripted({ release: () => json({}, 500) })),
  ).rejects.toThrow(/HTTP 500/);
  await expect(
    lookupRepoFacts("openai/whisper", scripted({ repo: json({ message: "rate limit" }, 403, 0) })),
  ).rejects.toBeInstanceOf(GithubRateLimitError);
});

test("the plugin's lookup slot gives an item whose signals carry every fact", async () => {
  const { fetchFn } = scripted({});
  const item = await githubPlugin.lookup!("https://github.com/openai/whisper", {
    fetchFn,
    now: () => 0,
    today: () => "2026-10-14",
  });
  expect(item?.source).toBe("github");
  expect(item?.sourceKey).toBe("openai/whisper");
  expect(item?.signals).toEqual({
    stars: 72000,
    forks: 8600,
    createdAt: "2022-09-16T20:02:54Z",
    lastCommitAt: "2026-06-26T17:39:21Z",
    releaseTag: "v20250625",
    releaseAt: "2025-06-26T01:06:22Z",
    license: "MIT",
  });
});

test("RepoLookups caps the repos a run asks about and answers repeats from memory", async () => {
  const { fetchFn, urls } = scripted({});
  const lookups = new RepoLookups(2);
  expect((await lookups.lookup("openai/whisper", { fetchFn })).kind).toBe("found");
  // The same repo by another spelling: not asked again, not counted again.
  expect((await lookups.lookup("https://github.com/OpenAI/Whisper/issues/1", { fetchFn })).kind).toBe("found");
  expect(lookups.used).toBe(1);
  expect(lookups.requests).toBe(3);
  expect((await lookups.lookup("a/b", { fetchFn })).kind).toBe("found");
  expect(lookups.remaining).toBe(0);
  expect(await lookups.lookup("c/d", { fetchFn })).toEqual({ kind: "skipped", reason: "cap" });
  expect(urls).toHaveLength(6);
  expect(lookups.quotaRemaining).toBe(50);
});

test("RepoLookups stops when GitHub reports too little quota for another lookup, or none", async () => {
  const low = scripted({ release: () => json(RELEASE, 200, 2) });
  const lookups = new RepoLookups(30);
  expect((await lookups.lookup("a/b", low)).kind).toBe("found");
  expect(lookups.quotaRemaining).toBe(2);
  expect(await lookups.lookup("c/d", low)).toEqual({ kind: "skipped", reason: "quota" });
  expect(low.urls).toHaveLength(3);

  const spent = scripted({ repo: json({ message: "API rate limit exceeded" }, 403, 0) });
  const run = new RepoLookups(30);
  expect(await run.lookup("a/b", spent)).toEqual({ kind: "skipped", reason: "quota" });
  expect(await run.lookup("c/d", spent)).toEqual({ kind: "skipped", reason: "quota" });
  expect(spent.urls).toHaveLength(1);
});

test("a missing repo is remembered and a malformed handle costs nothing", async () => {
  const gone = scripted({ repo: json({ message: "Not Found" }, 404) });
  const lookups = new RepoLookups(30);
  expect(await lookups.lookup("a/b", gone)).toEqual({ kind: "missing" });
  expect(await lookups.lookup("a/b", gone)).toEqual({ kind: "missing" });
  expect(await lookups.lookup("not a repo", gone)).toEqual({ kind: "missing" });
  expect(gone.urls).toHaveLength(1);
  expect(lookups.used).toBe(1);
});
