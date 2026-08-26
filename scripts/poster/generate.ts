// Bench for reading-group poster prompts: submits one prompt to the image relay
// (imageGen.ts beside it) and drops the PNG plus the exact prompt and
// parameters that produced it into scripts/poster/out/, so a run can be traced
// back and iterated on. Experimental tooling, not a product path.
//
// Usage:
//   bun run scripts/poster/generate.ts --prompt "..." --size 9:16 --ref out/prev.png
//
// IMAGE_API_KEY must be set (bun reads the repo-root .env). IMAGE_API_BASE and
// IMAGE_MODEL override the relay defaults. Every run spends money.

import { mkdir } from "node:fs/promises";
import { dirname, extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  generateImage,
  resolveImageGenConfig,
  type HttpRequest,
  type ImageGenDeps,
} from "./imageGen";

const OUT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "out");
const DEFAULT_SIZE = "9:16";
// The relay's documented allow-lists. Checked here so a typo costs nothing
// instead of a rejected paid call.
const ASPECT_RATIOS = ["1:1", "16:9", "9:16", "4:3"];
const IMAGE_SIZES = ["1K", "2K", "4K"] as const;

const USAGE = `Generate one reading-group poster through the image relay.

Usage: bun run scripts/poster/generate.ts [options]

  --prompt <text>       Prompt text.
  --prompt-file <path>  Read the prompt from a file instead.
                        With neither flag the prompt is read from stdin.
  --size <str>          Aspect ratio, default ${DEFAULT_SIZE} (posters are portrait).
                        One of ${ASPECT_RATIOS.join(", ")}, or pixels like 1024x1024.
  --image-size <str>    Resolution tier: ${IMAGE_SIZES.join(", ")}. Relay default if unset.
  --ref <path>          Local image to carry as a style reference.
  --out <name>          Output basename, without extension.
  -h, --help            Show this.

Environment: IMAGE_API_KEY (required), IMAGE_API_BASE, IMAGE_MODEL.`;

interface Args {
  prompt?: string;
  promptFile?: string;
  size: string;
  imageSize?: (typeof IMAGE_SIZES)[number];
  ref?: string;
  out?: string;
  help: boolean;
}

function parseSize(raw: string): string {
  if (ASPECT_RATIOS.includes(raw) || /^\d+x\d+$/.test(raw)) return raw;
  throw new Error(`--size must be one of ${ASPECT_RATIOS.join(", ")} or WxH pixels, got ${raw}`);
}

function parseImageSize(raw: string): (typeof IMAGE_SIZES)[number] {
  const found = IMAGE_SIZES.find((s) => s === raw.toUpperCase());
  if (!found) throw new Error(`--image-size must be one of ${IMAGE_SIZES.join(", ")}, got ${raw}`);
  return found;
}

// Hand-rolled because the flag set is tiny and the script has no deps.
function parseArgs(argv: string[]): Args {
  const args: Args = { size: DEFAULT_SIZE, help: false };
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    const value = () => {
      const v = argv[++i];
      if (v === undefined) throw new Error(`${flag} needs a value`);
      return v;
    };
    switch (flag) {
      case "--prompt":
        args.prompt = value();
        break;
      case "--prompt-file":
        args.promptFile = value();
        break;
      case "--size":
        args.size = parseSize(value());
        break;
      case "--image-size":
        args.imageSize = parseImageSize(value());
        break;
      case "--ref":
        args.ref = value();
        break;
      case "--out":
        args.out = value();
        break;
      case "-h":
      case "--help":
        args.help = true;
        break;
      default:
        throw new Error(`unknown option: ${flag}`);
    }
  }
  if (args.prompt !== undefined && args.promptFile !== undefined) {
    throw new Error("pass --prompt or --prompt-file, not both");
  }
  return args;
}

// Local-time stamp, sortable, safe in a filename.
function timestamp(at: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return (
    `${at.getFullYear()}${p(at.getMonth() + 1)}${p(at.getDate())}` +
    `-${p(at.getHours())}${p(at.getMinutes())}${p(at.getSeconds())}`
  );
}

// First few words of the prompt, so a directory listing is readable.
function slugify(prompt: string, words = 5): string {
  const slug = prompt
    .toLowerCase()
    .replace(/[^a-z0-9\s-]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, words)
    .join("-");
  return slug || "poster";
}

const MIME_BY_EXT: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
};

