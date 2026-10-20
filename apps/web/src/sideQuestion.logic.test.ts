import { describe, expect, it } from "vite-plus/test";
import type { ThreadId } from "@t3tools/contracts";

import {
  nextSideQuestionToView,
  parseSideQuestionCommand,
  resolveVisibleSideQuestion,
  sideQuestionActivity,
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
