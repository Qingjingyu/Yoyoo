import { describe, expect, it, vi } from "vitest";

import {
  agentDescriptorSchema,
  agentEventSchema,
  agentRunRequestSchema,
  collectAgentEvents,
  type AgentAdapter,
} from "@/agents/contract";
import {
  AgentRegistry,
  UnsupportedAgentCapabilityError,
} from "@/agents/registry";
import { DeterministicTestAdapter } from "@/agents/test-adapter";

describe("Agent contract", () => {
  it("accepts portable descriptors and rejects vendor-specific fields", () => {
    expect(
      agentDescriptorSchema.parse({
        id: "test-agent",
        displayName: "Test Agent",
        version: "1.0.0",
        capabilities: {
          streaming: true,
          cancellation: false,
          attachments: true,
        },
      }),
    ).toEqual({
      id: "test-agent",
      displayName: "Test Agent",
      version: "1.0.0",
      capabilities: {
        streaming: true,
        cancellation: false,
        attachments: true,
      },
    });

    expect(() =>
      agentDescriptorSchema.parse({
        id: "test-agent",
        displayName: "Test Agent",
        version: "1.0.0",
        capabilities: {
          streaming: true,
          cancellation: false,
        },
        vendorSessionId: "must-stay-in-the-adapter",
      }),
    ).toThrow();
  });

  it("reports health and emits ordered status, delta, and completion events", async () => {
    const adapter = new DeterministicTestAdapter({
      chunks: ["你好，", "我是 Yoyoo。"],
    });

    await expect(adapter.health()).resolves.toEqual({
      status: "available",
    });

    const events = await collectAgentEvents(
      adapter.run(
        {
          runId: "00000000-0000-4000-8000-000000000001",
          conversationId: "00000000-0000-4000-8000-000000000002",
          message: "你好",
        },
        new AbortController().signal,
      ),
    );

    expect(events.map((event) => event.sequence)).toEqual([1, 2, 3, 4]);
    expect(events.map((event) => event.type)).toEqual([
      "status",
      "text_delta",
      "text_delta",
      "completed",
    ]);
    expect(events.at(-1)).toMatchObject({
      type: "completed",
      text: "你好，我是 Yoyoo。",
    });
  });

  it("turns an aborted run into a truthful stopped terminal event", async () => {
    const adapter = new DeterministicTestAdapter({ chunks: ["不会发送"] });
    const controller = new AbortController();
    controller.abort();

    const events = await collectAgentEvents(
      adapter.run(
        {
          runId: "00000000-0000-4000-8000-000000000003",
          conversationId: "00000000-0000-4000-8000-000000000004",
          message: "停止",
        },
        controller.signal,
      ),
    );

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: "stopped", sequence: 1 });
  });

  it("emits a failed terminal event without also completing", async () => {
    const adapter = new DeterministicTestAdapter({
      chunks: ["第一段", "第二段"],
      failAfterChunks: 1,
    });

    const events = await collectAgentEvents(
      adapter.run(
        {
          runId: "00000000-0000-4000-8000-000000000005",
          conversationId: "00000000-0000-4000-8000-000000000006",
          message: "触发失败",
        },
        new AbortController().signal,
      ),
    );

    expect(events.map((event) => event.type)).toEqual([
      "status",
      "text_delta",
      "failed",
    ]);
    expect(events).not.toContainEqual(expect.objectContaining({ type: "completed" }));
  });

  it("gates cancellation by the descriptor capability", async () => {
    const unsupportedCancel = vi.fn();
    const unsupportedAdapter: AgentAdapter = {
      descriptor: {
        id: "no-cancel",
        displayName: "No cancel",
        version: "1.0.0",
        capabilities: { streaming: true, cancellation: false },
      },
      health: async () => ({ status: "available" }),
      async *run() {
        yield { sequence: 1, type: "completed", text: "done" };
      },
      cancel: unsupportedCancel,
    };

    const supportedAdapter = new DeterministicTestAdapter({
      id: "can-cancel",
      cancellation: true,
    });
    const registry = new AgentRegistry([unsupportedAdapter, supportedAdapter]);

    await expect(registry.cancel("no-cancel", "run-1")).rejects.toBeInstanceOf(
      UnsupportedAgentCapabilityError,
    );
    expect(unsupportedCancel).not.toHaveBeenCalled();

    await expect(registry.cancel("can-cancel", "run-2")).resolves.toBeUndefined();
    expect(supportedAdapter.cancelledRunIds).toEqual(["run-2"]);
  });

  it("accepts portable room context without requiring a legacy conversation", () => {
    const request = agentRunRequestSchema.parse({
      runId: "10000000-0000-4000-8000-000000000001",
      workspaceId: "10000000-0000-4000-8000-000000000002",
      roomId: "10000000-0000-4000-8000-000000000003",
      triggerMessageId: "10000000-0000-4000-8000-000000000004",
      triggerType: "message",
      message: "@Planner 请和 Builder 一起完成方案",
      sender: {
        principalId: "10000000-0000-4000-8000-000000000005",
        kind: "human",
        displayName: "Su Bai",
      },
      members: [
        {
          principalId: "10000000-0000-4000-8000-000000000005",
          kind: "human",
          displayName: "Su Bai",
          listenerPolicy: "always",
        },
        {
          principalId: "10000000-0000-4000-8000-000000000006",
          kind: "agent",
          displayName: "Planner",
          listenerPolicy: "mention_only",
        },
      ],
      mentionedPrincipalIds: ["10000000-0000-4000-8000-000000000006"],
      history: [
        {
          messageId: "10000000-0000-4000-8000-000000000007",
          senderPrincipalId: "10000000-0000-4000-8000-000000000006",
          senderKind: "agent",
          senderDisplayName: "Builder",
          content: "上一轮方案已经整理。",
        },
      ],
      replyTo: null,
      threadRoot: null,
      attachments: [
        {
          attachmentId: "10000000-0000-4000-8000-000000000008",
          messageId: "10000000-0000-4000-8000-000000000004",
          originalName: "发布计划.pdf",
          mediaType: "application/pdf",
          sizeBytes: 2048,
          sha256: "a".repeat(64),
          provenance: "human_upload",
          resource: {
            method: "GET",
            path: "/api/v1/agent-gateway/resources/10000000-0000-4000-8000-000000000008?runId=10000000-0000-4000-8000-000000000001",
          },
        },
      ],
    });

    expect(request).toMatchObject({
      roomId: "10000000-0000-4000-8000-000000000003",
      sender: { kind: "human", displayName: "Su Bai" },
      mentionedPrincipalIds: ["10000000-0000-4000-8000-000000000006"],
      history: [
        expect.objectContaining({
          senderKind: "agent",
          senderDisplayName: "Builder",
          content: "上一轮方案已经整理。",
        }),
      ],
      attachments: [
        expect.objectContaining({
          originalName: "发布计划.pdf",
          resource: expect.objectContaining({ method: "GET" }),
        }),
      ],
    });
    expect(request).not.toHaveProperty("conversationId");
  });

  it("validates typed delegation and Artifact events", () => {
    expect(
      agentEventSchema.parse({
        sequence: 2,
        type: "delegation",
        delegatePrincipalId: "20000000-0000-4000-8000-000000000001",
        objective: "整理最终文档",
        idempotencyKey: "delegate-final-document",
      }),
    ).toMatchObject({ type: "delegation", objective: "整理最终文档" });
    expect(
      agentEventSchema.parse({
        sequence: 3,
        type: "artifact",
        artifact: {
          type: "markdown",
          title: "发布方案",
          content: "# 发布方案",
          metadata: { version: 1 },
        },
        idempotencyKey: "artifact-release-plan",
      }),
    ).toMatchObject({
      type: "artifact",
      artifact: { type: "markdown", title: "发布方案" },
    });
  });

  it("accepts completed events that return durable produced resources", () => {
    const attachmentId = "10000000-0000-4000-8000-000000000009";
    expect(agentEventSchema.parse({
      sequence: 3,
      type: "completed",
      text: "生成结果见附件。",
      attachmentIds: [attachmentId],
    })).toEqual({
      sequence: 3,
      type: "completed",
      text: "生成结果见附件。",
      attachmentIds: [attachmentId],
    });
  });
});
