import { describe, expect, it } from "vitest";

import type { AgentRunRequest } from "@/agents/contract";
import { collectAgentEvents } from "@/agents/contract";
import type { AgentGatewayJobRecord } from "@/domain/collaboration";
import { AgentGatewayAdapter } from "@/agents/agent-gateway-adapter";

const request: AgentRunRequest = {
  runId: "150f432f-8c01-4f27-b05a-14f248150d4a",
  conversationId: "e1025c3a-3e59-40b6-af3a-312c2cc22f62",
  message: "请整理要点",
};

function job(
  status: AgentGatewayJobRecord["status"],
  result: Record<string, unknown> | null = null,
): AgentGatewayJobRecord {
  const now = new Date();
  return {
    id: "7720c142-86d2-4ec0-9b95-017b84ca3d26",
    runId: request.runId,
    principalId: "63b2ae24-e627-42d8-adff-f8bb96971e2a",
    request,
    status,
    leaseId: null,
    leasedAt: null,
    leaseExpiresAt: null,
    result,
    createdAt: now,
    updatedAt: now,
    finishedAt: status === "completed" || status === "failed" ? now : null,
  };
}

describe("AgentGatewayAdapter", () => {
  it("publishes one job and returns the external Agent text result", async () => {
    let reads = 0;
    const store = {
      enqueueJob: async () => job("queued"),
      getJobByRunId: async () => {
        reads += 1;
        return reads === 1
          ? job("leased")
          : job("completed", { type: "completed", text: "已整理完成" });
      },
    };
    const adapter = new AgentGatewayAdapter(store, {
      pollIntervalMs: 1,
      responseTimeoutMs: 100,
    });

    await expect(
      collectAgentEvents(adapter.run(request, new AbortController().signal)),
    ).resolves.toEqual([
      { sequence: 1, type: "status", status: "running" },
      { sequence: 2, type: "completed", text: "已整理完成" },
    ]);
  });

  it("maps failure, timeout, and cancellation to terminal events", async () => {
    const failed = new AgentGatewayAdapter({
      enqueueJob: async () => job("queued"),
      getJobByRunId: async () =>
        job("failed", {
          type: "failed",
          error: { code: "MODEL_ERROR", message: "模型不可用", retriable: true },
        }),
    });
    await expect(
      collectAgentEvents(failed.run(request, new AbortController().signal)),
    ).resolves.toEqual([
      { sequence: 1, type: "status", status: "running" },
      {
        sequence: 2,
        type: "failed",
        error: { code: "MODEL_ERROR", message: "模型不可用", retriable: true },
      },
    ]);

    const waitingStore = {
      enqueueJob: async () => job("queued"),
      getJobByRunId: async () => job("queued"),
    };
    const timeout = new AgentGatewayAdapter(waitingStore, {
      pollIntervalMs: 1,
      responseTimeoutMs: 2,
    });
    await expect(
      collectAgentEvents(timeout.run(request, new AbortController().signal)),
    ).resolves.toMatchObject([
      { sequence: 1, type: "status" },
      { sequence: 2, type: "failed", error: { code: "GATEWAY_TIMEOUT" } },
    ]);

    const controller = new AbortController();
    controller.abort();
    const cancelled = new AgentGatewayAdapter(waitingStore);
    await expect(collectAgentEvents(cancelled.run(request, controller.signal))).resolves.toEqual([
      { sequence: 1, type: "status", status: "running" },
      { sequence: 2, type: "stopped" },
    ]);
  });
});
