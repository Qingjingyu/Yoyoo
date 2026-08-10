/** @vitest-environment node */

import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type {
  AgentAdapter,
  AgentEvent,
  AgentRunRequest,
} from "@/agents/contract";
import { AgentRegistry } from "@/agents/registry";
import { DeterministicTestAdapter } from "@/agents/test-adapter";
import { ConversationService } from "@/server/conversation-service";
import { RunCoordinator } from "@/server/run-coordinator";
import { ConversationRepository } from "@/server/postgres/conversation-repository";
import { ConversationBusyError } from "@/server/postgres/conversation-repository";
import { createPostgresPool } from "@/server/postgres/client";
import { RunRepository } from "@/server/postgres/run-repository";

const databaseUrl =
  process.env.TEST_DATABASE_URL ??
  "postgresql://yoyoo:yoyoo_dev@127.0.0.1:55432/yoyoo_space";

interface Harness {
  conversations: ConversationRepository;
  coordinator: RunCoordinator;
  runs: RunRepository;
  service: ConversationService;
}

function createHarness(adapter: AgentAdapter): Harness {
  const conversations = new ConversationRepository(pool);
  const runs = new RunRepository(pool);
  const registry = new AgentRegistry([adapter]);
  const coordinator = new RunCoordinator(runs, registry);
  const service = new ConversationService(conversations, runs, coordinator);
  return { conversations, coordinator, runs, service };
}

async function waitForRunStatus(
  runs: RunRepository,
  runId: string,
  expectedStatus: string,
): Promise<void> {
  const deadline = Date.now() + 3_000;
  while (Date.now() < deadline) {
    const run = await runs.get(runId);
    if (run.status === expectedStatus) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`Run ${runId} did not reach ${expectedStatus}`);
}

const pool = createPostgresPool(databaseUrl, { max: 4 });

beforeAll(async () => {
  process.env.DATABASE_URL = databaseUrl;
});

afterAll(async () => {
  await pool.end();
});

