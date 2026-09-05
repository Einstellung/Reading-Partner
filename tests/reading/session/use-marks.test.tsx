// The marks, from the shell's side (src/reading/session/use-marks.ts and
// use-mark-doors.ts): that a stroke drawn with the AI pen writes a thread down
// and opens the bubble beside it while one drawn with any other pen is only a
// mark, that editing a mark reaches the editor showing it, that a trace-list row
// for a page mark jumps the reader and gets the drawer out of the way, and that
// deleting one takes it out of the map, the file and the editor together.
//
// Same setup as the use-call tests: the two hooks need a document, and the
// application modules are imported statically because a module first evaluated
// with a window in scope keeps whatever it decided about being in a browser
// (pitfall 121).
import { afterEach, expect, mock, spyOn, test } from "bun:test";
import { useMarkDoors } from "../../../src/reading/session/use-mark-doors";
import { useMarks } from "../../../src/reading/session/use-marks";
import * as annotations from "../../../src/platform/app/annotations";
import * as threads from "../../../src/platform/app/threads";
import type { Annotation, ViewInstance } from "../../../src/platform/app/reader-contract";
import type { Thread } from "../../../src/platform/app/threads";
import { useDom } from "../../support/dom";

const { act, cleanup, renderHook } = await useDom();

const BOOK = "book-1";

// The annotations file and the threads file, as the two stores hold them. Both
// are on disk in the app, so nothing here may reach the real ones.
function fakeWorld() {
  const held: Record<string, Thread> = {};
  const spies = [
    spyOn(annotations, "saveAnnotations").mockImplementation(() => {}),
    spyOn(annotations, "deleteAnnotations").mockImplementation(() => {}),
    spyOn(threads, "getThread").mockImplementation((bookId, threadId) =>
      bookId === BOOK ? held[threadId] : undefined,
    ),
    spyOn(threads, "createThread").mockImplementation((_bookId, annotationId, threadId) => {
      const t: Thread = {
        id: threadId,
        annotationId,
        path: BOOK,
        createdAt: 0,
        messages: [],
      };
      held[threadId] = t;
      return t;
    }),
    spyOn(threads, "createAsideThread").mockImplementation((_bookId, threadId, init) => {
      const t: Thread = {
        id: threadId,
        annotationId: init.annotationId ?? "",
        parentThreadId: init.parentThreadId,
        path: BOOK,
        createdAt: 0,
        messages: [],
      };
      held[threadId] = t;
      return t;
    }),
  ];
  return { held, restore: () => spies.forEach((s) => s.mockRestore()) };
}

let world: ReturnType<typeof fakeWorld> | null = null;
afterEach(() => {
  cleanup();
  world?.restore();
  world = null;
});

// A page mark: no chat anchor, so isPageMark reads it as one.
function pageMark(id: string, extra: Partial<Annotation> = {}): Annotation {
  return { id, type: "highlight", text: `words of ${id}`, ...extra };
}

function mount(initial: { aiPen: boolean }) {
  world = fakeWorld();
  const view = {
    setAnnotations: mock(() => {}),
    unsetAnnotations: mock(() => {}),
    selectAnnotations: mock(() => {}),
    navigate: mock(() => {}),
  };
  const doors = {
    openThreadCall: mock(() => {}),
    reopenThreadCall: mock(() => {}),
    openChatAside: mock(() => {}),
    dropThread: mock(() => {}),
    onMarkPrepTrigger: mock(() => {}),
    setSidebarOpen: mock(() => {}),
    // No lesson running: an AI-pen mark opens a conversation of its own.
    currentCall: mock(() => null),
  };
  const viewRef = { current: view as unknown as ViewInstance };
  const bookIdRef = { current: BOOK as string | null };
  const readerPaneRef = { current: null as HTMLDivElement | null };

  const rendered = renderHook(
    (props: { aiPen: boolean }) => {
      const marks = useMarks({ viewRef, bookIdRef });
      const opened = useMarkDoors({
        marks,
        viewRef,
        bookIdRef,
        readerPaneRef,
        aiPen: props.aiPen,
        penColor: "#ffd400",
        onMarkPrepTrigger: doors.onMarkPrepTrigger,
        setSidebarOpen: doors.setSidebarOpen,
        openThreadCall: doors.openThreadCall,
        reopenThreadCall: doors.reopenThreadCall,
        openChatAside: doors.openChatAside,
        currentCall: doors.currentCall,
        dropThread: doors.dropThread,
      });
      return { marks, doors: opened };
    },
    { initialProps: initial },
  );
  return { ...rendered, view, doors };
}

