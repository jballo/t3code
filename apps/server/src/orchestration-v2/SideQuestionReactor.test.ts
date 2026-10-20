import { assert, it } from "@effect/vitest";
import {
  EventId,
  NodeId,
  type OrchestrationV2AppThread,
  type OrchestrationV2DomainEvent,
  type OrchestrationV2RuntimeRequest,
  type OrchestrationV2ServerCommand,
  ProjectId,
  ProviderInstanceId,
  ProviderSessionId,
  RuntimeRequestId,
  ThreadId,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";

import * as Orchestrator from "./Orchestrator.ts";
import * as ProjectionStore from "./ProjectionStore.ts";
import * as SideQuestionReactor from "./SideQuestionReactor.ts";

const now = DateTime.makeUnsafe("2026-10-19T00:00:00.000Z");
const sideThreadId = ThreadId.make("thread:side-question");
const ordinaryThreadId = ThreadId.make("thread:ordinary");

function makeThread(id: ThreadId, sideChat: boolean): OrchestrationV2AppThread {
  return {
    createdBy: "user",
    creationSource: "web",
    id,
    projectId: ProjectId.make("project:side-question"),
    title: "t",
    providerInstanceId: ProviderInstanceId.make("codex"),
    modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5.5" },
    runtimeMode: "approval-required",
    interactionMode: "default",
    branch: null,
    worktreePath: null,
    activeProviderThreadId: null,
    sideChat,
    lineage: { parentThreadId: null, relationshipToParent: null, rootThreadId: id },
    forkedFrom: null,
    createdAt: now,
    updatedAt: now,
    archivedAt: null,
    settledOverride: null,
    settledAt: null,
    lastVisitedAt: null,
    deletedAt: null,
  };
}

function requestEvent(input: {
  readonly threadId: ThreadId;
  readonly kind: OrchestrationV2RuntimeRequest["kind"];
  readonly status?: OrchestrationV2RuntimeRequest["status"];
  readonly live?: boolean;
}): OrchestrationV2DomainEvent {
  const id = RuntimeRequestId.make(`request:${input.threadId}:${input.kind}`);
  return {
    id: EventId.make(`event:${id}`),
    threadId: input.threadId,
    occurredAt: now,
    type: "runtime-request.updated",
    payload: {
      id,
      nodeId: NodeId.make("node:1"),
      providerTurnId: null,
      nativeRequestRef: null,
      kind: input.kind,
      status: input.status ?? "pending",
      responseCapability:
        input.live === false
          ? { type: "message" }
          : { type: "live", providerSessionId: ProviderSessionId.make("session:1") },
      createdAt: now,
      resolvedAt: null,
    },
  };
}

const summarize = (commands: ReadonlyArray<OrchestrationV2ServerCommand>) =>
  commands.map((command) => ({
    type: command.type,
    threadId: "threadId" in command ? command.threadId : null,
  }));

function layerFor(commands: Array<OrchestrationV2ServerCommand>) {
  return SideQuestionReactor.layer.pipe(
    Layer.provide(
      Layer.mergeAll(
        Layer.mock(Orchestrator.OrchestratorV2)({
          streamDomainEvents: Stream.empty,
          dispatch: (command) => {
            commands.push(command);
            return Effect.succeed({ sequence: commands.length, storedEvents: [] });
          },
        }),
        Layer.mock(ProjectionStore.ProjectionStoreV2)({
          getThread: (threadId) => Effect.succeed(makeThread(threadId, threadId === sideThreadId)),
          getSideQuestionChildThreadIds: (parentThreadId) =>
            Effect.succeed(
              parentThreadId === ordinaryThreadId
                ? [sideThreadId, ThreadId.make("thread:side-question-2")]
                : [],
            ),
        }),
      ),
    ),
  );
}

it.effect("declines what a side question's provider asks, and dismisses its questions", () =>
  Effect.gen(function* () {
    const commands: Array<OrchestrationV2ServerCommand> = [];
    const reactor = yield* SideQuestionReactor.SideQuestionReactor.pipe(
      Effect.provide(layerFor(commands)),
    );

    yield* reactor.handle(requestEvent({ threadId: sideThreadId, kind: "command" }));
    yield* reactor.handle(requestEvent({ threadId: sideThreadId, kind: "user_input" }));
    // Nothing to do for an ordinary thread, a settled request, one answered by
    // message, or a provider credential refresh.
    yield* reactor.handle(requestEvent({ threadId: ordinaryThreadId, kind: "command" }));
    yield* reactor.handle(
      requestEvent({ threadId: sideThreadId, kind: "command", status: "resolved" }),
    );
    yield* reactor.handle(
      requestEvent({ threadId: sideThreadId, kind: "user_input", live: false }),
    );
    yield* reactor.handle(requestEvent({ threadId: sideThreadId, kind: "auth_refresh" }));

    assert.deepEqual(summarize(commands), [
      { type: "runtime-request.respond", threadId: sideThreadId },
      { type: "thread.user-input.dismiss", threadId: sideThreadId },
    ]);
    const respond = commands[0]!;
    assert.isTrue(respond.type === "runtime-request.respond" && respond.decision === "decline");
  }),
);

it.effect("deletes the side questions attached to a deleted thread", () =>
  Effect.gen(function* () {
    const commands: Array<OrchestrationV2ServerCommand> = [];
    const reactor = yield* SideQuestionReactor.SideQuestionReactor.pipe(
      Effect.provide(layerFor(commands)),
    );

    yield* reactor.handle({
      id: EventId.make("event:deleted"),
      threadId: ordinaryThreadId,
      occurredAt: now,
      type: "thread.deleted",
      payload: makeThread(ordinaryThreadId, false),
    });

    assert.deepEqual(summarize(commands), [
      { type: "thread.delete", threadId: sideThreadId },
      { type: "thread.delete", threadId: ThreadId.make("thread:side-question-2") },
    ]);
  }),
);
