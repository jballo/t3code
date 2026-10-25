import { EnvironmentId, ProjectId, ProviderInstanceId, ThreadId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { DEFAULT_INTERACTION_MODE, DEFAULT_RUNTIME_MODE, type Thread } from "./types";
import { makeThreadFixture } from "./test-fixtures";
import { getOrphanedWorktreePathForThread } from "./worktreeCleanup";

const localEnvironmentId = EnvironmentId.make("environment-local");

function makeThread(overrides: Partial<Thread> = {}): Thread {
  return makeThreadFixture({
    id: ThreadId.make("thread-1"),
    environmentId: localEnvironmentId,
    projectId: ProjectId.make("project-1"),
    title: "Thread",
    modelSelection: {
      instanceId: ProviderInstanceId.make("codex"),
      model: "gpt-5.3-codex",
    },
    runtimeMode: DEFAULT_RUNTIME_MODE,
    interactionMode: DEFAULT_INTERACTION_MODE,
    runtime: null,
    messages: [],
    proposedPlans: [],
    createdAt: "2026-02-13T00:00:00.000Z",
    updatedAt: "2026-02-13T00:00:00.000Z",
    archivedAt: null,
    settledOverride: null,
    settledAt: null,
    deletedAt: null,
    latestRun: null,
    branch: null,
    worktreePath: null,
    ...overrides,
  });
}

describe("getOrphanedWorktreePathForThread", () => {
  it("returns null when another thread links to the same worktree", () => {
    const threads = [
      makeThread({
        id: ThreadId.make("thread-1"),
        worktreePath: "/tmp/repo/worktrees/feature-a",
      }),
      makeThread({
        id: ThreadId.make("thread-2"),
        worktreePath: "/tmp/repo/worktrees/feature-a",
      }),
    ];
    const result = getOrphanedWorktreePathForThread(threads, ThreadId.make("thread-1"));
    expect(result).toBeNull();
  });

  it("ignores threads linked to different worktrees", () => {
    const threads = [
      makeThread({
        id: ThreadId.make("thread-1"),
        worktreePath: "/tmp/repo/worktrees/feature-a",
      }),
      makeThread({
        id: ThreadId.make("thread-2"),
        worktreePath: "/tmp/repo/worktrees/feature-b",
      }),
    ];
    const result = getOrphanedWorktreePathForThread(threads, ThreadId.make("thread-1"));
    expect(result).toBe("/tmp/repo/worktrees/feature-a");
  });

  describe("side questions", () => {
    const worktreePath = "/tmp/repo/worktrees/feature-a";
    const sideQuestionOf = (id: string, parentId: string) =>
      makeThread({
        id: ThreadId.make(id),
        worktreePath,
        sideChat: true,
        lineage: {
          rootThreadId: ThreadId.make(parentId),
          parentThreadId: ThreadId.make(parentId),
          relationshipToParent: null,
        },
      });

    it("does not count the target's own side questions, which are deleted with it", () => {
      const threads = [
        makeThread({ id: ThreadId.make("thread-1"), worktreePath }),
        sideQuestionOf("side-1", "thread-1"),
        sideQuestionOf("side-2", "thread-1"),
      ];
      const result = getOrphanedWorktreePathForThread(threads, ThreadId.make("thread-1"));
      expect(result).toBe(worktreePath);
    });

    it("counts a side question whose parent is not being deleted", () => {
      const threads = [
        makeThread({ id: ThreadId.make("thread-1"), worktreePath }),
        makeThread({ id: ThreadId.make("thread-2"), worktreePath: "/tmp/repo/worktrees/other" }),
        sideQuestionOf("side-2", "thread-2"),
      ];
      const result = getOrphanedWorktreePathForThread(threads, ThreadId.make("thread-1"));
      expect(result).toBeNull();
    });

    it("still counts an unrelated thread on the same worktree", () => {
      const threads = [
        makeThread({ id: ThreadId.make("thread-1"), worktreePath }),
        sideQuestionOf("side-1", "thread-1"),
        makeThread({ id: ThreadId.make("thread-2"), worktreePath }),
      ];
      const result = getOrphanedWorktreePathForThread(threads, ThreadId.make("thread-1"));
      expect(result).toBeNull();
    });

    it("ignores threads already deleted in the same batch and their side questions", () => {
      const threads = [
        makeThread({ id: ThreadId.make("thread-1"), worktreePath }),
        makeThread({ id: ThreadId.make("thread-2"), worktreePath }),
        sideQuestionOf("side-2", "thread-2"),
      ];
      const result = getOrphanedWorktreePathForThread(
        threads,
        ThreadId.make("thread-1"),
        new Set([ThreadId.make("thread-2")]),
      );
      expect(result).toBe(worktreePath);
    });
  });
});
