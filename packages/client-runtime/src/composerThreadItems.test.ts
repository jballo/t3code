import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { matchComposerThreadItems } from "./composerThreadItems.ts";

const environmentId = EnvironmentId.make("environment");
const candidate = (id: string, sideChat: boolean) => ({
  environmentId,
  id: ThreadId.make(id),
  title: `Retry config ${id}`,
  updatedAt: "2026-10-22T00:00:00.000Z",
  archivedAt: null,
  sideChat,
});

describe("matchComposerThreadItems", () => {
  it("leaves side questions out and lists a forked one", () => {
    const items = matchComposerThreadItems({
      shells: [candidate("thread", false), candidate("side", true), candidate("forked", false)],
      environmentId,
      excludeThreadId: null,
      query: "retry",
    });
    expect(items.map((item) => item.thread.threadId).toSorted()).toEqual(["forked", "thread"]);
  });
});
