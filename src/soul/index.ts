// The soul (docs/61): the one person who sits at the desk. What it carries into
// every turn whatever the desk holds is self.ts; the assembly that puts that
// person and a laid desk together into one call is turn.ts.

export { assembleTurn, configuredModel, type AssembleInput, type AssembledTurn } from "./turn";
export { soulMemorySection, openSoul, type Soul } from "./self";
export { proposedTopicName, type TopicProposalCardData } from "./topic/card";
export {
  buildProposeTopicTool,
  liveTopicChoices,
  resolveProposedTopic,
  threadTopic,
  topicGuidance,
  type ProposeTopicDeps,
  type TopicChoice,
  type TopicProposalSurface,
} from "./topic/propose";
export {
  applyTopicProposal,
  type TopicApplied,
  type TopicSettledHook,
  type TopicSettlePorts,
} from "./topic/settle";
