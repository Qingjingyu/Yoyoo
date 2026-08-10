/** @vitest-environment node */

import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  DELETE as retractRoomMessage,
  PATCH as editRoomMessage,
} from "@/app/api/v1/rooms/[roomId]/messages/[messageId]/route";
import { closeServerRuntime, getServerRuntime } from "@/server/runtime";
import {
  MessageMutationPermissionError,
  RoomRepository,
} from "@/server/postgres/room-repository";

const databaseUrl =
  process.env.TEST_DATABASE_URL ??
  "postgresql://yoyoo:yoyoo_dev@127.0.0.1:55432/yoyoo_space";

function routeContext(roomId: string, messageId: string) {
  return { params: Promise.resolve({ roomId, messageId }) };
}

function mutationRequest(
  roomId: string,
  messageId: string,
  method: "PATCH" | "DELETE",
  body: Record<string, unknown>,
): Request {
  return new Request(
    `http://localhost/api/v1/rooms/${roomId}/messages/${messageId}`,
    {
      method,
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    },
  );
}

describe("message revisions", () => {
  beforeAll(async () => {
    await closeServerRuntime();
    process.env.DATABASE_URL = databaseUrl;
    process.env.YOYOO_LOCAL_OWNER_ID = `message-revision-owner-${randomUUID()}`;
    process.env.YOYOO_AGENT_ADAPTER = "deterministic-test";
    process.env.YOYOO_TEST_AGENT_DELAY_MS = "250";
  });

  afterAll(async () => {
    await closeServerRuntime();
  });

  it("edits and retracts only the current revision while preserving audit history", async () => {
    const runtime = await getServerRuntime();
    const created = await runtime.collaboration.service.createRoom({
      workspaceId: runtime.collaboration.bootstrap.workspace.id,
      createdByPrincipalId: runtime.collaboration.bootstrap.principal.id,
      name: "消息修订测试室",
      idempotencyKey: randomUUID(),
    });
    const submission = await runtime.collaboration.service.submitMessage({
      roomId: created.room.id,
      senderPrincipalId: runtime.collaboration.bootstrap.principal.id,
      content: "第一版内容",
      idempotencyKey: randomUUID(),
      mentionedPrincipalIds: [],
    });

    const editResponse = await editRoomMessage(
      mutationRequest(created.room.id, submission.message.id, "PATCH", {
        content: "第二版内容",
        expectedRevisionNumber: 1,
      }),
      routeContext(created.room.id, submission.message.id),
    );
    const edited = (await editResponse.json()) as {
      message: { content: string; revisionNumber: number; retractedAt: string | null };
    };
    expect(editResponse.status).toBe(200);
    expect(edited.message).toMatchObject({
      content: "第二版内容",
      revisionNumber: 2,
      retractedAt: null,
    });
    await expect(runtime.search.search({
      workspaceId: runtime.collaboration.bootstrap.workspace.id,
      principalId: runtime.collaboration.bootstrap.principal.id,
      roomId: created.room.id,
      query: "第二版内容",
    })).resolves.toMatchObject({
      results: [expect.objectContaining({ messageId: submission.message.id })],
    });
    await expect(runtime.search.search({
      workspaceId: runtime.collaboration.bootstrap.workspace.id,
      principalId: runtime.collaboration.bootstrap.principal.id,
      roomId: created.room.id,
      query: "第一版内容",
    })).resolves.toMatchObject({ results: [] });

    const staleResponse = await editRoomMessage(
      mutationRequest(created.room.id, submission.message.id, "PATCH", {
        content: "过期客户端覆盖",
        expectedRevisionNumber: 1,
      }),
      routeContext(created.room.id, submission.message.id),
    );
    expect(staleResponse.status).toBe(409);
    await expect(staleResponse.json()).resolves.toMatchObject({
      error: { code: "MESSAGE_REVISION_CONFLICT" },
    });

    const retractResponse = await retractRoomMessage(
      mutationRequest(created.room.id, submission.message.id, "DELETE", {
        expectedRevisionNumber: 2,
      }),
      routeContext(created.room.id, submission.message.id),
    );
    const retracted = (await retractResponse.json()) as {
      message: { content: string; revisionNumber: number; retractedAt: string | null };
    };
    expect(retractResponse.status).toBe(200);
    expect(retracted.message.content).toBe("");
    expect(retracted.message.revisionNumber).toBe(3);
    expect(retracted.message.retractedAt).not.toBeNull();

    const repeatedRetraction = await retractRoomMessage(
      mutationRequest(created.room.id, submission.message.id, "DELETE", {
        expectedRevisionNumber: 2,
      }),
      routeContext(created.room.id, submission.message.id),
    );
    expect(repeatedRetraction.status).toBe(200);
    await expect(repeatedRetraction.json()).resolves.toMatchObject({
      message: { revisionNumber: 3 },
    });

    const repository = new RoomRepository(runtime.pool);
    await expect(repository.listMessageRevisions(submission.message.id)).resolves.toMatchObject([
      { revisionNumber: 1, action: "created", content: "第一版内容" },
      { revisionNumber: 2, action: "edited", content: "第二版内容" },
      { revisionNumber: 3, action: "retracted", content: "第二版内容" },
    ]);

    const agent = runtime.collaboration.bootstrap.agents[0].principal;
    const followUp = await runtime.collaboration.service.submitMessage({
      roomId: created.room.id,
      senderPrincipalId: runtime.collaboration.bootstrap.principal.id,
      content: "@Agent 请基于仍然可见的上下文回答",
      idempotencyKey: randomUUID(),
      mentionedPrincipalIds: [agent.id],
    });
    const execution = await runtime.collaboration.runs.getExecutionContext(
      followUp.runs[0].id,
    );
    expect("history" in execution.request).toBe(true);
    const history = "history" in execution.request ? execution.request.history : [];
    expect(history.map((message) => message.content)).not.toContain(
      "第二版内容",
    );
    await Promise.all(
      followUp.runs.map((run) => runtime.collaboration.coordinator.waitFor(run.id)),
    );
  });

  it("rejects another member and messages with an active Agent execution", async () => {
    const runtime = await getServerRuntime();
    const repository = new RoomRepository(runtime.pool);
    const room = runtime.collaboration.bootstrap.room;
    const owner = runtime.collaboration.bootstrap.principal;
    const agent = runtime.collaboration.bootstrap.agents[0].principal;
    const plain = await runtime.collaboration.service.submitMessage({
      roomId: room.id,
      senderPrincipalId: owner.id,
      content: "只有发送者能修改",
      idempotencyKey: randomUUID(),
      mentionedPrincipalIds: [],
    });
    await expect(
      repository.editMessage({
        roomId: room.id,
        messageId: plain.message.id,
        actorPrincipalId: agent.id,
        content: "越权修改",
        expectedRevisionNumber: 1,
      }),
    ).rejects.toBeInstanceOf(MessageMutationPermissionError);

    const routed = await runtime.collaboration.service.submitMessage({
      roomId: room.id,
      senderPrincipalId: owner.id,
      content: "@Agent 正在执行",
      idempotencyKey: randomUUID(),
      mentionedPrincipalIds: [agent.id],
    });
    await expect(
      repository.retractMessage({
        roomId: room.id,
        messageId: routed.message.id,
        actorPrincipalId: owner.id,
        expectedRevisionNumber: 1,
      }),
    ).rejects.toMatchObject({ name: "MessageRevisionConflictError" });
    await Promise.all(
      routed.runs.map((run) => runtime.collaboration.coordinator.waitFor(run.id)),
    );
  });

  it("rejects archived-room and system-message mutations", async () => {
    const runtime = await getServerRuntime();
    const repository = new RoomRepository(runtime.pool);
    const owner = runtime.collaboration.bootstrap.principal;
    const created = await runtime.collaboration.service.createRoom({
      workspaceId: runtime.collaboration.bootstrap.workspace.id,
      createdByPrincipalId: owner.id,
      name: "不可修改测试室",
      idempotencyKey: randomUUID(),
    });
    const message = await runtime.collaboration.service.submitMessage({
      roomId: created.room.id,
      senderPrincipalId: owner.id,
      content: "归档后不可修改",
      idempotencyKey: randomUUID(),
      mentionedPrincipalIds: [],
    });
    await runtime.collaboration.service.setRoomStatus({
      roomId: created.room.id,
      principalId: owner.id,
      status: "archived",
    });
    await expect(repository.editMessage({
      roomId: created.room.id,
      messageId: message.message.id,
      actorPrincipalId: owner.id,
      content: "不应成功",
      expectedRevisionNumber: 1,
    })).rejects.toMatchObject({ name: "RoomLifecycleConflictError" });

    const systemPrincipal = await runtime.pool.query<{ id: string }>(
      "SELECT id FROM principals WHERE kind = 'system' ORDER BY created_at LIMIT 1",
    );
    const systemMessageId = randomUUID();
    await runtime.pool.query(
      `INSERT INTO room_messages
        (id, room_id, sender_principal_id, kind, content, status)
       VALUES ($1, $2, $3, 'system', '系统通知', 'completed')`,
      [systemMessageId, runtime.collaboration.bootstrap.room.id, systemPrincipal.rows[0].id],
    );
    await runtime.pool.query(
      `INSERT INTO room_message_revisions
        (id, room_id, message_id, revision_number, action,
         actor_principal_id, content, mentioned_principal_ids)
       VALUES ($1, $2, $3, 1, 'created', $4, '系统通知', ARRAY[]::uuid[])`,
      [randomUUID(), runtime.collaboration.bootstrap.room.id, systemMessageId, systemPrincipal.rows[0].id],
    );
    await expect(repository.retractMessage({
      roomId: runtime.collaboration.bootstrap.room.id,
      messageId: systemMessageId,
      actorPrincipalId: owner.id,
      expectedRevisionNumber: 1,
    })).rejects.toBeInstanceOf(MessageMutationPermissionError);
  });
});
