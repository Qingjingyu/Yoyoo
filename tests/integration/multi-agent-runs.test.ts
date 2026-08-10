/** @vitest-environment node */

import { randomUUID } from "node:crypto";

import { afterAll, describe, expect, it } from "vitest";

import type {
  AgentAdapter,
  AgentDescriptor,
  AgentEvent,
  AgentRunRequest,
} from "@/agents/contract";
import { AgentRegistry } from "@/agents/registry";
import { CollaborationRunCoordinator } from "@/server/collaboration-run-coordinator";
import { CollaborationService } from "@/server/collaboration-service";
import { ArtifactRepository } from "@/server/postgres/artifact-repository";
import { createPostgresPool } from "@/server/postgres/client";
import { CollaborationRunRepository } from "@/server/postgres/collaboration-run-repository";
import { DelegationRepository } from "@/server/postgres/delegation-repository";
import { PrincipalRepository } from "@/server/postgres/principal-repository";
import { RoomRepository } from "@/server/postgres/room-repository";
import { WorkspaceRepository } from "@/server/postgres/workspace-repository";

const databaseUrl =
  process.env.TEST_DATABASE_URL ??
  "postgresql://yoyoo:yoyoo_dev@127.0.0.1:55432/yoyoo_space";
const pool = createPostgresPool(databaseUrl, { max: 6 });

function pause(delayMs: number, signal?: AbortSignal): Promise<boolean> {
  if (signal?.aborted) return Promise.resolve(false);
  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve(true);
    }, delayMs);
    const onAbort = () => {
      clearTimeout(timeout);
      resolve(false);
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

async function waitFor(
  predicate: () => Promise<boolean>,
  message: string,
  timeoutMs = 4_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await pause(10);
  }
  throw new Error(message);
}

class ScriptedRoomAdapter implements AgentAdapter {
  readonly cancelledRunIds: string[] = [];
  readonly requests: AgentRunRequest[] = [];

  constructor(
    readonly descriptor: AgentDescriptor,
    private readonly script: (
      request: AgentRunRequest,
      signal: AbortSignal,
    ) => AsyncGenerator<AgentEvent>,
  ) {}

  async health() {
    return { status: "available" as const };
  }

  run(request: AgentRunRequest, signal: AbortSignal): AsyncIterable<AgentEvent> {
    this.requests.push(request);
    return this.script(request, signal);
  }

  async cancel(runId: string): Promise<void> {
    this.cancelledRunIds.push(runId);
  }
}

afterAll(async () => {
  await pool.end();
});

