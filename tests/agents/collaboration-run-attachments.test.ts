import { describe, expect, it, vi } from "vitest";

import type { AgentAdapter, AgentRunRequest } from "@/agents/contract";
import { AgentRegistry } from "@/agents/registry";
import { CollaborationRunCoordinator } from "@/server/collaboration-run-coordinator";

const ids = {
  run: "10000000-0000-4000-8000-000000000001",
  workspace: "10000000-0000-4000-8000-000000000002",
  room: "10000000-0000-4000-8000-000000000003",
  message: "10000000-0000-4000-8000-000000000004",
  human: "10000000-0000-4000-8000-000000000005",
  agent: "10000000-0000-4000-8000-000000000006",
  attachment: "10000000-0000-4000-8000-000000000007",
};

function request(): AgentRunRequest {
  return {
    runId: ids.run,
    workspaceId: ids.workspace,
    roomId: ids.room,
    triggerMessageId: ids.message,
    triggerType: "message",
    message: "阅读附件",
    sender: { principalId: ids.human, kind: "human", displayName: "Human" },
    members: [
      { principalId: ids.human, kind: "human", displayName: "Human", listenerPolicy: "always" },
      { principalId: ids.agent, kind: "agent", displayName: "Agent", listenerPolicy: "mention_only" },
    ],
    mentionedPrincipalIds: [ids.agent],
    history: [],
    replyTo: null,
    threadRoot: null,
    attachments: [{
      attachmentId: ids.attachment,
      messageId: ids.message,
      originalName: "brief.txt",
      mediaType: "text/plain",
      sizeBytes: 12,
      sha256: "a".repeat(64),
      provenance: "human_upload",
      resource: {
        method: "GET",
        path: `/api/v1/agent-gateway/resources/${ids.attachment}?runId=${ids.run}`,
      },
    }],
  };
}

function harness(attachmentsSupported: boolean) {
  const run = {
    id: ids.run,
    roomId: ids.room,
    triggerMessageId: ids.message,
    targetAgentPrincipalId: ids.agent,
    outputMessageId: null,
    adapterId: "file-agent",
    triggerType: "message" as const,
    status: "running" as const,
    idempotencyKey: "run-key",
    retryOfRunId: null,
    errorCode: null,
    errorMessage: null,
    startedAt: new Date(),
    finishedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  const appendEvent = vi.fn(async (_runId, event: { type: string; error?: { code: string } }) => ({
    ...run,
    status: event.type === "completed" ? "completed" : "failed",
    errorCode: event.error?.code ?? null,
  }));
  const runs = {
    claim: vi.fn(async () => run),
    getExecutionContext: vi.fn(async () => ({ run, request: request() })),
    listEvents: vi.fn(async () => []),
    appendEvent,
    get: vi.fn(async () => run),
  };
  const runAdapter = vi.fn();
  const adapter: AgentAdapter = {
    descriptor: {
      id: "file-agent",
      displayName: "File Agent",
      version: "1.0.0",
      capabilities: {
        streaming: false,
        cancellation: false,
        attachments: attachmentsSupported,
      },
    },
    health: async () => ({ status: "available" }),
    run: (value) => {
      runAdapter(value);
      return (async function* () {
        yield { sequence: 1, type: "completed", text: "done" } as const;
      })();
    },
  };
  const createAccessGrant = vi.fn(async () => ({}));
  const settleByChildRun = vi.fn(async () => undefined);
  const coordinator = new CollaborationRunCoordinator(
    runs as never,
    new AgentRegistry([adapter]),
    {} as never,
    { settleByChildRun } as never,
    {} as never,
    { createAccessGrant } as never,
  );
  return { coordinator, appendEvent, createAccessGrant, runAdapter };
}

describe("CollaborationRunCoordinator attachment grants", () => {
  it("creates a run-scoped grant before invoking an attachment-capable Agent", async () => {
    const test = harness(true);

    await test.coordinator.start(ids.run);

    expect(test.createAccessGrant).toHaveBeenCalledWith(expect.objectContaining({
      workspaceId: ids.workspace,
      roomId: ids.room,
      attachmentId: ids.attachment,
      runId: ids.run,
      principalId: ids.agent,
      expiresAt: expect.any(Date),
    }));
    expect(test.runAdapter).toHaveBeenCalledWith(expect.objectContaining({
      attachments: [expect.objectContaining({ attachmentId: ids.attachment })],
    }));
  });

  it("fails visibly without invoking an Agent that lacks attachment capability", async () => {
    const test = harness(false);

    await test.coordinator.start(ids.run);

    expect(test.createAccessGrant).not.toHaveBeenCalled();
    expect(test.runAdapter).not.toHaveBeenCalled();
    expect(test.appendEvent).toHaveBeenCalledWith(ids.run, expect.objectContaining({
      type: "failed",
      error: expect.objectContaining({
        code: "ATTACHMENTS_NOT_SUPPORTED",
        retriable: false,
      }),
    }));
  });
});
