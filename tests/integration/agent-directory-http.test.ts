/** @vitest-environment node */

import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { GET as getDirectory } from "@/app/api/v1/agent-gateway/directory/route";
import { POST as sendRoomMessage } from "@/app/api/v1/agent-gateway/rooms/[roomId]/messages/route";
import { POST as createAgent } from "@/app/api/v1/workspaces/current/agents/route";
import { RoomRepository } from "@/server/postgres/room-repository";
import { closeServerRuntime, getServerRuntime } from "@/server/runtime";

const databaseUrl =
  process.env.TEST_DATABASE_URL ??
  "postgresql://yoyoo:yoyoo_dev@127.0.0.1:55432/yoyoo_space";

function jsonRequest(url: string, body: Record<string, unknown>, token?: string) {
  const headers = new Headers({ "content-type": "application/json" });
  if (token) headers.set("authorization", `Bearer ${token}`);
  return new Request(url, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}

function roomContext(roomId: string) {
  return { params: Promise.resolve({ roomId }) };
}

beforeAll(async () => {
  await closeServerRuntime();
  process.env.DATABASE_URL = databaseUrl;
  process.env.YOYOO_LOCAL_OWNER_ID = `agent-directory-owner-${randomUUID()}`;
  process.env.YOYOO_AGENT_ADAPTER = "deterministic-test";
  delete process.env.YOYOO_AICARD_ISSUER;
  delete process.env.YOYOO_AICARD_CLIENT_ID;
  delete process.env.YOYOO_AICARD_AUDIENCE;
});

afterAll(async () => {
  await closeServerRuntime();
});

describe("Agent ID directory and proactive room messaging", () => {
  it("returns only rooms the authenticated Agent has joined, with canonical IDs", async () => {
    const createdResponse = await createAgent(
      jsonRequest("http://localhost/api/v1/workspaces/current/agents", {
        handle: `directory-${randomUUID().slice(0, 8)}`,
        displayName: "目录 Agent",
      }),
    );
    const created = (await createdResponse.json()) as {
      agent: { principalId: string; workspaceId: string };
      token: string;
    };
    const runtime = await getServerRuntime();
    const rooms = new RoomRepository(runtime.pool);
    const joined = await rooms.create({
      workspaceId: runtime.collaboration.bootstrap.workspace.id,
      name: "同名工作室",
      createdByPrincipalId: runtime.collaboration.bootstrap.principal.id,
    });
    const notJoined = await rooms.create({
      workspaceId: runtime.collaboration.bootstrap.workspace.id,
      name: "同名工作室",
      createdByPrincipalId: runtime.collaboration.bootstrap.principal.id,
    });
    await rooms.addMember({
      roomId: joined.id,
      principalId: created.agent.principalId,
      role: "member",
      listenerPolicy: "mention_only",
    });

    const response = await getDirectory(
      new Request("http://localhost/api/v1/agent-gateway/directory", {
        headers: { authorization: `Bearer ${created.token}` },
      }),
    );
    const body = (await response.json()) as {
      self: { principalId: string; workspaceId: string };
      rooms: Array<{
        roomId: string;
        name: string;
        members: Array<{ principalId: string }>;
        allowedActions: {
          sendMessage: boolean;
          mentionMembers: boolean;
          replyToMessage: boolean;
          continueThread: boolean;
        };
      }>;
    };

    expect(response.status).toBe(200);
    expect(body.self).toMatchObject({
      principalId: created.agent.principalId,
      workspaceId: created.agent.workspaceId,
    });
    expect(body.rooms).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          roomId: joined.id,
          name: "同名工作室",
          allowedActions: {
            sendMessage: true,
            mentionMembers: true,
            replyToMessage: true,
            continueThread: true,
          },
          members: expect.arrayContaining([
            expect.objectContaining({ principalId: created.agent.principalId }),
          ]),
        }),
      ]),
    );
    expect(body.rooms.map((room) => room.roomId)).not.toContain(notJoined.id);

    await runtime.pool.query(
      `UPDATE workspace_members SET status = 'removed'
       WHERE workspace_id = $1 AND principal_id = $2`,
      [created.agent.workspaceId, runtime.collaboration.bootstrap.principal.id],
    );
    try {
      const filteredResponse = await getDirectory(
        new Request("http://localhost/api/v1/agent-gateway/directory", {
          headers: { authorization: `Bearer ${created.token}` },
        }),
      );
      const filtered = (await filteredResponse.json()) as typeof body;
      expect(filteredResponse.status).toBe(200);
      expect(
        filtered.rooms
          .find((room) => room.roomId === joined.id)
          ?.members.map((member) => member.principalId),
      ).not.toContain(runtime.collaboration.bootstrap.principal.id);
    } finally {
      await runtime.pool.query(
        `UPDATE workspace_members SET status = 'active'
         WHERE workspace_id = $1 AND principal_id = $2`,
        [created.agent.workspaceId, runtime.collaboration.bootstrap.principal.id],
      );
    }

    const anonymous = await getDirectory(
      new Request("http://localhost/api/v1/agent-gateway/directory"),
    );
    expect(anonymous.status).toBe(401);
  });

  it("derives the sender from the Agent credential and sends idempotently to one room ID", async () => {
    const createdResponse = await createAgent(
      jsonRequest("http://localhost/api/v1/workspaces/current/agents", {
        handle: `sender-${randomUUID().slice(0, 8)}`,
        displayName: "主动消息 Agent",
      }),
    );
    const created = (await createdResponse.json()) as {
      agent: { principalId: string };
      token: string;
    };
    const runtime = await getServerRuntime();
    const rooms = new RoomRepository(runtime.pool);
    const room = await rooms.create({
      workspaceId: runtime.collaboration.bootstrap.workspace.id,
      name: "指定投递室",
      createdByPrincipalId: runtime.collaboration.bootstrap.principal.id,
    });
    await rooms.addMember({
      roomId: room.id,
      principalId: created.agent.principalId,
      role: "member",
      listenerPolicy: "mention_only",
    });
    const idempotencyKey = randomUUID();
    const request = () => {
      const value = jsonRequest(
        `http://localhost/api/v1/agent-gateway/rooms/${room.id}/messages`,
        { content: "按 room_id 主动发送", mentionedPrincipalIds: [] },
        created.token,
      );
      value.headers.set("Idempotency-Key", idempotencyKey);
      return value;
    };

    const first = await sendRoomMessage(request(), roomContext(room.id));
    const duplicate = await sendRoomMessage(request(), roomContext(room.id));
    const firstBody = (await first.json()) as {
      duplicate: boolean;
      message: { id: string; roomId: string; senderPrincipalId: string };
    };
    const duplicateBody = (await duplicate.json()) as typeof firstBody;

    expect(first.status).toBe(202);
    expect(firstBody).toMatchObject({
      duplicate: false,
      message: {
        roomId: room.id,
        senderPrincipalId: created.agent.principalId,
      },
    });
    expect(duplicate.status).toBe(200);
    expect(duplicateBody).toMatchObject({
      duplicate: true,
      message: { id: firstBody.message.id },
    });

    const conflicting = jsonRequest(
      `http://localhost/api/v1/agent-gateway/rooms/${room.id}/messages`,
      { content: "同一幂等键不能替换正文", mentionedPrincipalIds: [] },
      created.token,
    );
    conflicting.headers.set("Idempotency-Key", idempotencyKey);
    const conflictResponse = await sendRoomMessage(
      conflicting,
      roomContext(room.id),
    );
    expect(conflictResponse.status).toBe(409);
    expect(await conflictResponse.json()).toMatchObject({
      error: { code: "MESSAGE_IDEMPOTENCY_CONFLICT" },
    });

    const invalidMention = jsonRequest(
      `http://localhost/api/v1/agent-gateway/rooms/${room.id}/messages`,
      { content: "不能提及房间外身份", mentionedPrincipalIds: [randomUUID()] },
      created.token,
    );
    invalidMention.headers.set("Idempotency-Key", randomUUID());
    const invalidMentionResponse = await sendRoomMessage(
      invalidMention,
      roomContext(room.id),
    );
    expect(invalidMentionResponse.status).toBe(409);
    expect(await invalidMentionResponse.json()).toMatchObject({
      error: { code: "ROOM_MEMBERSHIP_CONFLICT" },
    });

    const spoofed = jsonRequest(
      `http://localhost/api/v1/agent-gateway/rooms/${room.id}/messages`,
      {
        content: "不能伪造发送者",
        mentionedPrincipalIds: [],
        senderPrincipalId: runtime.collaboration.bootstrap.principal.id,
      },
      created.token,
    );
    spoofed.headers.set("Idempotency-Key", randomUUID());
    expect((await sendRoomMessage(spoofed, roomContext(room.id))).status).toBe(400);

    const inaccessible = await rooms.create({
      workspaceId: runtime.collaboration.bootstrap.workspace.id,
      name: "无权会话",
      createdByPrincipalId: runtime.collaboration.bootstrap.principal.id,
    });
    const denied = jsonRequest(
      `http://localhost/api/v1/agent-gateway/rooms/${inaccessible.id}/messages`,
      { content: "不能发到未加入的会话", mentionedPrincipalIds: [] },
      created.token,
    );
    denied.headers.set("Idempotency-Key", randomUUID());
    expect(
      (await sendRoomMessage(denied, roomContext(inaccessible.id))).status,
    ).toBe(404);
  });
});
