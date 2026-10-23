import {
  CommandId,
  type MessageId,
  type OrchestrationV2Actor,
  type OrchestrationV2CreationSource,
  sideQuestionTitle,
  ThreadId,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";

import { buildSideQuestionPrompt } from "./SideQuestionContext.ts";
import * as ThreadManagementService from "./ThreadManagementService.ts";

/** How much of the parent's tail the snapshot reads before the character budget trims it. */
const TIMELINE_ITEM_LIMIT = 400;

export class SideQuestionParentUnavailableError extends Schema.TaggedError<SideQuestionParentUnavailableError>()(
  "SideQuestionParentUnavailableError",
  {
    parentThreadId: ThreadId,
    reason: Schema.Literals(["not_found", "deleted", "side_question", "provider_disabled"]),
  },
) {
  override get message(): string {
    switch (this.reason) {
      case "not_found":
        return "That thread no longer exists.";
      case "deleted":
        return "That thread was deleted.";
      case "side_question":
        return "A side question cannot be asked about another side question.";
      case "provider_disabled":
        return "This thread's provider is turned off. Turn it on in Settings → Providers to ask a side question.";
    }
  }
}

export class SideQuestionAskError extends Schema.TaggedError<SideQuestionAskError>()(
  "SideQuestionAskError",
  {
    parentThreadId: ThreadId,
    stage: Schema.Literals(["load_parent", "create_thread", "dispatch_question"]),
    cause: Schema.Defect(),
  },
) {
  override get message(): string {
    switch (this.stage) {
      case "load_parent":
        return "Failed to read the thread for a side question.";
      case "create_thread":
        return "Failed to start the side question.";
      case "dispatch_question":
        return "Failed to send the side question.";
    }
  }
}

export interface SideQuestionAskInput {
  readonly parentThreadId: ThreadId;
  readonly question: string;
  readonly threadId: ThreadId;
  readonly messageId: MessageId;
  readonly commandId: CommandId;
  readonly createdBy: OrchestrationV2Actor;
  readonly creationSource: OrchestrationV2CreationSource;
}

export class SideQuestionService extends Context.Service<
  SideQuestionService,
  {
    /**
     * Starts a hidden child thread under the parent and sends it the parent's
     * transcript plus the question. The child runs read-only through the
     * runtime policy, so the parent's worktree is never written from here.
     */
    readonly ask: (
      input: SideQuestionAskInput,
    ) => Effect.Effect<
      { readonly threadId: ThreadId },
      SideQuestionParentUnavailableError | SideQuestionAskError
    >;
  }
>()("t3/orchestration-v2/SideQuestionService") {}

const make = Effect.gen(function* () {
  const threadManagement = yield* ThreadManagementService.ThreadManagementService;

  const ask: SideQuestionService["Service"]["ask"] = Effect.fn("SideQuestionService.ask")(
    function* (input) {
      const askError = (stage: SideQuestionAskError["stage"]) => (cause: unknown) =>
        new SideQuestionAskError({ parentThreadId: input.parentThreadId, stage, cause });

      const parent = yield* threadManagement.getThreadRecords(input.parentThreadId, []).pipe(
        Effect.map((records) => records.thread),
        Effect.mapError((cause) =>
          cause._tag === "OrchestratorProjectionError" &&
          cause.cause !== undefined &&
          typeof cause.cause === "object" &&
          cause.cause !== null &&
          "_tag" in cause.cause &&
          cause.cause._tag === "ProjectionStoreThreadNotFoundError"
            ? new SideQuestionParentUnavailableError({
                parentThreadId: input.parentThreadId,
                reason: "not_found",
              })
            : askError("load_parent")(cause),
        ),
      );
      if (parent.deletedAt !== null) {
        return yield* new SideQuestionParentUnavailableError({
          parentThreadId: input.parentThreadId,
          reason: "deleted",
        });
      }
      if (parent.sideChat === true) {
        return yield* new SideQuestionParentUnavailableError({
          parentThreadId: input.parentThreadId,
          reason: "side_question",
        });
      }

      // Sending the question checks this too, but only after the child exists,
      // which would leave a side question with no run spinning in the card.
      yield* threadManagement
        .assertProviderInstanceEnabled({
          projectId: parent.projectId,
          commandId: input.commandId,
          instanceId: parent.modelSelection.instanceId,
        })
        .pipe(
          Effect.mapError(
            () =>
              new SideQuestionParentUnavailableError({
                parentThreadId: input.parentThreadId,
                reason: "provider_disabled",
              }),
          ),
        );

      const page = yield* threadManagement
        .getTimelinePage(parent.id, { view: "activity", limit: TIMELINE_ITEM_LIMIT, fromEnd: true })
        .pipe(Effect.mapError(askError("load_parent")));

      const text = buildSideQuestionPrompt({
        title: parent.title,
        items: page.items,
        question: input.question,
      });

      yield* threadManagement
        .dispatch({
          type: "thread.create",
          createdBy: input.createdBy,
          creationSource: input.creationSource,
          commandId: CommandId.make(`${input.commandId}:side-question-thread`),
          threadId: input.threadId,
          projectId: parent.projectId,
          title: sideQuestionTitle(input.question),
          modelSelection: parent.modelSelection,
          // RuntimePolicy makes every side-chat turn read-only whatever this says,
          // so it carries the parent's mode for after Fork, when the thread should
          // work like the one it came from.
          runtimeMode: parent.runtimeMode,
          interactionMode: "default",
          branch: parent.branch,
          worktreePath: parent.worktreePath,
          parentThreadId: parent.id,
          sideChat: true,
        })
        .pipe(Effect.mapError(askError("create_thread")));

      yield* threadManagement
        .dispatch({
          type: "message.dispatch",
          createdBy: input.createdBy,
          creationSource: input.creationSource,
          commandId: input.commandId,
          threadId: input.threadId,
          messageId: input.messageId,
          text,
          attachments: [],
          dispatchMode: { type: "start_immediately" },
        })
        .pipe(
          Effect.mapError(askError("dispatch_question")),
          // A child that never got its question would show as thinking forever.
          Effect.tapError(() =>
            threadManagement
              .dispatch({
                type: "thread.delete",
                commandId: CommandId.make(`${input.commandId}:side-question-cleanup`),
                threadId: input.threadId,
              })
              .pipe(
                Effect.catchCause((cause) =>
                  Effect.logWarning("Could not delete a side question that failed to send", {
                    threadId: input.threadId,
                    cause,
                  }),
                ),
              ),
          ),
        );

      return { threadId: input.threadId };
    },
  );

  return SideQuestionService.of({ ask });
});

export const layer = Layer.effect(SideQuestionService, make);
