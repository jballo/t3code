import { describe, expect, it } from "vite-plus/test";
import type { ThreadId } from "@t3tools/contracts";

import {
  nextSideQuestionToView,
  parseSideQuestionCommand,
  resolveVisibleSideQuestion,
  sideQuestionActivity,
  sideQuestionAfterDelete,
  sideQuestionStepTitle,
} from "./sideQuestion.logic";

const shell = (id: string, input: { runStatus?: string | null; active?: boolean } = {}) =>
  ({
    id: id as ThreadId,
    latestRun: input.runStatus === null ? null : { status: input.runStatus ?? "completed" },
    runtime: input.active ? { status: "running" } : null,
    status: input.active ? "running" : "idle",
  }) as never;

describe("parseSideQuestionCommand", () => {
  it("asks with a question and cycles without one", () => {
    expect(parseSideQuestionCommand("/btw why p-retry?")).toEqual({
      kind: "ask",
      question: "why p-retry?",
    });
    expect(parseSideQuestionCommand("  /BTW  multi\nline  ")).toEqual({
      kind: "ask",
      question: "multi\nline",
    });
    expect(parseSideQuestionCommand("/btw")).toEqual({ kind: "cycle" });
    expect(parseSideQuestionCommand("/btw   ")).toEqual({ kind: "cycle" });
  });

  it("leaves other text alone", () => {
    expect(parseSideQuestionCommand("/btwx")).toBeNull();
    expect(parseSideQuestionCommand("say /btw later")).toBeNull();
    expect(parseSideQuestionCommand("/compact")).toBeNull();
  });
});

describe("resolveVisibleSideQuestion", () => {
  const newest = shell("c");
  const middle = shell("b");
  const oldest = shell("a");
  const shells = [newest, middle, oldest];

  it("shows the newest question unless the user is browsing", () => {
    expect(resolveVisibleSideQuestion(shells, null)).toBe(newest);
    expect(resolveVisibleSideQuestion(shells, "b" as ThreadId)).toBe(middle);
    // A deleted question falls back to the newest one left.
    expect(resolveVisibleSideQuestion(shells, "missing" as ThreadId)).toBe(newest);
    expect(resolveVisibleSideQuestion([], null)).toBeNull();
  });

  it("cycles newest to oldest and wraps", () => {
    expect(nextSideQuestionToView(shells, null)).toBe(newest);
    expect(nextSideQuestionToView(shells, "c" as ThreadId)).toBe(middle);
    expect(nextSideQuestionToView(shells, "a" as ThreadId)).toBe(newest);
    expect(nextSideQuestionToView([], null)).toBeNull();
  });

  it("lands on the neighbor after a delete", () => {
    expect(sideQuestionAfterDelete(shells, "c" as ThreadId)).toBe(middle);
    expect(sideQuestionAfterDelete(shells, "b" as ThreadId)).toBe(oldest);
    expect(sideQuestionAfterDelete(shells, "a" as ThreadId)).toBe(middle);
    expect(sideQuestionAfterDelete([newest], "c" as ThreadId)).toBeNull();
    expect(sideQuestionAfterDelete(shells, "missing" as ThreadId)).toBeNull();
  });
});

describe("sideQuestionActivity", () => {
  it("reads the live runtime first, then the latest run", () => {
    expect(sideQuestionActivity(shell("x", { active: true, runStatus: "completed" }))).toBe(
      "thinking",
    );
    expect(sideQuestionActivity(shell("x", { runStatus: null }))).toBe("thinking");
    expect(sideQuestionActivity(shell("x", { runStatus: "queued" }))).toBe("thinking");
    expect(sideQuestionActivity(shell("x", { runStatus: "completed" }))).toBe("answered");
    expect(sideQuestionActivity(shell("x", { runStatus: "failed" }))).toBe("failed");
    expect(sideQuestionActivity(shell("x", { runStatus: "interrupted" }))).toBe("interrupted");
  });
});

describe("sideQuestionStepTitle", () => {
  const tool = (title: string | null, toolName: string | null, input: unknown) =>
    ({ type: "dynamic_tool", title, toolName, input }) as never;

  it("names a step titled only by its tool after the file it touches", () => {
    // Muse and Pi send their tool's name as the title.
    expect(sideQuestionStepTitle(tool("read_file", "read_file", { path: "src/config.ts" }))).toBe(
      "read_file src/config.ts",
    );
    expect(sideQuestionStepTitle(tool("read", "read", { path: "src/run.ts" }))).toBe(
      "read src/run.ts",
    );
  });

  it("keeps the titles and names other providers send", () => {
    // Claude titles its own steps.
    expect(
      sideQuestionStepTitle(tool("Read /repo/src/config.ts", "Read", { file_path: "/repo/x.ts" })),
    ).toBe("Read /repo/src/config.ts");
    expect(sideQuestionStepTitle(tool(null, "ToolSearch", { query: "select:Read" }))).toBe(
      "ToolSearch",
    );
    // Codex leaves T3's tools untitled; the catalog names them.
    expect(sideQuestionStepTitle(tool(null, "t3-code.orchestrator_capabilities", {}))).toBe(
      "Get orchestration capabilities",
    );
    // A tool-name title with nothing to point at stays as it was.
    expect(sideQuestionStepTitle(tool("list_skills", "list_skills", {}))).toBe("list_skills");
  });

  it("shows the command rather than a tool-name title", () => {
    expect(
      sideQuestionStepTitle({
        type: "command_execution",
        title: "bash",
        input: "wc -l a.ts",
      } as never),
    ).toBe("wc -l a.ts");
  });
});
