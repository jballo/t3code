import { CommandId, type OrchestrationV2DomainEvent } from "@t3tools/contracts";
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
 *   promoted one has already dropped the flag and stays.
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
  }
>()("t3/orchestration-v2/SideQuestionReactor") {}

const make = Effect.gen(function* () {
  const engine = yield* Orchestrator.OrchestratorV2;
  const projections = yield* ProjectionStore.ProjectionStoreV2;

  const handle: SideQuestionReactor["Service"]["handle"] = (event) =>
    Effect.gen(function* () {
      if (event.type === "thread.deleted") {
        const children = yield* projections.getSideQuestionChildThreadIds(event.threadId);
        for (const childThreadId of children) {
          yield* engine.dispatch({
            type: "thread.delete",
            commandId: CommandId.make(
              `server:side-question-cascade:${event.threadId}:${childThreadId}`,
            ),
            threadId: childThreadId,
          });
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

  const start: SideQuestionReactor["Service"]["start"] = () =>
    forkParked(
      Stream.runForEach(engine.streamDomainEvents, handle).pipe(
        Effect.catchCause((cause) =>
          Effect.logWarning("side question event stream failed", { cause }),
        ),
      ),
    );

  return { start, handle } satisfies SideQuestionReactor["Service"];
});

export const layer = Layer.effect(SideQuestionReactor, make);
