import * as Schema from "effect/Schema";

import { CommandId, MessageId, ThreadId, TrimmedNonEmptyString } from "./baseSchemas.ts";
import { OrchestrationV2CreationSource } from "./orchestrationV2.ts";

const SIDE_QUESTION_MAX_CHARS = 20_000;
const SIDE_QUESTION_TITLE_MAX_CHARS = 80;

/**
 * A side question runs in a hidden child thread that sees the parent's
 * transcript as it is right now, including a run still in progress. The ids
 * are client-allocated so a retried request lands on the same thread.
 */
export const OrchestrationAskSideQuestionInput = Schema.Struct({
  parentThreadId: ThreadId,
  question: TrimmedNonEmptyString.check(Schema.isMaxLength(SIDE_QUESTION_MAX_CHARS)),
  threadId: ThreadId,
  messageId: MessageId,
  commandId: CommandId,
  creationSource: Schema.optional(OrchestrationV2CreationSource),
});
export type OrchestrationAskSideQuestionInput = typeof OrchestrationAskSideQuestionInput.Type;

export const OrchestrationAskSideQuestionResult = Schema.Struct({
  threadId: ThreadId,
});
export type OrchestrationAskSideQuestionResult = typeof OrchestrationAskSideQuestionResult.Type;

export class OrchestrationAskSideQuestionError extends Schema.TaggedError<OrchestrationAskSideQuestionError>()(
  "OrchestrationAskSideQuestionError",
  {
    message: TrimmedNonEmptyString,
    cause: Schema.optional(Schema.Defect()),
  },
) {}

/** The child thread's title is the question itself, cut to one line. */
export function sideQuestionTitle(question: string): string {
  const firstLine = question.trim().split("\n", 1)[0]?.trim() ?? "";
  if (firstLine.length <= SIDE_QUESTION_TITLE_MAX_CHARS) return firstLine;
  return `${firstLine.slice(0, SIDE_QUESTION_TITLE_MAX_CHARS - 1).trimEnd()}…`;
}
