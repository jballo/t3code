import {
  type EnvironmentThreadShell,
  threadRuntimeIsActive,
} from "@t3tools/client-runtime/state/models";
import { commandDisplayText } from "@t3tools/client-runtime/work-log/command-label";
import type { OrchestrationV2TurnItem, ThreadId } from "@t3tools/contracts";
import { resolveT3McpToolDefinition } from "@t3tools/shared/t3McpToolPresentation";
import { collectToolFilePaths, dynamicToolTitle } from "@t3tools/shared/toolActivity";

import { providerErrorPresentation } from "./session-logic";

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

/** Only a prompt that starts with `/btw` asks, so the shortcut prefixes the draft rather than appending. */
export function sideQuestionPrefixFor(prompt: string): string {
  return parseSideQuestionCommand(prompt) === null ? "/btw " : "";
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

/** The question that takes a deleted one's place: the older neighbor, else the newer one. */
export function sideQuestionAfterDelete<T extends SideQuestionShell>(
  shells: ReadonlyArray<T>,
  deletedThreadId: ThreadId,
): T | null {
  const index = shells.findIndex((shell) => shell.id === deletedThreadId);
  if (index === -1) return null;
  return shells[index + 1] ?? shells[index - 1] ?? null;
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

// Claude titles its steps; Codex sends untitled items, so name them by what they
// act on, the way the thread's own work log does.
export function sideQuestionStepTitle(item: OrchestrationV2TurnItem): string {
  // The command says more than its title, which some providers set to just
  // the tool's name ("bash").
  if (item.type === "command_execution" && item.input.trim() !== "") {
    return commandDisplayText(item.input);
  }
  // Muse and Pi title a tool step with just its name ("read_file"), which
  // hides the file it acts on.
  const title = item.type === "dynamic_tool" && item.title === item.toolName ? null : item.title;
  if (title) return title;
  switch (item.type) {
    case "command_execution":
      return "Run a command";
    case "file_change":
      return `Edit ${item.fileName}`;
    case "file_search":
      return item.pattern === undefined ? "Search files" : `Search ${item.pattern}`;
    case "web_search":
      return item.patterns?.[0] === undefined ? "Search the web" : `Search ${item.patterns[0]}`;
    case "dynamic_tool": {
      const named =
        resolveT3McpToolDefinition(item.toolName)?.displayName ??
        dynamicToolTitle(item.toolName, item.input, item.title);
      if (named !== undefined) return named;
      const path = collectToolFilePaths({ input: item.input })[0];
      if (item.toolName === null) return path === undefined ? "Tool call" : path;
      return path === undefined ? item.toolName : `${item.toolName} ${path}`;
    }
    case "error":
      return providerErrorPresentation(item).label;
    default:
      return item.type;
  }
}
