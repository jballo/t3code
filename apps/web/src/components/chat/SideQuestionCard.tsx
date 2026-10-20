import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/models";
import type { EnvironmentId, ScopedThreadRef, ThreadId } from "@t3tools/contracts";
import { shouldPreserveAssistantLineBreaks } from "@t3tools/shared/markdownPipeline";
import {
  CheckCircle2Icon,
  ChevronDownIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  CircleAlertIcon,
  CircleStopIcon,
  LoaderCircleIcon,
  LockIcon,
  Trash2Icon,
} from "lucide-react";
import { useEffect, useState } from "react";

import { cn } from "~/lib/utils";
import ChatMarkdown from "../ChatMarkdown";
import { Button } from "../ui/button";
import { ComposerBanner } from "./ComposerBanner";
import { Tooltip, TooltipPopup, TooltipScrollDismissArea, TooltipTrigger } from "../ui/tooltip";
import { useThreadProjection } from "../../state/entities";
import { resolveVisibleSideQuestion, sideQuestionActivity } from "../../sideQuestion.logic";
import { selectSideQuestionView, useSideQuestionStore } from "../../sideQuestionStore";

const TOOL_ITEM_TYPES = new Set([
  "command_execution",
  "file_search",
  "web_search",
  "file_change",
  "dynamic_tool",
  "error",
]);

/**
 * The answer to a `/btw` question, as a frosted island floating at the right of
 * the composer, three quarters of its width. It sits in the composer stack's
 * flow rather than the timeline: as a timeline row it would move the
 * end-of-thread anchor every time it grew, and in the stack the overlay's
 * measurement already pushes the timeline's bottom inset by the island's
 * height, so it never covers the last message.
 */
