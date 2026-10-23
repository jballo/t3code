import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import type { ThreadId } from "@t3tools/contracts";

import {
  nextSideQuestionToView,
  parseSideQuestionCommand,
  resolveVisibleSideQuestion,
  sideQuestionActivity,
  sideQuestionAfterDelete,
  sideQuestionPrefixFor,
  sideQuestionStepTitle,
} from "./sideQuestion.logic";
import { selectSideQuestionView, useSideQuestionStore } from "./sideQuestionStore";

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

describe("sideQuestionPrefixFor", () => {
  const prefilled = (draft: string) =>
    parseSideQuestionCommand(sideQuestionPrefixFor(draft) + draft);

  it("turns an empty draft into a bare command", () => {
    expect(sideQuestionPrefixFor("")).toBe("/btw ");
    expect(prefilled("")).toEqual({ kind: "cycle" });
  });

  it("makes an existing draft the question instead of sending it to the main agent", () => {
    expect(prefilled("refactor the parser")).toEqual({
      kind: "ask",
      question: "refactor the parser",
    });
    expect(prefilled("say /btw later")).toEqual({ kind: "ask", question: "say /btw later" });
    expect(prefilled("\nwhy is X slow")).toEqual({ kind: "ask", question: "why is X slow" });
  });

  it("adds nothing when the draft already asks", () => {
    expect(sideQuestionPrefixFor("/btw why p-retry?")).toBe("");
    expect(sideQuestionPrefixFor("  /BTW why p-retry?")).toBe("");
    expect(sideQuestionPrefixFor("\n/btw")).toBe("");
    expect(sideQuestionPrefixFor("/btwx")).toBe("/btw ");
  });
});

describe("resolveVisibleSideQuestion", () => {
  const newest = shell("c");
  const middle = shell("b");
  const oldest = shell("a");
  const shells = [newest, middle, oldest];

  const viewing = (id: string | null) => ({ viewingThreadId: id as ThreadId | null });

  it("shows the newest question unless the user is browsing", () => {
    expect(resolveVisibleSideQuestion(shells, viewing(null))).toBe(newest);
    expect(resolveVisibleSideQuestion(shells, viewing("b"))).toBe(middle);
    // A deleted question falls back to the newest one left.
    expect(resolveVisibleSideQuestion(shells, viewing("missing"))).toBe(newest);
    expect(resolveVisibleSideQuestion([], viewing(null))).toBeNull();
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

describe("asking a side question", () => {
  const parentKey = "env:parent";
  const answered = shell("c", { runStatus: "completed" });
  const asked = shell("d", { runStatus: null });
  const view = () => selectSideQuestionView(useSideQuestionStore.getState(), parentKey);

  beforeEach(() => {
    useSideQuestionStore.setState({ byParentKey: {} });
    useSideQuestionStore.getState().showAsked(parentKey, "d" as ThreadId);
  });

  it("shows nothing, not the previous answer, until the new question syncs", () => {
    expect(resolveVisibleSideQuestion([answered], view())).toBeNull();
    expect(resolveVisibleSideQuestion([asked, answered], view())).toBe(asked);
  });

  it("goes back to the newest question when the ask fails", () => {
    useSideQuestionStore.getState().clearViewing(parentKey);
    expect(resolveVisibleSideQuestion([answered], view())).toBe(answered);
  });

  it("keeps a question browsed to before the new one arrives", () => {
    useSideQuestionStore.getState().show(parentKey, "c" as ThreadId);
    expect(resolveVisibleSideQuestion([asked, answered], view())).toBe(answered);
  });

  // What the card does when it first shows the asked question, and when it
  // leaves the thread.
  const settle = () => useSideQuestionStore.getState().settleAsked(parentKey);

  it("falls back to the newest question once the asked one is gone elsewhere", () => {
    expect(resolveVisibleSideQuestion([asked, answered], view())).toBe(asked);
    settle();
    // Deleted, or forked into a regular thread, from another client.
    expect(resolveVisibleSideQuestion([answered], view())).toBe(answered);
  });

  it("falls back to the newest question when the asked one came and went while away", () => {
    settle();
    // Arrived and was deleted elsewhere while another thread was on screen.
    expect(resolveVisibleSideQuestion([answered], view())).toBe(answered);
  });

  it("still shows the asked question when it lands after the user comes back", () => {
    settle();
    expect(resolveVisibleSideQuestion([asked, answered], view())).toBe(asked);
  });

  it("leaves storage alone when there is nothing to settle", () => {
    settle();
    const { storage } = useSideQuestionStore.persist.getOptions();
    const setItem = vi.spyOn(storage!, "setItem");
    settle();
    expect(setItem).not.toHaveBeenCalled();
    setItem.mockRestore();
  });

  it("forgets an ask that was in flight when the page reloaded", async () => {
    const { storage, name } = useSideQuestionStore.persist.getOptions();
    expect(await storage!.getItem(name!)).toMatchObject({
      state: { byParentKey: { [parentKey]: { viewingThreadId: "d" } } },
    });
    await useSideQuestionStore.persist.rehydrate();
    expect(view().justAsked).toBeUndefined();
    // Had it landed, the reloaded snapshot would hold it; it didn't, so the
    // newest question is the one to show.
    expect(resolveVisibleSideQuestion([answered], view())).toBe(answered);
  });

  it("drops a pending ask saved by an older build", async () => {
    const { storage, name } = useSideQuestionStore.persist.getOptions();
    const saved = { viewingThreadId: "d", justAsked: true, collapsed: false, hidden: false };
    await storage!.setItem(name!, {
      state: { byParentKey: { [parentKey]: saved } } as never,
      version: 0,
    });
    await useSideQuestionStore.persist.rehydrate();
    expect(view().justAsked).toBeUndefined();
    expect(resolveVisibleSideQuestion([answered], view())).toBe(answered);
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
