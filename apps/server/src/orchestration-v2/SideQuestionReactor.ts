import { CommandId, type OrchestrationV2DomainEvent, type ThreadId } from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import type * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";

import { forkParked } from "../serverActivation.ts";
import * as Orchestrator from "./Orchestrator.ts";
import * as ProjectionStore from "./ProjectionStore.ts";

/**
 * Two rules that keep a side question disposable, enforced on the server so
 * they hold for every client and provider:
 *
 * - Deleting a thread deletes the side questions still attached to it. A
 *   promoted one has already dropped the flag and stays. The live event
 *   stream starts at the newest event, so each start also deletes those left
 *   behind by a delete the server stopped before reacting to.
 * - A side question never waits on a person. Its card has no composer, so a
 *   request a provider raises anyway (an adapter that only reads the mode, or
 *   a tool the sandbox does not cover) is declined the moment it appears
 *   instead of sitting pending in a hidden thread.
 */
export class SideQuestionReactor extends Context.Service<
  SideQuestionReactor,
  {
    readonly start: () => Effect.Effect<void, never, Scope.Scope>;
    readonly handle: (event: OrchestrationV2DomainEvent) => Effect.Effect<void>;
    readonly reconcile: () => Effect.Effect<void>;
  }
>()("t3/orchestration-v2/SideQuestionReactor") {}

const make = Effect.gen(function* () {
  const engine = yield* Orchestrator.OrchestratorV2;
  const projections = yield* ProjectionStore.ProjectionStoreV2;

  // The live delete and the startup sweep share a command id per side question,
  // so whichever comes second replays the first's receipt.
  const deleteSideQuestion = (parentThreadId: ThreadId, threadId: ThreadId) =>
    engine.dispatch({
      type: "thread.delete",
      commandId: CommandId.make(`server:side-question-cascade:${parentThreadId}:${threadId}`),
      threadId,
    });

  const handle: SideQuestionReactor["Service"]["handle"] = (event) =>
    Effect.gen(function* () {
      if (event.type === "thread.deleted") {
        const children = yield* projections.getSideQuestionChildThreadIds(event.threadId);
        for (const childThreadId of children) {
          yield* deleteSideQuestion(event.threadId, childThreadId);
        }
        return;
      }
      if (
        event.type !== "runtime-request.updated" ||
        event.payload.status !== "pending" ||
        event.payload.responseCapability.type !== "live" ||
        event.payload.kind === "auth_refresh"
      ) {
        return;
      }
      const thread = yield* projections.getThread(event.threadId);
      if (thread.sideChat !== true) return;
      const commandId = CommandId.make(
        `server:side-question-decline:${event.threadId}:${event.payload.id}`,
      );
      if (event.payload.kind === "user_input") {
        yield* engine.dispatch({
          type: "thread.user-input.dismiss",
          commandId,
          threadId: event.threadId,
          requestId: event.payload.id,
        });
        return;
      }
      yield* engine.dispatch({
        type: "runtime-request.respond",
        commandId,
        threadId: event.threadId,
        requestId: event.payload.id,
        decision: "decline",
      });
    }).pipe(
      Effect.catchCause((cause) =>
        Effect.logWarning("side question reaction failed", {
          eventType: event.type,
          threadId: event.threadId,
          cause,
        }),
      ),
    );

  const reconcile: SideQuestionReactor["Service"]["reconcile"] = () =>
    projections.getOrphanedSideQuestions().pipe(
      Effect.flatMap((orphans) =>
        Effect.forEach(
          orphans,
          ({ parentThreadId, threadId }) =>
            deleteSideQuestion(parentThreadId, threadId).pipe(
              Effect.catchCause((cause) =>
                Effect.logWarning("side question cleanup failed", { threadId, cause }),
              ),
            ),
          { discard: true },
        ),
      ),
      Effect.catchCause((cause) => Effect.logWarning("side question cleanup failed", { cause })),
    );

  const start: SideQuestionReactor["Service"]["start"] = () =>
    forkParked(
      Effect.gen(function* () {
        // A delete that lands while the stream is still subscribing can miss
        // both; every start sweeps, so the next one deletes what it left.
        yield* Effect.forkScoped(
          Stream.runForEach(engine.streamDomainEvents, handle).pipe(
            Effect.catchCause((cause) =>
              Effect.logWarning("side question event stream failed", { cause }),
            ),
          ),
        );
        yield* reconcile();
      }),
    );

  return { start, handle, reconcile } satisfies SideQuestionReactor["Service"];
});

export const layer = Layer.effect(SideQuestionReactor, make);
