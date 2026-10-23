import type { ThreadShell } from "./types";

function normalizeWorktreePath(path: string | null): string | null {
  const trimmed = path?.trim();
  if (!trimmed) {
    return null;
  }
  return trimmed;
}

/**
 * `deletedThreadIds` are threads already deleted earlier in the same batch,
 * which may still be in the client's list. The server deletes a thread's
 * attached side questions with it, so they never keep the worktree alive.
 */
export function getOrphanedWorktreePathForThread(
  threads: ReadonlyArray<Pick<ThreadShell, "id" | "worktreePath" | "sideChat" | "lineage">>,
  threadId: ThreadShell["id"],
  deletedThreadIds: ReadonlySet<ThreadShell["id"]> = new Set(),
): string | null {
  const targetThread = threads.find((thread) => thread.id === threadId);
  if (!targetThread) {
    return null;
  }

  const targetWorktreePath = normalizeWorktreePath(targetThread.worktreePath);
  if (!targetWorktreePath) {
    return null;
  }

  const isDeleted = (id: ThreadShell["id"] | null) =>
    id === threadId || (id !== null && deletedThreadIds.has(id));
  const isShared = threads.some((thread) => {
    if (isDeleted(thread.id) || (thread.sideChat && isDeleted(thread.lineage.parentThreadId))) {
      return false;
    }
    return normalizeWorktreePath(thread.worktreePath) === targetWorktreePath;
  });

  return isShared ? null : targetWorktreePath;
}

export function formatWorktreePathForDisplay(worktreePath: string): string {
  const trimmed = worktreePath.trim();
  if (!trimmed) {
    return worktreePath;
  }

  const normalized = trimmed.replace(/\\/g, "/").replace(/\/+$/, "");
  const parts = normalized.split("/");
  const lastPart = parts[parts.length - 1]?.trim() ?? "";
  return lastPart.length > 0 ? lastPart : trimmed;
}
