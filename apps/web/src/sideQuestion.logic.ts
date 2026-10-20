import {
  type EnvironmentThreadShell,
  threadRuntimeIsActive,
} from "@t3tools/client-runtime/state/models";
import type { ThreadId } from "@t3tools/contracts";

export type SideQuestionCommand =
  | { readonly kind: "ask"; readonly question: string }
  | { readonly kind: "cycle" };

/** `/btw <question>` asks; a bare `/btw` walks through the questions already asked. */
export function parseSideQuestionCommand(prompt: string): SideQuestionCommand | null {
  const match = /^\/btw(?:\s+([\s\S]*))?$/i.exec(prompt.trim());
  if (match === null) return null;
  const question = (match[1] ?? "").trim();
  return question === "" ? { kind: "cycle" } : { kind: "ask", question };
}

type SideQuestionShell = Pick<EnvironmentThreadShell, "id" | "latestRun" | "runtime">;

/** The card shows the newest question, unless the user walked back to an earlier one. */
export function resolveVisibleSideQuestion<T extends SideQuestionShell>(
  shells: ReadonlyArray<T>,
  viewingThreadId: ThreadId | null,
): T | null {
  if (viewingThreadId !== null) {
    const viewing = shells.find((shell) => shell.id === viewingThreadId);
    if (viewing !== undefined) return viewing;
  }
  return shells[0] ?? null;
}

/** Newest to oldest, wrapping back to the newest after the last one. */
export function nextSideQuestionToView<T extends SideQuestionShell>(
  shells: ReadonlyArray<T>,
  currentThreadId: ThreadId | null,
): T | null {
  if (shells.length === 0) return null;
  const index = currentThreadId === null ? -1 : shells.findIndex((s) => s.id === currentThreadId);
  return shells[(index + 1) % shells.length] ?? null;
}

export type SideQuestionActivity = "thinking" | "answered" | "failed" | "interrupted";

export function sideQuestionActivity(shell: SideQuestionShell): SideQuestionActivity {
  if (threadRuntimeIsActive(shell.runtime)) return "thinking";
  const run = shell.latestRun;
  if (run === null) return "thinking";
  switch (run.status) {
    case "completed":
      return "answered";
    case "failed":
      return "failed";
    case "preparing":
    case "queued":
    case "starting":
    case "running":
    case "waiting":
      return "thinking";
    default:
      return "interrupted";
  }
}
