/** @vitest-environment node */

import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { POST as createDirectRoom } from "@/app/api/v1/direct-rooms/route";
import { PUT as saveDraft } from "@/app/api/v1/rooms/[roomId]/draft/route";
import { POST as postRoomMessage } from "@/app/api/v1/rooms/[roomId]/messages/route";
import { PUT as updateRead } from "@/app/api/v1/rooms/[roomId]/read/route";
import { PATCH as patchRoom } from "@/app/api/v1/rooms/[roomId]/route";
import { GET as getCurrentWorkspace } from "@/app/api/v1/workspaces/current/route";
import type { RoomMemberStateRecord } from "@/domain/collaboration";
import { closeServerRuntime, getServerRuntime } from "@/server/runtime";

const databaseUrl =
  process.env.TEST_DATABASE_URL
  ?? "postgresql://yoyoo:yoyoo_dev@127.0.0.1:55432/yoyoo_space";

function roomContext(roomId: string) {
  return { params: Promise.resolve({ roomId }) };
}

function jsonRequest(url: string, method: string, body: Record<string, unknown>) {
  return new Request(url, {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function createGroupRoom(name: string) {
  const { collaboration } = await getServerRuntime();
  return collaboration.service.createRoom({
    workspaceId: collaboration.bootstrap.workspace.id,
    createdByPrincipalId: collaboration.bootstrap.principal.id,
    name,
    idempotencyKey: randomUUID(),
  });
}

beforeAll(async () => {
  await closeServerRuntime();
  process.env.DATABASE_URL = databaseUrl;
  process.env.YOYOO_LOCAL_OWNER_ID = `member-state-owner-${randomUUID()}`;
  process.env.YOYOO_AGENT_ADAPTER = "deterministic-test";
  process.env.YOYOO_TEST_AGENT_DELAY_MS = "0";
});

afterAll(async () => {
  await closeServerRuntime();
});

describe("IM member state HTTP boundary", () => {
  it("counts incoming messages as unread and never moves the read cursor backward", async () => {
    const { room } = await createGroupRoom("未读游标测试室");
    const { collaboration } = await getServerRuntime();
    const agent = collaboration.bootstrap.agents[0].principal;
    const repository = collaboration.service;

    const first = await repository.submitMessage({
      roomId: room.id,
      senderPrincipalId: agent.id,
      content: "第一条 Agent 消息",
      idempotencyKey: randomUUID(),
      mentionedPrincipalIds: [],
    });
    const second = await repository.submitMessage({
      roomId: room.id,
      senderPrincipalId: agent.id,
      content: "第二条 Agent 消息",
      idempotencyKey: randomUUID(),
      mentionedPrincipalIds: [],
    });

    const before = (await (await getCurrentWorkspace()).json()) as {
      rooms: Array<{ id: string; unreadCount: number }>;
    };
    expect(before.rooms.find((candidate) => candidate.id === room.id)?.unreadCount).toBe(2);

    const newestResponse = await updateRead(
      jsonRequest(`http://localhost/api/v1/rooms/${room.id}/read`, "PUT", {
        lastReadMessageId: second.message.id,
        readingMessageId: second.message.id,
      }),
      roomContext(room.id),
    );
    expect(newestResponse.status).toBe(200);

    const olderResponse = await updateRead(
      jsonRequest(`http://localhost/api/v1/rooms/${room.id}/read`, "PUT", {
        lastReadMessageId: first.message.id,
        readingMessageId: first.message.id,
      }),
      roomContext(room.id),
    );
    const older = (await olderResponse.json()) as { memberState: RoomMemberStateRecord };
    expect(older.memberState.lastReadMessageId).toBe(second.message.id);
    expect(older.memberState.readingMessageId).toBe(first.message.id);

    const after = (await (await getCurrentWorkspace()).json()) as {
      rooms: Array<{ id: string; unreadCount: number }>;
    };
    expect(after.rooms.find((candidate) => candidate.id === room.id)?.unreadCount).toBe(0);
  });

  it("versions drafts, accepts exact retries, rejects stale writes, and clears only the submitted revision", async () => {
    const { room } = await createGroupRoom("草稿版本测试室");
    const draftUrl = `http://localhost/api/v1/rooms/${room.id}/draft`;
    const firstResponse = await saveDraft(
      jsonRequest(draftUrl, "PUT", { content: "准备发送", expectedRevision: 0 }),
      roomContext(room.id),
    );
    const first = (await firstResponse.json()) as { memberState: RoomMemberStateRecord };
    expect(first.memberState).toMatchObject({ draftContent: "准备发送", draftRevision: 1 });

    const retryResponse = await saveDraft(
      jsonRequest(draftUrl, "PUT", { content: "准备发送", expectedRevision: 0 }),
      roomContext(room.id),
    );
    expect(await retryResponse.json()).toMatchObject({
      memberState: { draftContent: "准备发送", draftRevision: 1 },
    });

    const staleResponse = await saveDraft(
      jsonRequest(draftUrl, "PUT", { content: "旧设备覆盖", expectedRevision: 0 }),
      roomContext(room.id),
    );
    expect(staleResponse.status).toBe(409);
    expect(await staleResponse.json()).toMatchObject({
      error: { code: "DRAFT_REVISION_CONFLICT" },
    });

    const messageResponse = await postRoomMessage(
      new Request(`http://localhost/api/v1/rooms/${room.id}/messages`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "Idempotency-Key": randomUUID(),
        },
        body: JSON.stringify({
          content: "准备发送",
          mentionedPrincipalIds: [],
          draftRevision: 1,
        }),
      }),
      roomContext(room.id),
    );
    const sent = (await messageResponse.json()) as { memberState: RoomMemberStateRecord };
    expect(messageResponse.status).toBe(202);
    expect(sent.memberState).toMatchObject({ draftContent: "", draftRevision: 2 });

    await saveDraft(
      jsonRequest(draftUrl, "PUT", { content: "新设备草稿", expectedRevision: 2 }),
      roomContext(room.id),
    );
    const preserved = await postRoomMessage(
      new Request(`http://localhost/api/v1/rooms/${room.id}/messages`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "Idempotency-Key": randomUUID(),
        },
        body: JSON.stringify({
          content: "旧版本发送",
          mentionedPrincipalIds: [],
          draftRevision: 2,
        }),
      }),
      roomContext(room.id),
    );
    expect(await preserved.json()).toMatchObject({
      memberState: { draftContent: "新设备草稿", draftRevision: 3 },
    });
  });

  it("reuses one stable two-member direct room for the same human and Agent", async () => {
    const { collaboration } = await getServerRuntime();
    const agent = collaboration.bootstrap.agents[0].principal;
    const request = () => jsonRequest("http://localhost/api/v1/direct-rooms", "POST", {
      agentPrincipalId: agent.id,
    });
    const firstResponse = await createDirectRoom(request());
    const secondResponse = await createDirectRoom(request());
    const first = (await firstResponse.json()) as { room: { id: string; kind: string } };
    const second = (await secondResponse.json()) as typeof first;

    expect(firstResponse.status).toBe(201);
    expect(secondResponse.status).toBe(200);
    expect(second.room.id).toBe(first.room.id);
    expect(first.room.kind).toBe("direct");
    await expect(collaboration.service.getRoomMembershipDetails({
      roomId: first.room.id,
      principalId: collaboration.bootstrap.principal.id,
    })).resolves.toMatchObject({ canManage: false, members: [{}, {}], candidates: [] });
  });

  it("keeps a failed send draft and rejects all new messages in archived rooms", async () => {
    const { room } = await createGroupRoom("归档草稿测试室");
    const draftUrl = `http://localhost/api/v1/rooms/${room.id}/draft`;
    await saveDraft(
      jsonRequest(draftUrl, "PUT", { content: "不能丢失", expectedRevision: 0 }),
      roomContext(room.id),
    );
    const archiveResponse = await patchRoom(
      jsonRequest(`http://localhost/api/v1/rooms/${room.id}`, "PATCH", {
        status: "archived",
      }),
      roomContext(room.id),
    );
    expect(archiveResponse.status).toBe(200);

    const sendResponse = await postRoomMessage(
      new Request(`http://localhost/api/v1/rooms/${room.id}/messages`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "Idempotency-Key": randomUUID(),
        },
        body: JSON.stringify({
          content: "发送失败",
          mentionedPrincipalIds: [],
          draftRevision: 1,
        }),
      }),
      roomContext(room.id),
    );
    expect(sendResponse.status).toBe(409);
    expect(await sendResponse.json()).toMatchObject({
      error: { code: "ROOM_LIFECYCLE_CONFLICT" },
    });
    await expect(
      (await getServerRuntime()).collaboration.memberStates.get(
        room.id,
        (await getServerRuntime()).collaboration.bootstrap.principal.id,
      ),
    ).resolves.toMatchObject({ draftContent: "不能丢失", draftRevision: 1 });
  });
});
