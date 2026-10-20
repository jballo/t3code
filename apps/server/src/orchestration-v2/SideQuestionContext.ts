import type { OrchestrationV2ProjectedTurnItem, OrchestrationV2TurnItem } from "@t3tools/contracts";

const SIDE_QUESTION_CONTEXT_MAX_CHARS = 60_000;
const SIDE_QUESTION_TOOL_OUTPUT_MAX_CHARS = 400;
const PLAN_MAX_CHARS = 2_000;

export interface SideQuestionPromptInput {
  readonly title: string;
  /** The parent's visible timeline in order, including a run still in progress. */
  readonly items: ReadonlyArray<OrchestrationV2ProjectedTurnItem>;
  readonly question: string;
  readonly maxChars?: number;
  readonly toolOutputMaxChars?: number;
}

function clip(text: string, maxChars: number): string {
  const trimmed = text.trim();
  return trimmed.length <= maxChars ? trimmed : `${trimmed.slice(0, maxChars).trimEnd()} […]`;
}

function inProgress(item: OrchestrationV2TurnItem): string {
  return item.status === "pending" || item.status === "running" || item.status === "waiting"
    ? " (in progress)"
    : "";
}

/**
 * One transcript block per item the side agent needs to know about. Tool
 * output is the bulk of a transcript and rarely the point of a side question,
 * so it is clipped hard; messages are kept whole and the budget trims from the
 * oldest end instead.
 */
function renderItem(item: OrchestrationV2TurnItem, toolOutputMaxChars: number): string | null {
  switch (item.type) {
    case "user_message":
      return `User:\n${item.text.trim()}`;
    case "assistant_message":
      return `Assistant${inProgress(item)}:\n${item.text.trim()}`;
    case "command_execution":
      return [
        `[command${inProgress(item)}] $ ${clip(item.input, toolOutputMaxChars)}`,
        item.output === undefined || item.output.trim() === ""
          ? undefined
          : clip(item.output, toolOutputMaxChars),
      ]
        .filter((line): line is string => line !== undefined)
        .join("\n");
    case "file_change": {
      const counts =
        item.additions === undefined && item.deletions === undefined
          ? ""
          : ` +${item.additions ?? 0} -${item.deletions ?? 0}`;
      return `[edit${inProgress(item)}] ${item.fileName}${counts}`;
    }
    case "file_search":
      return `[search] ${clip(item.pattern ?? "", toolOutputMaxChars)}`;
    case "web_search":
      return `[web search] ${clip((item.patterns ?? []).join(", "), toolOutputMaxChars)}`;
    case "dynamic_tool":
      return `[tool ${item.toolName}${inProgress(item)}]`;
    case "approval_request":
      return `[approval requested] ${clip(item.prompt ?? item.requestKind ?? "permission", toolOutputMaxChars)}`;
    case "user_input_request":
      return `[asked the user] ${clip(JSON.stringify(item.questions), toolOutputMaxChars)}`;
    case "proposed_plan":
      return `[plan]\n${clip(item.markdown, PLAN_MAX_CHARS)}`;
    case "todo_list":
      return `[todo]\n${item.steps.map((step) => `[${step.status}] ${step.text}`).join("\n")}`;
    case "subagent":
      return [
        `[subagent${inProgress(item)}] ${clip(item.prompt ?? "", toolOutputMaxChars)}`,
        item.result == null ? undefined : clip(item.result, toolOutputMaxChars),
      ]
        .filter((line): line is string => line !== undefined)
        .join("\n");
    case "error":
      return `[error] ${clip(item.failure.message ?? "unknown error", toolOutputMaxChars)}`;
    case "reasoning":
    case "compaction":
    case "handoff":
    case "fork":
    case "thread_created":
    case "checkpoint":
    case "notification":
    case "system_notice":
    case "secret_request":
    case "run_interrupt_request":
    case "run_interrupt_result":
      return null;
  }
}

/**
 * The first message of a side question: the parent's transcript as the side
 * agent should see it, then the question. A provider compaction summary stands
 * in for everything before it, which is exactly what the main agent itself
 * still remembers; without one the oldest items fall off the budget first.
 */
export function buildSideQuestionPrompt(input: SideQuestionPromptInput): string {
  const maxChars = input.maxChars ?? SIDE_QUESTION_CONTEXT_MAX_CHARS;
  const toolOutputMaxChars = input.toolOutputMaxChars ?? SIDE_QUESTION_TOOL_OUTPUT_MAX_CHARS;

  let start = 0;
  let summary: string | null = null;
  for (let index = input.items.length - 1; index >= 0; index -= 1) {
    const item = input.items[index]!.item;
    if (item.type === "compaction" && item.summary !== undefined && item.summary.trim() !== "") {
      start = index + 1;
      summary = item.summary.trim();
      break;
    }
  }

  const blocks: Array<string> = [];
  for (let index = start; index < input.items.length; index += 1) {
    const rendered = renderItem(input.items[index]!.item, toolOutputMaxChars);
    if (rendered !== null) blocks.push(rendered);
  }

  let used = summary === null ? 0 : summary.length;
  let kept = 0;
  for (let index = blocks.length - 1; index >= 0; index -= 1) {
    const block = blocks[index]!;
    if (used + block.length > maxChars) break;
    used += block.length;
    kept += 1;
  }
  const omitted = blocks.length - kept;
  const transcript = [
    summary === null ? undefined : `Earlier conversation (summarized by the agent):\n${summary}`,
    omitted === 0 ? undefined : `[${omitted} earlier ${omitted === 1 ? "item" : "items"} omitted]`,
    ...blocks.slice(blocks.length - kept),
  ]
    .filter((block): block is string => block !== undefined)
    .join("\n\n");

  return [
    // Fork turns this exchange into an ordinary thread that keeps this message
    // as its first turn, so the limits are scoped to this answer and must not
    // bind follow-ups. The runtime policy is what actually enforces read-only.
    "You are answering a side question about an ongoing coding session. The transcript below is the conversation so far between the user and the main agent, including work still in progress. Answer the question from this context. For this answer only, do not continue the main agent's task and do not change any files; you may read files to check something. Keep the answer focused. If the user follows up later in this conversation, treat their new messages as ordinary requests: those limits no longer apply.",
    `<transcript title=${JSON.stringify(input.title)}>\n${transcript}\n</transcript>`,
    `Side question: ${input.question.trim()}`,
  ].join("\n\n");
}
