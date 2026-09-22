// The lesson screen with a lesson running in it: the hook that holds the turn
// (use-lesson-call.ts) bound to the screen that draws it (PhoneLesson.tsx).
//
// Two files and not one so the turn starts when the screen appears and stops
// when it goes: the shell renders this only while the lesson is the screen, so
// mounting is opening the paper and unmounting is leaving it. PhoneApp would
// have to hold a hook for a screen that is not there.

import PhoneLesson from "./PhoneLesson";
import { useLessonCall } from "./use-lesson-call";
import { takeMeTo } from "../../../reading/lesson/opening";

export default function PhoneLessonScreen(props: {
  bookId: string;
  title: string;
  topicId: string;
  topicName: string;
  onBack: () => void;
  onOpenIn?: () => void;
}) {
  const call = useLessonCall({
    bookId: props.bookId,
    title: props.title,
    topicId: props.topicId,
    topicName: props.topicName,
  });

  return (
    <PhoneLesson
      bookId={props.bookId}
      title={props.title}
      onBack={props.onBack}
      {...(props.onOpenIn ? { onOpenIn: props.onOpenIn } : {})}
      messages={call.messages}
      streaming={call.streaming}
      onSend={call.send}
      onStop={call.stop}
      status={call.status}
      chapters={call.chapters}
      focus={call.focus}
      taught={call.taught}
      // A tap on a chapter says what a reader would have said; read_chapter is
      // what parks the lesson there (docs/09).
      onPickChapter={(chapter) => call.send(takeMeTo(chapter))}
    />
  );
}
