// Context budgeting: what a call costs, what the provider will let the model
// emit in return, and what to give up when the two do not leave room.
//
// Nothing here imports src/ai. The send path is the last place that has to check
// a budget, so ai/ has to be free to import this; an edge the other way would
// close the cycle and tests/layering.test.ts would say so.

export {
  contextBudget,
  estimateContextTokens,
  estimateMessageTokens,
  estimateTextTokens,
  fitsAllowance,
  fitsBudget,
  outputAllowance,
  piBudget,
  OUTPUT_FLOOR,
  PI_CONTEXT_SAFETY_TOKENS,
  type BudgetPurpose,
  type ContextBudget,
  type PiBudget,
} from "./estimate";
export {
  budgetNotice,
  planReductions,
  stubEarlyToolResults,
  toolResultStub,
  LADDER,
  REFUSE_EXHAUSTED,
  REFUSE_FLOOR_OVER,
  TOOL_RESULTS_KEPT,
  type LadderInput,
  type LadderPlan,
  type ReductionId,
  type StubbedMessages,
} from "./ladder";