describe("multi-Agent room execution", () => {
  it("runs in parallel, delegates, accepts human intervention, and persists an Artifact", async () => {
    const principals = new PrincipalRepository(pool);
    const workspaces = new WorkspaceRepository(pool);
    const rooms = new RoomRepository(pool);
    const runs = new CollaborationRunRepository(pool);
    const delegations = new DelegationRepository(pool);
    const artifacts = new ArtifactRepository(pool);
    const suffix = randomUUID();
    const human = await principals.create({
      kind: "human",
      externalKey: `human:multi-${suffix}`,
      handle: `human-${suffix.slice(0, 8)}`,
      displayName: "Su Bai",
    });
    const planner = await principals.create({
      kind: "agent",
      externalKey: `agent:planner-${suffix}`,
      handle: `planner-${suffix.slice(0, 8)}`,
      displayName: "Planner",
    });
    const builder = await principals.create({
      kind: "agent",
      externalKey: `agent:builder-${suffix}`,
      handle: `builder-${suffix.slice(0, 8)}`,
      displayName: "Builder",
    });
    const reviewer = await principals.create({
      kind: "agent",
      externalKey: `agent:reviewer-${suffix}`,
      handle: `reviewer-${suffix.slice(0, 8)}`,
      displayName: "Reviewer",
    });

    let active = 0;
    let maximumConcurrent = 0;
    const enter = () => {
      active += 1;
      maximumConcurrent = Math.max(maximumConcurrent, active);
    };
    const leave = () => {
      active -= 1;
    };
    const plannerAdapter = new ScriptedRoomAdapter(
      {
        id: `planner-${suffix}`,
        displayName: "Planner",
        version: "1.0.0",
        capabilities: {
          streaming: true,
          cancellation: true,
          delegation: true,
          artifacts: false,
        },
      },
      async function* (_request, signal) {
        enter();
        try {
          yield { sequence: 1, type: "status", status: "running" };
          await pause(40, signal);
          yield {
            sequence: 2,
            type: "delegation",
            delegatePrincipalId: builder.id,
            objective: "把协作结果整理成最终 Markdown 发布方案",
            idempotencyKey: "delegate-builder",
          };
          yield { sequence: 3, type: "text_delta", delta: "已委托 Builder。" };
          yield { sequence: 4, type: "completed", text: "已委托 Builder。" };
        } finally {
          leave();
        }
      },
    );
    const builderAdapter = new ScriptedRoomAdapter(
      {
        id: `builder-${suffix}`,
        displayName: "Builder",
        version: "1.0.0",
        capabilities: {
          streaming: true,
          cancellation: true,
          delegation: false,
          artifacts: true,
        },
      },
      async function* (request, signal) {
        enter();
        try {
          expect(request).toMatchObject({
            triggerType: "delegation",
            message: "把协作结果整理成最终 Markdown 发布方案",
          });
          yield { sequence: 1, type: "status", status: "running" };
          await pause(30, signal);
          yield {
            sequence: 2,
            type: "artifact",
            artifact: {
              type: "markdown",
              title: "Yoyoo V0.2 发布方案",
              content: "# Yoyoo V0.2 发布方案\n\n多人 + 多 AI 协作闭环。",
              metadata: { version: 1 },
            },
            idempotencyKey: "release-plan-v1",
          };
          yield { sequence: 3, type: "completed", text: "最终方案已生成。" };
        } finally {
          leave();
        }
      },
    );
    let reviewerInvocation = 0;
    const reviewerAdapter = new ScriptedRoomAdapter(
      {
        id: `reviewer-${suffix}`,
        displayName: "Reviewer",
        version: "1.0.0",
        capabilities: {
          streaming: true,
          cancellation: true,
          delegation: false,
          artifacts: false,
        },
      },
      async function* (_request, signal) {
        reviewerInvocation += 1;
        enter();
        try {
          yield { sequence: 1, type: "status", status: "running" };
          if (reviewerInvocation === 2) {
            yield {
              sequence: 2,
              type: "failed",
              error: {
                code: "REVIEW_TEMPORARILY_UNAVAILABLE",
                message: "Reviewer is temporarily unavailable",
                retriable: true,
              },
            };
            return;
          }
          if (reviewerInvocation >= 3) {
            yield { sequence: 2, type: "completed", text: "重试后的审阅已完成。" };
            return;
          }
          yield { sequence: 2, type: "text_delta", delta: "正在审阅..." };
          const completedDelay = await pause(1_000, signal);
          if (!completedDelay || signal.aborted) {
            yield { sequence: 3, type: "stopped" };
            return;
          }
          yield { sequence: 3, type: "completed", text: "审阅完成。" };
        } finally {
          leave();
        }
      },
    );

    for (const [principal, adapter] of [
      [planner, plannerAdapter],
      [builder, builderAdapter],
      [reviewer, reviewerAdapter],
    ] as const) {
      await principals.bindAgent({
        principalId: principal.id,
        adapterId: adapter.descriptor.id,
        capabilities: adapter.descriptor.capabilities,
      });
    }
    const workspace = await workspaces.create({
      slug: `multi-${suffix}`,
      name: "Multi Agent Space",
      ownerPrincipalId: human.id,
    });
    for (const principal of [planner, builder, reviewer]) {
      await workspaces.addMember({
        workspaceId: workspace.id,
        principalId: principal.id,
        role: "member",
      });
    }
    const room = await rooms.create({
      workspaceId: workspace.id,
      name: "V0.2 Delivery Room",
      createdByPrincipalId: human.id,
    });
    for (const principal of [planner, builder, reviewer]) {
      await rooms.addMember({
        roomId: room.id,
        principalId: principal.id,
        role: "member",
        listenerPolicy: "mention_only",
      });
    }

    const registry = new AgentRegistry([
      plannerAdapter,
      builderAdapter,
      reviewerAdapter,
    ]);
    const coordinator = new CollaborationRunCoordinator(
      runs,
      registry,
      principals,
      delegations,
      artifacts,
    );
    const service = new CollaborationService(
      rooms,
      runs,
      coordinator,
      delegations,
      artifacts,
    );
    const submission = await service.submitMessage({
      roomId: room.id,
      senderPrincipalId: human.id,
      content: "@Planner @Reviewer 请共同完成发布方案",
      idempotencyKey: randomUUID(),
      mentionedPrincipalIds: [planner.id, reviewer.id],
    });
    const reviewerRun = submission.runs.find(
      (run) => run.targetAgentPrincipalId === reviewer.id,
    );
    expect(reviewerRun).toBeDefined();

    await waitFor(
      async () => (await runs.get(reviewerRun!.id)).status === "running",
      "Reviewer did not start",
    );
    const intervention = await service.interveneAndStop({
      runId: reviewerRun!.id,
      senderPrincipalId: human.id,
      content: "先停止审阅，等待 Builder 的最终文档。",
      idempotencyKey: randomUUID(),
    });
    expect(intervention.kind).toBe("intervention");

    await waitFor(
      async () => {
        const allRuns = await runs.listForRoom(room.id);
        return allRuns.length === 3 && allRuns.every((run) =>
          ["completed", "stopped", "failed"].includes(run.status),
        );
      },
      "The delegated collaboration did not reach terminal state",
    );
    const snapshot = await service.getSnapshot(room.id);

    expect(maximumConcurrent).toBeGreaterThanOrEqual(2);
    expect(reviewerAdapter.cancelledRunIds).toEqual([reviewerRun!.id]);
    expect(snapshot.runs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          targetAgentPrincipalId: planner.id,
          status: "completed",
        }),
        expect.objectContaining({
          targetAgentPrincipalId: builder.id,
          triggerType: "delegation",
          status: "completed",
        }),
        expect.objectContaining({
          targetAgentPrincipalId: reviewer.id,
          status: "stopped",
        }),
      ]),
    );
    expect(snapshot.delegations).toEqual([
      expect.objectContaining({
        delegatorPrincipalId: planner.id,
        delegatePrincipalId: builder.id,
        status: "completed",
      }),
    ]);
    expect(snapshot.messages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          senderPrincipalId: planner.id,
          kind: "message",
          content: "已委托 Builder。",
        }),
        expect.objectContaining({
          senderPrincipalId: builder.id,
          kind: "message",
          content: "最终方案已生成。",
        }),
        expect.objectContaining({
          senderPrincipalId: human.id,
          kind: "intervention",
          content: "先停止审阅，等待 Builder 的最终文档。",
        }),
      ]),
    );
    expect(snapshot.artifacts).toEqual([
      expect.objectContaining({
        producerPrincipalId: builder.id,
        type: "markdown",
        title: "Yoyoo V0.2 发布方案",
        content: "# Yoyoo V0.2 发布方案\n\n多人 + 多 AI 协作闭环。",
        metadata: { version: 1 },
      }),
    ]);

    const completedPlannerRun = snapshot.runs.find(
      (run) => run.targetAgentPrincipalId === planner.id,
    );
    const lateIntervention = "这个终态运行不应再写入干预消息。";
    await expect(
      service.interveneAndStop({
        runId: completedPlannerRun!.id,
        senderPrincipalId: human.id,
        content: lateIntervention,
        idempotencyKey: randomUUID(),
      }),
    ).rejects.toThrow("already terminal");
    expect((await service.getSnapshot(room.id)).messages).not.toContainEqual(
      expect.objectContaining({ content: lateIntervention }),
    );

    const failedSubmission = await service.submitMessage({
      roomId: room.id,
      senderPrincipalId: human.id,
      content: "@Reviewer 请重新审阅最终方案",
      idempotencyKey: randomUUID(),
      mentionedPrincipalIds: [reviewer.id],
    });
    const failedRun = failedSubmission.runs[0];
    await coordinator.waitFor(failedRun.id);
    expect(await runs.get(failedRun.id)).toMatchObject({
      status: "failed",
      errorCode: "REVIEW_TEMPORARILY_UNAVAILABLE",
      errorMessage: "Reviewer is temporarily unavailable",
    });

    const retryKey = randomUUID();
    const retry = await service.retryRun({
      runId: failedRun.id,
      idempotencyKey: retryKey,
    });
    const duplicateRetry = await service.retryRun({
      runId: failedRun.id,
      idempotencyKey: retryKey,
    });
    await coordinator.waitFor(retry.run.id);

    expect(retry.duplicate).toBe(false);
    expect(duplicateRetry).toMatchObject({
      duplicate: true,
      run: { id: retry.run.id },
    });
    expect(await runs.get(retry.run.id)).toMatchObject({
      triggerType: "retry",
      retryOfRunId: failedRun.id,
      status: "completed",
    });
  });
});