test("a stroke drawn with the AI pen writes its thread down and opens the bubble", () => {
  const { result, view, doors } = mount({ aiPen: true });
  const drawn = pageMark("m1");

  act(() => result.current.doors.onSaveAnnotations([drawn]));

  // The mark carries the thread it opened, in the map, in the file and in the
  // engine's own copy.
  const stored = result.current.marks.annsRef.current.get("m1");
  const threadId = stored?.aiThreadId as string;
  expect(typeof threadId).toBe("string");
  expect(annotations.saveAnnotations).toHaveBeenCalled();
  expect(threads.createThread).toHaveBeenCalledWith(BOOK, "m1", threadId);
  expect(view.setAnnotations).toHaveBeenCalledWith([stored]);
  // A fresh mark is what advances preparation's frontier (docs/09).
  expect(doors.onMarkPrepTrigger).toHaveBeenCalled();

  // The bubble opens on the mark, with nothing stored behind it yet.
  expect(doors.openThreadCall).toHaveBeenCalledTimes(1);
  const [opening, storedRows] = doors.openThreadCall.mock.calls[0] as unknown as [
    { threadId: string; annotationId: string; view: string; aside?: unknown },
    unknown[],
  ];
  expect(opening).toMatchObject({ threadId, annotationId: "m1", view: "bubble" });
  // Not a side conversation: no lesson was running when it was drawn.
  expect(opening.aside).toBeUndefined();
  expect(storedRows).toEqual([]);
});

test("a stroke drawn with any other pen is a mark and nothing more", () => {
  const { result, doors } = mount({ aiPen: false });

  act(() => result.current.doors.onSaveAnnotations([pageMark("m1")]));

  expect(result.current.marks.annsRef.current.get("m1")?.aiThreadId).toBeUndefined();
  expect(threads.createThread).not.toHaveBeenCalled();
  expect(doors.openThreadCall).not.toHaveBeenCalled();
  // It is still a mark: saved, and in the drawer's list.
  expect(annotations.saveAnnotations).toHaveBeenCalled();
  expect(result.current.marks.traceAnns.map((a) => a.id)).toEqual(["m1"]);
});

test("editing a mark reaches the editor showing it", () => {
  const { result, view } = mount({ aiPen: false });
  const mark = pageMark("m1");
  act(() => result.current.marks.showMarks([mark]));

  // A mark with no conversation behind it raises the editor rather than a call.
  act(() =>
    result.current.doors.onSetAnnotationPopup({ rect: [10, 0, 30, 40], annotation: mark }),
  );
  expect(result.current.marks.popup?.annotation.id).toBe("m1");
  expect(result.current.marks.popup?.anchor).toEqual({ x: 20, y: 40 });

  act(() => result.current.marks.patchAnnotation("m1", { note: "a note" }));

  expect(result.current.marks.popup?.annotation.note).toBe("a note");
  expect(result.current.marks.annsRef.current.get("m1")?.note).toBe("a note");
  expect(view.setAnnotations).toHaveBeenCalled();
});

test("a trace-list row for a page mark jumps the reader and closes the drawer", () => {
  const { result, view, doors } = mount({ aiPen: false });
  act(() => result.current.marks.showMarks([pageMark("m1")]));

  act(() => result.current.doors.onTraceSelect("m1"));

  expect(doors.setSidebarOpen).toHaveBeenCalledWith(false);
  expect(view.selectAnnotations).toHaveBeenCalledWith(["m1"]);
  expect(view.navigate).toHaveBeenCalledWith({ annotationID: "m1" });
  expect(result.current.marks.selectedAnnId).toBe("m1");
  // Nothing to reopen: this mark never had a conversation.
  expect(doors.reopenThreadCall).not.toHaveBeenCalled();
});

test("deleting a mark takes it out of the map, the file and the editor", () => {
  const { result, view } = mount({ aiPen: false });
  const mark = pageMark("m1");
  act(() => result.current.marks.showMarks([mark]));
  act(() =>
    result.current.doors.onSetAnnotationPopup({ rect: [10, 0, 30, 40], annotation: mark }),
  );

  act(() => result.current.marks.removeAnnotation("m1"));

  expect(result.current.marks.popup).toBeNull();
  expect(result.current.marks.traceAnns).toEqual([]);
  expect(result.current.marks.annsRef.current.has("m1")).toBe(false);
  expect(view.unsetAnnotations).toHaveBeenCalledWith(["m1"]);
  expect(annotations.deleteAnnotations).toHaveBeenCalledWith(BOOK, ["m1"]);
});