export function SideQuestionCard(props: {
  readonly parentKey: string;
  /**
   * The thread on screen. File and preview links in the answer open in this
   * thread's panels; the side question's own thread is never on screen.
   */
  readonly parentThreadRef: ScopedThreadRef;
  readonly environmentId: EnvironmentId;
  readonly shells: ReadonlyArray<EnvironmentThreadShell>;
  readonly markdownCwd: string | undefined;
  readonly timelineAtEnd: boolean;
  /** Wheel-down over this element while the timeline is at its end unfolds a folded card. */
  readonly revealTarget: HTMLElement | null;
  readonly onFork: (threadId: ThreadId) => void;
  readonly onDelete: (threadId: ThreadId) => void;
}) {
  const { parentKey, environmentId, shells, timelineAtEnd, revealTarget } = props;
  const view = useSideQuestionStore((state) => selectSideQuestionView(state, parentKey));
  const setCollapsed = useSideQuestionStore((state) => state.setCollapsed);
  const show = useSideQuestionStore((state) => state.show);
  const hide = useSideQuestionStore((state) => state.hide);
  const visible = resolveVisibleSideQuestion(shells, view.viewingThreadId);
  const childRef = visible === null ? null : scopeThreadRef(environmentId, visible.id);
  const projection = useThreadProjection(childRef);
  const collapsed = view.collapsed;
  // Keyed by question so switching questions starts with the steps folded again.
  const [stepsOpenFor, setStepsOpenFor] = useState<ThreadId | null>(null);

  useEffect(() => {
    if (revealTarget === null || !collapsed || !timelineAtEnd || visible === null) return;
    const onWheel = (event: WheelEvent) => {
      if (event.deltaY > 0) setCollapsed(parentKey, false);
    };
    revealTarget.addEventListener("wheel", onWheel, { passive: true });
    return () => revealTarget.removeEventListener("wheel", onWheel);
  }, [collapsed, parentKey, revealTarget, setCollapsed, timelineAtEnd, visible]);

  // Dismissed hides the card, not the questions: /btw brings it back.
  if (visible === null || view.hidden) return null;

  const items = projection?.projection.visibleTurnItems ?? [];
  const answer = items.findLast((row) => row.item.type === "assistant_message")?.item;
  const answerText = answer?.type === "assistant_message" ? answer.text : "";
  const answerStreaming = answer !== undefined && answer.status === "running";
  const tools = items.filter((row) => TOOL_ITEM_TYPES.has(row.item.type));
  const activity = sideQuestionActivity(visible);
  const running = activity === "thinking";
  const failure = items.findLast((row) => row.item.type === "error")?.item;
  const failureMessage = failure?.type === "error" ? failure.failure.message : null;
  const stepsOpen = stepsOpenFor === visible.id;
  const currentStep = tools.findLast((row) => row.item.status === "running");
  // Shells run newest first, so "1 / 3" is the latest question and the right
  // arrow goes back in time.
  const position = shells.findIndex((shell) => shell.id === visible.id);
  const newer = position > 0 ? shells[position - 1] : undefined;
  const older = shells[position + 1];
  const toggle = () => setCollapsed(parentKey, !collapsed);

  return (
    // The empty strip beside the island stays click-through to the timeline.
    <div className="pointer-events-none mb-2 flex justify-end @container">
      <ComposerBanner.Root
        placement="floating"
        // Open, it is read like a message, so it gets the roomier padding;
        // folded it stays a slim line.
        density={collapsed ? "comfortable" : "spacious"}
        role="region"
        aria-label="Side question"
        data-side-question-card
        className="pointer-events-auto w-full @xl:w-3/4"
        onKeyDown={(event) => {
          if (event.key === "Escape" && !collapsed) {
            event.stopPropagation();
            setCollapsed(parentKey, true);
          }
        }}
      >
        <ComposerBanner.Row
          className={cn(!collapsed && "items-start")}
          onKeyDown={(event) => {
            const target =
              event.key === "ArrowLeft" ? newer : event.key === "ArrowRight" ? older : undefined;
            if (target === undefined) return;
            event.preventDefault();
            show(parentKey, target.id);
          }}
        >
          <ComposerBanner.Icon className="h-(--composer-banner-icon-column)">
            {activity === "thinking" ? (
              <LoaderCircleIcon className="animate-spin" />
            ) : activity === "answered" ? (
              <CheckCircle2Icon className="text-success" />
            ) : activity === "interrupted" ? (
              <CircleStopIcon />
            ) : (
              <CircleAlertIcon className="text-destructive-foreground" />
            )}
          </ComposerBanner.Icon>
          <ComposerBanner.Content>
            <button
              type="button"
              className="flex min-w-0 flex-1 cursor-pointer items-center gap-1 rounded-md text-left focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring"
              aria-expanded={!collapsed}
              aria-label={`${collapsed ? "Show" : "Hide"} the answer to: ${visible.title}`}
              onClick={toggle}
              onPointerDown={(event) => event.preventDefault()}
            >
              {/* Expanded, the question wraps to two lines. The padding centers its first
                  line in the icon column (7 below sm, 6 from sm), level with the icon. */}
              <span
                className={cn(
                  "min-w-0 flex-1 text-sm font-medium text-foreground",
                  collapsed ? "truncate" : "line-clamp-2 py-1 sm:py-0.5",
                )}
              >
                {visible.title}
              </span>
              {collapsed && running ? (
                // The question gives way first, so the step stays readable.
                <span className="min-w-0 max-w-1/2 shrink-0 truncate font-mono text-xs text-muted-foreground">
                  ·{" "}
                  {currentStep === undefined
                    ? "Thinking…"
                    : (currentStep.item.title ?? currentStep.item.type)}
                </span>
              ) : null}
            </button>
          </ComposerBanner.Content>
          <ComposerBanner.Actions className="h-(--composer-banner-icon-column) flex-nowrap gap-0.5">
            {shells.length > 1 && !collapsed ? (
              <Button
                type="button"
                variant="ghost-muted"
                size="icon-xs"
                aria-label="Newer side question"
                disabled={newer === undefined}
                onClick={() => newer !== undefined && show(parentKey, newer.id)}
                onPointerDown={(event) => event.preventDefault()}
              >
                <ChevronLeftIcon aria-hidden />
              </Button>
            ) : null}
            {shells.length > 1 ? (
              <ComposerBanner.Count
                aria-label={`Side question ${position + 1} of ${shells.length}`}
              >
                {position + 1} / {shells.length}
              </ComposerBanner.Count>
            ) : null}
            {shells.length > 1 && !collapsed ? (
              <Button
                type="button"
                variant="ghost-muted"
                size="icon-xs"
                aria-label="Older side question"
                disabled={older === undefined}
                onClick={() => older !== undefined && show(parentKey, older.id)}
                onPointerDown={(event) => event.preventDefault()}
              >
                <ChevronRightIcon aria-hidden />
              </Button>
            ) : null}
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              tabIndex={-1}
              aria-hidden
              onClick={toggle}
              onPointerDown={(event) => event.preventDefault()}
            >
              <ChevronDownIcon className={cn("size-3.5", collapsed && "rotate-180")} />
            </Button>
          </ComposerBanner.Actions>
        </ComposerBanner.Row>
        {collapsed ? null : (
          <>
            {/* File links in the answer show their path on hover; scrolling the answer
                must close that tooltip, or it stays behind where the link used to be. */}
            <TooltipScrollDismissArea>
              <ComposerBanner.Scroll>
                <ComposerBanner.Body className="pt-1 pe-2 text-sm">
                  {/* Steps show live while it works, then fold so they never push
                      the answer down. */}
                  {tools.length > 0 ? (
                    <div className="mb-2 font-mono text-xs text-muted-foreground">
                      {running ? null : (
                        <button
                          type="button"
                          className="flex items-center gap-1 rounded-sm hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
                          aria-expanded={stepsOpen}
                          onClick={() => setStepsOpenFor(stepsOpen ? null : visible.id)}
                        >
                          <ChevronRightIcon
                            aria-hidden
                            className={cn("size-3", stepsOpen && "rotate-90")}
                          />
                          {tools.length} {tools.length === 1 ? "step" : "steps"}
                        </button>
                      )}
                      {running || stepsOpen ? (
                        <ul className={cn("flex flex-col gap-0.5", !running && "mt-0.5 ps-4")}>
                          {tools.map((row) => (
                            <li key={row.sourceItemId} className="truncate">
                              {row.item.title ?? row.item.type}
                              {row.item.status === "running" ? " …" : ""}
                            </li>
                          ))}
                        </ul>
                      ) : null}
                    </div>
                  ) : null}
                  {answerText !== "" ? (
                    <ChatMarkdown
                      text={answerText}
                      cwd={props.markdownCwd}
                      threadRef={props.parentThreadRef}
                      environmentId={environmentId}
                      isStreaming={answerStreaming}
                      lineBreaks={shouldPreserveAssistantLineBreaks(answerText)}
                    />
                  ) : failureMessage !== null && activity === "failed" ? (
                    <p className="text-destructive-foreground">{failureMessage}</p>
                  ) : activity === "interrupted" ? (
                    <p className="text-muted-foreground">
                      Stopped before it finished. Ask again with /btw.
                    </p>
                  ) : (
                    <p className="text-muted-foreground">
                      {running ? "Reading the thread…" : "No answer was produced."}
                    </p>
                  )}
                </ComposerBanner.Body>
              </ComposerBanner.Scroll>
            </TooltipScrollDismissArea>
            <ComposerBanner.Row className="mt-1 border-t border-border/60 pt-1">
              <ComposerBanner.Content>
                {/* Kept at the far end from Fork and Dismiss so a quick click can't delete. */}
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <Button
                        type="button"
                        variant="ghost-muted"
                        size="icon-xs"
                        aria-label="Delete this side question"
                        onClick={() => props.onDelete(visible.id)}
                      />
                    }
                  >
                    <Trash2Icon aria-hidden />
                  </TooltipTrigger>
                  <TooltipPopup side="top">Delete this side question</TooltipPopup>
                </Tooltip>
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <span
                        tabIndex={0}
                        aria-label="Read-only"
                        className="inline-flex items-center px-1 text-muted-foreground"
                      />
                    }
                  >
                    <LockIcon aria-hidden className="size-3.5" />
                  </TooltipTrigger>
                  <TooltipPopup side="top">
                    Side questions can read the workspace but never change it
                  </TooltipPopup>
                </Tooltip>
              </ComposerBanner.Content>
              <ComposerBanner.Actions>
                <Button
                  type="button"
                  variant="ghost-muted"
                  size="compact"
                  onClick={() => props.onFork(visible.id)}
                >
                  Fork
                </Button>
                <Button
                  type="button"
                  variant="ghost-muted"
                  size="compact"
                  onClick={() => hide(parentKey)}
                >
                  Dismiss
                </Button>
              </ComposerBanner.Actions>
            </ComposerBanner.Row>
          </>
        )}
      </ComposerBanner.Root>
    </div>
  );
}
