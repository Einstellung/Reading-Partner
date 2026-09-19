// Where the tool-call trace is drawn in a reply (src/ui/components/chat/chat.tsx).
// A tool round interrupts the reply: what the model wrote before calling the tool
// stays where the reader read it, the status line is drawn under those words, and
// the next round continues below (docs/pitfall/291). Rendered statically, so the
// assertions are about what reaches the DOM. Run: bun test.

import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { MessageList } from "../../../../src/ui/components/chat/chat";
import type { ThreadMessage } from "../../../../src/ui/components/chat/types";

const FIRST = "Let me check page four.";
const RUNNING = { name: "read_page", label: "Reading p. 4", state: "running" } as const;

function row(over: Partial<ThreadMessage> = {}): ThreadMessage[] {
  return [{ role: "ai", text: FIRST, ts: 1, ...over }];
}

test("the status line sits under the words the round already wrote", () => {
  const html = renderToStaticMarkup(
    <MessageList messages={row({ streaming: true, tools: [RUNNING] })} />,
  );
  expect(html).toContain(FIRST);
  expect(html.indexOf("Reading p. 4")).toBeGreaterThan(html.indexOf(FIRST));
});

test("both paragraphs stand once the second round has written", () => {
  const html = renderToStaticMarkup(
    <MessageList messages={row({ text: `${FIRST}\n\nThe page argues otherwise.`, streaming: true })} />,
  );
  expect(html).toContain(FIRST);
  expect(html).toContain("The page argues otherwise.");
  expect(html).not.toContain("Reading p. 4");
});

test("a tool that ran before any words stands in for the dots", () => {
  const html = renderToStaticMarkup(
    <MessageList messages={row({ text: "", streaming: true, tools: [RUNNING] })} />,
  );
  expect(html).toContain("Reading p. 4");
  expect(html).not.toContain('aria-label="Thinking"');
});

// A quiet call (docs/72) is the app's own bookkeeping: no line while it runs,
// none once it is done, and the status line goes on saying what it was saying.
test("a quiet call leaves no line in the trace", () => {
	const quiet = { name: 'observation_update', label: 'Updating an observation', quiet: true } as const;
	const running = renderToStaticMarkup(
		<MessageList
			messages={row({ text: '', streaming: true, phase: 'thinking', tools: [{ ...quiet, state: 'running' }] })}
		/>,
	);
	expect(running).not.toContain('Updating an observation');
	// The line the row was already showing is still the line it shows.
	expect(running).toContain('aria-label="Thinking"');

	const settled = renderToStaticMarkup(
		<MessageList messages={row({ tools: [{ ...quiet, state: 'done' }] })} />,
	);
	expect(settled).toContain(FIRST);
	expect(settled).not.toContain('Updating an observation');
});

test("a quiet call that failed keeps its red line", () => {
	const html = renderToStaticMarkup(
		<MessageList
			messages={row({
				tools: [
					{
						name: 'observation_update',
						label: 'Updating an observation',
						state: 'error',
						error: 'no observation with that id',
						quiet: true,
					},
				],
			})}
		/>,
	);
	expect(html).toContain('Updating an observation');
	expect(html).toContain('no observation with that id');
	expect(html).toContain('text-destructive');
});

test("the line a failed call leaves stays under the answer", () => {
  const html = renderToStaticMarkup(
    <MessageList
      messages={row({ tools: [{ name: "search", label: "Searching", state: "error" }] })}
    />,
  );
  expect(html.indexOf("Searching")).toBeGreaterThan(html.indexOf(FIRST));
  expect(html).toContain("text-destructive");
});