describe("ConversationService", () => {
  it("persists the human message before invoking the Agent", async () => {
    const ownerId = `owner-${randomUUID()}`;
    let persistedBeforeRun = false;

    const adapter: AgentAdapter = {
      descriptor: {
        id: "persistence-probe",
        displayName: "Persistence Probe",
        version: "1.0.0",
        capabilities: { streaming: true, cancellation: false },
      },
      health: async () => ({ status: "available" }),
      async *run(request: AgentRunRequest): AsyncGenerator<AgentEvent> {
        if (!("conversationId" in request)) {
          throw new Error("The legacy conversation probe received a room request");
        }
        const result = await pool.query(
          `SELECT 1 FROM messages
           WHERE conversation_id = $1 AND sender_type = 'human' AND content = $2`,
          [request.conversationId, request.message],
        );
        persistedBeforeRun = result.rowCount === 1;
        yield { sequence: 1, type: "status", status: "running" };
        yield { sequence: 2, type: "completed", text: "已经收到。" };
      },
    };
    const { coordinator, service } = createHarness(adapter);

    const submission = await service.submitMessage({
      ownerId,
      agentId: adapter.descriptor.id,
      content: "请记录这条消息",
      idempotencyKey: randomUUID(),
    });
    await coordinator.waitFor(submission.run.id);

    expect(persistedBeforeRun).toBe(true);
    const snapshot = await service.getCurrent(ownerId, adapter.descriptor.id);
    expect(snapshot.messages.map((message) => message.senderType)).toEqual([
      "human",
      "agent",
    ]);
  });

  it("deduplicates the same idempotency key without invoking the Agent twice", async () => {
    const adapter = new DeterministicTestAdapter({
      id: `dedupe-${randomUUID()}`,
      chunks: ["唯一回复"],
    });
    const { coordinator, runs, service } = createHarness(adapter);
    const input = {
      ownerId: `owner-${randomUUID()}`,
      agentId: adapter.descriptor.id,
      content: "不要重复",
      idempotencyKey: randomUUID(),
    };

    const first = await service.submitMessage(input);
    const second = await service.submitMessage(input);
    await coordinator.waitFor(first.run.id);

    expect(second.duplicate).toBe(true);
    expect(second.run.id).toBe(first.run.id);
    expect(adapter.runRequests).toHaveLength(1);
    expect(await runs.listEvents(first.run.id)).toHaveLength(3);
  });

  it("rejects a second distinct submission while one run is active", async () => {
    const adapter = new DeterministicTestAdapter({
      id: `busy-${randomUUID()}`,
      chunks: ["稍后完成"],
      delayMs: 100,
    });
    const { coordinator, service } = createHarness(adapter);
    const ownerId = `owner-${randomUUID()}`;
    const first = await service.submitMessage({
      ownerId,
      agentId: adapter.descriptor.id,
      content: "第一条",
      idempotencyKey: randomUUID(),
    });

    await expect(
      service.submitMessage({
        ownerId,
        agentId: adapter.descriptor.id,
        content: "并发第二条",
        idempotencyKey: randomUUID(),
      }),
    ).rejects.toBeInstanceOf(ConversationBusyError);
    await coordinator.waitFor(first.run.id);
  });

  it("persists ordered streaming events and a completed Agent message", async () => {
    const adapter = new DeterministicTestAdapter({
      id: `complete-${randomUUID()}`,
      chunks: ["第一段", "，第二段。"],
    });
    const { coordinator, runs, service } = createHarness(adapter);
    const ownerId = `owner-${randomUUID()}`;

    const submission = await service.submitMessage({
      ownerId,
      agentId: adapter.descriptor.id,
      content: "开始",
      idempotencyKey: randomUUID(),
    });
    await coordinator.waitFor(submission.run.id);

    const run = await runs.get(submission.run.id);
    expect(run.status).toBe("completed");
    expect((await runs.listEvents(run.id)).map((event) => event.event.type)).toEqual([
      "status",
      "text_delta",
      "text_delta",
      "completed",
    ]);
    const snapshot = await service.getCurrent(ownerId, adapter.descriptor.id);
    expect(snapshot.messages.at(-1)).toMatchObject({
      senderType: "agent",
      content: "第一段，第二段。",
      status: "completed",
    });
  });

  it("keeps partial text and a failed terminal state without false completion", async () => {
    const adapter = new DeterministicTestAdapter({
      id: `failure-${randomUUID()}`,
      chunks: ["已生成部分", "不会到达"],
      failAfterChunks: 1,
    });
    const { coordinator, runs, service } = createHarness(adapter);
    const ownerId = `owner-${randomUUID()}`;

    const submission = await service.submitMessage({
      ownerId,
      agentId: adapter.descriptor.id,
      content: "触发失败",
      idempotencyKey: randomUUID(),
    });
    await coordinator.waitFor(submission.run.id);

    expect(await runs.get(submission.run.id)).toMatchObject({
      status: "failed",
      errorCode: "DETERMINISTIC_TEST_FAILURE",
    });
    expect((await runs.listEvents(submission.run.id)).at(-1)?.event.type).toBe("failed");
    const snapshot = await service.getCurrent(ownerId, adapter.descriptor.id);
    expect(snapshot.messages.at(-1)).toMatchObject({
      senderType: "agent",
      content: "已生成部分",
      status: "failed",
    });
  });

  it("aborts a cancellable active run and persists stopped instead of completed", async () => {
    const adapter = new DeterministicTestAdapter({
      id: `cancel-${randomUUID()}`,
      chunks: ["慢速第一段", "慢速第二段"],
      delayMs: 100,
      cancellation: true,
    });
    const { coordinator, runs, service } = createHarness(adapter);
    const ownerId = `owner-${randomUUID()}`;

    const submission = await service.submitMessage({
      ownerId,
      agentId: adapter.descriptor.id,
      content: "请停止",
      idempotencyKey: randomUUID(),
    });
    await waitForRunStatus(runs, submission.run.id, "running");
    await service.cancelRun(submission.run.id);
    await coordinator.waitFor(submission.run.id);

    expect((await runs.get(submission.run.id)).status).toBe("stopped");
    expect((await runs.listEvents(submission.run.id)).at(-1)?.event.type).toBe("stopped");
    expect(adapter.cancelledRunIds).toContain(submission.run.id);
  });

  it("retries a failed run without duplicating the original human message", async () => {
    const adapter = new DeterministicTestAdapter({
      id: `retry-${randomUUID()}`,
      chunks: ["失败片段"],
      failAfterChunks: 1,
    });
    const { coordinator, service } = createHarness(adapter);
    const ownerId = `owner-${randomUUID()}`;

    const first = await service.submitMessage({
      ownerId,
      agentId: adapter.descriptor.id,
      content: "可以重试",
      idempotencyKey: randomUUID(),
    });
    await coordinator.waitFor(first.run.id);
    const retryKey = randomUUID();
    const retried = await service.retryRun(first.run.id, retryKey);
    const duplicateRetry = await service.retryRun(first.run.id, retryKey);
    await coordinator.waitFor(retried.run.id);

    const snapshot = await service.getCurrent(ownerId, adapter.descriptor.id);
    expect(snapshot.messages.filter((message) => message.senderType === "human")).toHaveLength(1);
    expect(adapter.runRequests).toHaveLength(2);
    expect(retried.duplicate).toBe(false);
    expect(duplicateRetry.duplicate).toBe(true);
    expect(duplicateRetry.run.id).toBe(retried.run.id);
  });

  it("marks inherited queued or running work as a visible restart failure", async () => {
    const adapter = new DeterministicTestAdapter({ id: `restart-${randomUUID()}` });
    const { conversations, coordinator, runs } = createHarness(adapter);
    const conversation = await conversations.getOrCreateCurrent(
      `owner-${randomUUID()}`,
      adapter.descriptor.id,
    );
    const pending = await conversations.createSubmission({
      conversationId: conversation.id,
      adapterId: adapter.descriptor.id,
      content: "进程重启前的消息",
      idempotencyKey: randomUUID(),
    });
    await runs.claim(pending.run.id);

    const reconciled = await coordinator.reconcileInterruptedRuns();

    expect(reconciled).toContain(pending.run.id);
    expect(await runs.get(pending.run.id)).toMatchObject({
      status: "failed",
      errorCode: "PROCESS_RESTARTED",
    });
    expect((await runs.listEvents(pending.run.id)).at(-1)?.event.type).toBe("failed");
  });
});
