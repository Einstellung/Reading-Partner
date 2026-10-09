// The intake card drawn off real intake records (src/ui/components/lumen/
// IntakeCard.tsx): the intake store and the topic shelf run over the fake
// AppData, so what each card says comes from the record and not the payload.
// With INTAKE_SHOT_DIR set it also leaves the drawn cards there as HTML, which
// is what the headless screenshots are taken from.
// Run: scripts/t.sh tests/ui/components/lumen/intake-card-render.test.tsx

import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { installAppData } from "../../../support/appdata-fake";
import { useDom } from "../../../support/dom";

const { cleanup, fireEvent, render } = await useDom();

const { IntakeCard } = await import("../../../../src/ui/components/lumen/IntakeCard");
const { intakeStore } = await import("../../../../src/reading/ingest/intake-store");
const { createTopic } = await import("../../../../src/platform/app/topics");
const { getLocale, setLocale } = await import("../../../../src/i18n/locale");

const DOC = {
  hash: "h-pi",
  title: "pi-durable: a durable agent runtime, the handbook",
  format: "epub" as const,
  sections: 43,
  pages: 180,
  chars: 120000,
  path: "library/h-pi.epub",
  sourceUrl: "https://github.com/robotbird/pi-durable-book",
};
const POST = "https://x.com/robotbird01/status/2107026689935200274";

let locale: ReturnType<typeof getLocale>;
beforeEach(() => {
  installAppData();
  locale = getLocale();
});
afterEach(() => {
  cleanup();
  setLocale(locale);
});

async function intakes(pi: string) {
  const reading = await intakeStore.create({ url: POST });
  await intakeStore.progress(reading.id, "github.com");
  const picked = await intakeStore.create({ url: POST });
  await intakeStore.choose(picked.id, pi);
  const ready = await intakeStore.create({ url: POST });
  await intakeStore.filed(ready.id, { documents: [DOC], skipped: [] });
  const filed = await intakeStore.create({ url: POST });
  await intakeStore.filed(filed.id, {
    documents: [DOC],
    skipped: [{ url: POST, reason: "it has no content of its own" }],
  });
  await intakeStore.choose(filed.id, pi);
  const failed = await intakeStore.create({ url: "https://x.com/longform_notes/status/2108412739906115584" });
  await intakeStore.filed(failed.id, { documents: [], skipped: [], emptyReason: "Read x.com. Nothing became a document." });
  return [reading.id, picked.id, ready.id, filed.id, failed.id, "not-on-this-device"];
}

async function drawAll() {
  await createTopic("Brief");
  const pi = await createTopic("pi");
  await createTopic("Edge models");
  const ids = await intakes(pi.id);
  const actions: unknown[] = [];
  const view = render(
    <div className="flex flex-col gap-3.5">
      {ids.map((intakeId, i) => (
        <IntakeCard
          key={intakeId}
          payload={{ kind: "link-intake", intakeId, ...(i === 0 ? { suggestedTopicId: pi.id } : {}) }}
          dispatch={(action) => actions.push({ intakeId, action })}
          surface="call"
        />
      ))}
    </div>,
  );
  return { view, actions, ids, pi };
}

function leaveShot(name: string, view: { container: HTMLElement }) {
  const dir = process.env.INTAKE_SHOT_DIR;
  if (!dir) return;
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${name}.html`), view.container.innerHTML);
}

test("every state reads off its record: list, pick, ready, receipt, failure, another device", async () => {
  setLocale("en");
  const { view, actions, ids, pi } = await drawAll();
  await view.findByText("Filed in “pi”");
  expect(view.getByText("Reading github.com…")).toBeTruthy();
  expect(view.getByText("Going into “pi” once it's read")).toBeTruthy();
  expect(view.getByText(`Done: ${DOC.title}. Pick a topic to file it.`)).toBeTruthy();
  expect(view.getByText("43 sections · github.com/robotbird/pi-durable-book")).toBeTruthy();
  expect(view.getByText("Not taken: it has no text of its own (x.com/robotbird01/status/2107026689935200274)")).toBeTruthy();
  expect(view.getByText("it was read, but nothing in it could be filed")).toBeTruthy();
  expect(view.getByText("This link was taken in on another device. Pick its topic there.")).toBeTruthy();
  // Lumen's suggestion is marked on the first card only (the others fall back to the program's).
  expect(view.getAllByText("Suggested").length).toBeGreaterThan(0);

  // Tapping a topic asks for the pick; Open asks for the document.
  fireEvent.click(view.getAllByRole("button", { name: /^pi/ })[0]);
  fireEvent.click(view.getByRole("button", { name: "Open" }));
  expect(actions).toContainEqual({ intakeId: ids[0], action: { kind: "mutate", op: "intake-choose", arg: pi.id } });
  expect(actions).toContainEqual({ intakeId: ids[3], action: { kind: "navigate", to: "intake-document", arg: DOC.hash } });

  // New topic: a field, and the name goes up as the op's argument.
  fireEvent.click(view.getAllByRole("button", { name: /New topic/ })[0]);
  const field = view.getByPlaceholderText("New topic name");
  fireEvent.change(field, { target: { value: "Agents" } });
  leaveShot("cards-en", view);
  fireEvent.submit(field.closest("form")!);
  expect(actions).toContainEqual({ intakeId: ids[0], action: { kind: "mutate", op: "intake-new-topic", arg: "Agents" } });
});

test("the same cards in Chinese, for the screenshots", async () => {
  setLocale("zh-CN");
  const { view } = await drawAll();
  await view.findByText("收进了「pi」");
  expect(view.getByText("放进「pi」，读完就收")).toBeTruthy();
  expect(view.getByText(`读完了：${DOC.title}。选个主题就收。`)).toBeTruthy();
  expect(view.getByText("没收：它本身没有正文（x.com/robotbird01/status/2107026689935200274）")).toBeTruthy();
  fireEvent.click(view.getAllByRole("button", { name: /新建主题/ })[0]);
  leaveShot("cards-zh", view);
});
