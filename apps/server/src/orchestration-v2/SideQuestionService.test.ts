import { assert, it } from "@effect/vitest";
import {
  CommandId,
  MessageId,
  type OrchestrationV2AppThread,
  type OrchestrationV2ProjectedTurnItem,
  type OrchestrationV2ServerCommand,
  type OrchestrationV2TurnItem,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import * as Orchestrator from "./Orchestrator.ts";
import * as ProjectionStore from "./ProjectionStore.ts";
import * as SideQuestionService from "./SideQuestionService.ts";
import * as ThreadManagementService from "./ThreadManagementService.ts";

const projectId = ProjectId.make("project:side-question");
const parentId = ThreadId.make("thread:side-question-parent");
const modelSelection = { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5.5" };

function makeParent(overrides: Partial<OrchestrationV2AppThread> = {}): OrchestrationV2AppThread {
  const now = DateTime.makeUnsafe("2026-10-19T00:00:00.000Z");
  return {
    createdBy: "user",
    creationSource: "web",
    id: parentId,
    projectId,
    title: "upload retry with backoff",
    providerInstanceId: modelSelection.instanceId,
    modelSelection,
    runtimeMode: "full-access",
    interactionMode: "default",
    branch: "feat/retry",
    worktreePath: "/worktrees/retry",
    activeProviderThreadId: null,
    lineage: { parentThreadId: null, relationshipToParent: null, rootThreadId: parentId },
    forkedFrom: null,
    createdAt: now,
    updatedAt: now,
    archivedAt: null,
    settledOverride: null,
    settledAt: null,
    lastVisitedAt: null,
    deletedAt: null,
    ...overrides,
  };
}

const timeline: ReadonlyArray<OrchestrationV2ProjectedTurnItem> = [
  {
    position: 0,
    visibility: "local",
    sourceThreadId: parentId,
    sourceItemId: "item:1",
    item: {
      type: "user_message",
      status: "completed",
      text: "Add retry",
    } as unknown as OrchestrationV2TurnItem,
  },
  {
    position: 1,
    visibility: "local",
    sourceThreadId: parentId,
    sourceItemId: "item:2",
    item: {
      type: "assistant_message",
      status: "running",
      text: "Wrapping putObject with p-retry",
    } as unknown as OrchestrationV2TurnItem,
  },
] as unknown as ReadonlyArray<OrchestrationV2ProjectedTurnItem>;

function layerFor(input: {
  readonly parent: OrchestrationV2AppThread | null;
  readonly commands: Array<OrchestrationV2ServerCommand>;
  readonly pages: Array<{ readonly limit: number; readonly afterPosition: number | undefined }>;
}) {
  return SideQuestionService.layer.pipe(
    Layer.provide(
      Layer.mock(ThreadManagementService.ThreadManagementService)({
        getThreadRecords: ((threadId: ThreadId) =>
          input.parent !== null && threadId === input.parent.id
            ? Effect.succeed({ thread: input.parent })
            : Effect.fail(
                new Orchestrator.OrchestratorProjectionError({
                  threadId,
                  cause: new ProjectionStore.ProjectionStoreThreadNotFoundError({ threadId }),
                }),
              )) as never,
        getTimelinePage: (_threadId, options) => {
          input.pages.push({ limit: options.limit, afterPosition: options.afterPosition });
          return Effect.succeed(
            options.limit === 1
              ? { items: [], totalItems: timeline.length, hasMore: true }
              : { items: timeline, totalItems: timeline.length, hasMore: false },
          );
        },
        dispatch: (command) => {
          input.commands.push(command);
          return Effect.succeed({ sequence: input.commands.length, storedEvents: [] });
        },
      }),
    ),
  );
}

const askInput = {
  parentThreadId: parentId,
  question: "why p-retry instead of a hand-rolled loop?\nsecond line",
  threadId: ThreadId.make("thread:side-question-child"),
  messageId: MessageId.make("message:side-question"),
  commandId: CommandId.make("command:side-question"),
  createdBy: "user",
  creationSource: "web",
} as const;

it.effect("creates a read-only child under the parent and sends it the snapshot", () =>
  Effect.gen(function* () {
    const commands: Array<OrchestrationV2ServerCommand> = [];
    const pages: Array<{ limit: number; afterPosition: number | undefined }> = [];
    const service = yield* SideQuestionService.SideQuestionService.pipe(
      Effect.provide(layerFor({ parent: makeParent(), commands, pages })),
    );

    const result = yield* service.ask(askInput);
    assert.equal(result.threadId, askInput.threadId);

    // The tail of the timeline: a probe for the total, then the last page.
    assert.deepEqual(pages, [
      { limit: 1, afterPosition: undefined },
      { limit: 400, afterPosition: -1 },
    ]);

    assert.equal(commands.length, 2);
    const create = commands[0]!;
    assert.equal(create.type, "thread.create");
    if (create.type !== "thread.create") return;
    assert.equal(create.threadId, askInput.threadId);
    assert.equal(create.parentThreadId, parentId);
    assert.equal(create.sideChat, true);
    assert.equal(create.title, "why p-retry instead of a hand-rolled loop?");
    assert.deepEqual(create.modelSelection, modelSelection);
    assert.equal(create.runtimeMode, "full-access");
    assert.equal(create.branch, "feat/retry");
    assert.equal(create.worktreePath, "/worktrees/retry");
    assert.equal(create.projectId, projectId);
    assert.equal(create.createdBy, "user");
    assert.equal(create.creationSource, "web");

    const dispatch = commands[1]!;
    assert.equal(dispatch.type, "message.dispatch");
    if (dispatch.type !== "message.dispatch") return;
    assert.equal(dispatch.commandId, askInput.commandId);
    assert.equal(dispatch.threadId, askInput.threadId);
    assert.equal(dispatch.messageId, askInput.messageId);
    assert.deepEqual(dispatch.dispatchMode, { type: "start_immediately" });
    assert.include(dispatch.text, '<transcript title="upload retry with backoff">');
    assert.include(dispatch.text, "User:\nAdd retry");
    assert.include(dispatch.text, "Assistant (in progress):\nWrapping putObject with p-retry");
    assert.isTrue(dispatch.text.endsWith(`Side question: ${askInput.question}`));
  }),
);

it.effect("refuses a parent that is missing, deleted, or itself a side question", () =>
  Effect.gen(function* () {
    const reasonFor = (parent: OrchestrationV2AppThread | null) =>
      Effect.gen(function* () {
        const service = yield* SideQuestionService.SideQuestionService.pipe(
          Effect.provide(layerFor({ parent, commands: [], pages: [] })),
        );
        const error = yield* Effect.flip(service.ask(askInput));
        assert.equal(error._tag, "SideQuestionParentUnavailableError");
        return error._tag === "SideQuestionParentUnavailableError" ? error.reason : null;
      });

    assert.equal(yield* reasonFor(null), "not_found");
    assert.equal(
      yield* reasonFor(makeParent({ deletedAt: DateTime.makeUnsafe("2026-10-19T01:00:00Z") })),
      "deleted",
    );
    assert.equal(yield* reasonFor(makeParent({ sideChat: true })), "side_question");
  }),
);
