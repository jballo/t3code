import { describe, expect, it } from "vite-plus/test";
import type { OrchestrationV2ProjectedTurnItem, OrchestrationV2TurnItem } from "@t3tools/contracts";

import { buildSideQuestionPrompt } from "./SideQuestionContext.ts";

let position = 0;
function row(item: Record<string, unknown>): OrchestrationV2ProjectedTurnItem {
  position += 1;
  return {
    position,
    visibility: "local",
    sourceThreadId: "thread:parent",
    sourceItemId: `item:${position}`,
    item: { status: "completed", ...item } as unknown as OrchestrationV2TurnItem,
  } as OrchestrationV2ProjectedTurnItem;
}

describe("buildSideQuestionPrompt", () => {
  it("renders the transcript with in-progress work, clipped tool output, and the question last", () => {
    const prompt = buildSideQuestionPrompt({
      title: "upload retry",
      question: "why p-retry?",
      toolOutputMaxChars: 20,
      items: [
        row({ type: "user_message", text: "Add retry with backoff" }),
        row({ type: "reasoning", text: "hidden thinking" }),
        row({ type: "assistant_message", text: "I'll wrap putObject with p-retry." }),
        row({ type: "file_change", fileName: "client.ts", additions: 18, deletions: 4 }),
        row({
          type: "command_execution",
          status: "running",
          input: "pnpm test upload",
          output: "x".repeat(100),
        }),
      ],
    });

    expect(prompt).toContain('<transcript title="upload retry">');
    expect(prompt).toContain("User:\nAdd retry with backoff");
    expect(prompt).toContain("Assistant:\nI'll wrap putObject with p-retry.");
    expect(prompt).toContain("[edit] client.ts +18 -4");
    expect(prompt).toContain("[command (in progress)] $ pnpm test upload");
    expect(prompt).toContain(`${"x".repeat(20)} […]`);
    expect(prompt).not.toContain("hidden thinking");
    expect(prompt.endsWith("Side question: why p-retry?")).toBe(true);
  });

  it("starts from the latest compaction summary, which is what the main agent still remembers", () => {
    const prompt = buildSideQuestionPrompt({
      title: "t",
      question: "q",
      items: [
        row({ type: "user_message", text: "ancient history" }),
        row({ type: "compaction", summary: "We agreed on p-retry." }),
        row({ type: "user_message", text: "recent" }),
      ],
    });

    expect(prompt).toContain(
      "Earlier conversation (summarized by the agent):\nWe agreed on p-retry.",
    );
    expect(prompt).not.toContain("ancient history");
    expect(prompt).toContain("User:\nrecent");
  });

  it("drops the oldest items first when the transcript is over budget", () => {
    const prompt = buildSideQuestionPrompt({
      title: "t",
      question: "q",
      maxChars: 40,
      items: [
        row({ type: "user_message", text: "first message that is fairly long" }),
        row({ type: "assistant_message", text: "second message that is fairly long" }),
        row({ type: "user_message", text: "third" }),
      ],
    });

    expect(prompt).toContain("[2 earlier items omitted]");
    expect(prompt).not.toContain("first message");
    expect(prompt).not.toContain("second message");
    expect(prompt).toContain("User:\nthird");
  });
});