async function readReference(path: string): Promise<string> {
  const file = Bun.file(path);
  if (!(await file.exists())) throw new Error(`reference image not found: ${path}`);
  const mime = MIME_BY_EXT[extname(path).toLowerCase()] ?? "image/png";
  const base64 = Buffer.from(await file.arrayBuffer()).toString("base64");
  return `data:${mime};base64,${base64}`;
}

async function readPrompt(args: Args): Promise<string> {
  if (args.prompt !== undefined) return args.prompt.trim();
  if (args.promptFile !== undefined) {
    const file = Bun.file(args.promptFile);
    if (!(await file.exists())) throw new Error(`prompt file not found: ${args.promptFile}`);
    return (await file.text()).trim();
  }
  return (await Bun.stdin.text()).trim();
}

function makeDeps(signal: AbortSignal): ImageGenDeps {
  return {
    fetch: async (req: HttpRequest) => {
      const res = await fetch(req.url, { ...req.init, signal });
      return { ok: res.ok, status: res.status, json: () => res.json() };
    },
    fetchBytes: async (url: string) => {
      const res = await fetch(url, { signal });
      if (!res.ok) throw new Error(`fetching the result image failed (HTTP ${res.status})`);
      return new Uint8Array(await res.arrayBuffer());
    },
    sleep: (ms: number) =>
      new Promise((resolvePromise, reject) => {
        const timer = setTimeout(() => {
          signal.removeEventListener("abort", onAbort);
          resolvePromise();
        }, ms);
        const onAbort = () => {
          clearTimeout(timer);
          reject(new DOMException("The operation was aborted.", "AbortError"));
        };
        signal.addEventListener("abort", onAbort, { once: true });
      }),
    now: () => Date.now(),
    signal,
  };
}

async function main(): Promise<number> {
  let args: Args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (err) {
    console.error(`${(err as Error).message}\n\n${USAGE}`);
    return 2;
  }
  if (args.help) {
    console.log(USAGE);
    return 0;
  }

  const apiKey = process.env.IMAGE_API_KEY?.trim();
  if (!apiKey) {
    console.error(
      "IMAGE_API_KEY is not set. Put it in the repo-root .env (bun loads it) or export it, then rerun.",
    );
    return 1;
  }

  const config = resolveImageGenConfig({
    apiBase: process.env.IMAGE_API_BASE ?? null,
    model: process.env.IMAGE_MODEL ?? null,
    apiKey,
  });

  let prompt: string;
  let reference: string | undefined;
  try {
    prompt = await readPrompt(args);
    if (!prompt) throw new Error("the prompt is empty");
    if (args.ref) reference = await readReference(args.ref);
  } catch (err) {
    console.error((err as Error).message);
    return 1;
  }

  const startedAt = new Date();
  const base = args.out?.trim() || `${timestamp(startedAt)}-${slugify(prompt)}`;
  const pngPath = resolve(OUT_DIR, `${base}.png`);
  const jsonPath = resolve(OUT_DIR, `${base}.json`);

  const abort = new AbortController();
  // Ctrl-C aborts the in-flight poll instead of leaving the process hanging on it.
  process.on("SIGINT", () => abort.abort());

  const extras = [args.imageSize ? `, ${args.imageSize}` : "", args.ref ? `, ref ${args.ref}` : ""];
  console.log(`${config.model} @ ${config.apiBase} — size ${args.size}${extras.join("")}`);
  let dataUrl: string;
  try {
    dataUrl = await generateImage(
      config,
      {
        prompt,
        size: args.size,
        ...(args.imageSize ? { imageSize: args.imageSize } : {}),
        ...(reference ? { image: reference } : {}),
      },
      makeDeps(abort.signal),
    );
  } catch (err) {
    const e = err as Error;
    console.error(e.name === "AbortError" ? "aborted" : `generation failed: ${e.message}`);
    return 1;
  }

  const base64 = dataUrl.slice(dataUrl.indexOf(",") + 1);
  await mkdir(OUT_DIR, { recursive: true });
  await Bun.write(pngPath, Buffer.from(base64, "base64"));
  await Bun.write(
    jsonPath,
    `${JSON.stringify(
      {
        prompt,
        size: args.size,
        imageSize: args.imageSize ?? null,
        model: config.model,
        apiBase: config.apiBase,
        reference: args.ref ?? null,
        generatedAt: startedAt.toISOString(),
      },
      null,
      2,
    )}\n`,
  );

  const seconds = ((Date.now() - startedAt.getTime()) / 1000).toFixed(1);
  console.log(`${pngPath}\n${jsonPath}\ndone in ${seconds}s`);
  return 0;
}

process.exit(await main());
