// Every conversation the app holds, searchable across the desks it happened on
// (docs/61). A capability: it reads the catalogue (src/palace) and the store
// (platform/app), and knows what neither a book nor a briefing is.

export {
  appConversationIo,
  threadFileKey,
  threadFileName,
  type ConversationIo,
} from "./io";
export {
  readConversation,
  searchConversations,
  type ConversationExcerpt,
  type ConversationHit,
  type ExcerptLine,
  type ReadConversationInput,
  type SearchResult,
  type SearchScope,
} from "./search";
export {
  THREAD_KINDS,
  threadKindOf,
  topicOfThreadFile,
  type ThreadKind,
  type TopicCarrier,
} from "./topic-of";
export { buildConversationTools, type ConversationScope } from "./tools";
