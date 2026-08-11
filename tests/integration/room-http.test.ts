/** @vitest-environment node */

import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { GET as getCurrentWorkspace } from "@/app/api/v1/workspaces/current/route";
import { POST as createRoom } from "@/app/api/v1/rooms/route";
import { GET as getRoom, PATCH as patchRoom } from "@/app/api/v1/rooms/[roomId]/route";
import { GET as getRoomEvents } from "@/app/api/v1/rooms/[roomId]/events/route";
import { POST as postRoomMessage } from "@/app/api/v1/rooms/[roomId]/messages/route";
import {
  GET as getRoomMembers,
  POST as addRoomMember,
} from "@/app/api/v1/rooms/[roomId]/members/route";
import { DELETE as removeRoomMember } from "@/app/api/v1/rooms/[roomId]/members/[principalId]/route";
import { POST as interveneRun } from "@/app/api/v1/rooms/[roomId]/runs/[runId]/intervene/route";
import { POST as retryRun } from "@/app/api/v1/rooms/[roomId]/runs/[runId]/retry/route";
import { closeServerRuntime, getServerRuntime } from "@/server/runtime";
import { RoomRepository } from "@/server/postgres/room-repository";

const databaseUrl =
  process.env.TEST_DATABASE_URL ??
  "postgresql://yoyoo:yoyoo_dev@127.0.0.1:55432/yoyoo_space";

interface WorkspaceBody {
  principal: { id: string; displayName: string };
  workspace: { id: string; name: string };
  rooms: Array<{
    id: string;
    name: string;
    lastMessagePreview: string | null;
    lastMessageAt: string | null;
  }>;
  archivedRooms: Array<{ id: string; name: string }>;
  agents: Array<{ principalId: string; displayName: string; adapterId: string }>;
}

interface SubmissionBody {
  duplicate: boolean;
  message: { id: string; content: string };
  runs: Array<{
    id: string;
    targetAgentPrincipalId: string;
    status: string;
  }>;
}

function routeContext(roomId: string) {
  return { params: Promise.resolve({ roomId }) };
}

function runRouteContext(roomId: string, runId: string) {
  return { params: Promise.resolve({ roomId, runId }) };
}

function memberRouteContext(roomId: string, principalId: string) {
  return { params: Promise.resolve({ roomId, principalId }) };
}

function messageRequest(
  roomId: string,
  body: Record<string, unknown>,
  idempotencyKey?: string,
): Request {
  const headers = new Headers({ "content-type": "application/json" });
  if (idempotencyKey) headers.set("Idempotency-Key", idempotencyKey);
  return new Request(`http://localhost/api/v1/rooms/${roomId}/messages`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}

function roomRequest(body: Record<string, unknown>, idempotencyKey?: string): Request {
  const headers = new Headers({ "content-type": "application/json" });
  if (idempotencyKey) headers.set("Idempotency-Key", idempotencyKey);
  return new Request("http://localhost/api/v1/rooms", {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}

function roomPatchRequest(roomId: string, body: Record<string, unknown>): Request {
  return new Request(`http://localhost/api/v1/rooms/${roomId}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function memberRequest(
  roomId: string,
  method: "POST" | "DELETE",
  body?: Record<string, unknown>,
): Request {
  return new Request(`http://localhost/api/v1/rooms/${roomId}/members`, {
    method,
    ...(body
      ? {
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        }
      : {}),
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
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(message);
}

beforeAll(async () => {
  await closeServerRuntime();
  process.env.DATABASE_URL = databaseUrl;
  process.env.YOYOO_LOCAL_OWNER_ID = `room-http-owner-${randomUUID()}`;
  process.env.YOYOO_AGENT_ADAPTER = "deterministic-test";
  process.env.YOYOO_TEST_AGENT_DELAY_MS = "35";
  process.env.YOYOO_DEMO_REVIEWER_FAILURE_PATTERN = "可恢复的失败";
});

afterAll(async () => {
  await closeServerRuntime();
});

describe("room HTTP boundary", () => {
  it("bootstraps one private workspace with Su Bai and three Agent principals", async () => {
    const response = await getCurrentWorkspace();
    const body = (await response.json()) as WorkspaceBody;

    expect(response.status).toBe(200);
    expect(body.principal.displayName).toBe("Su Bai");
    expect(body.workspace.name).toBe("Yoyoo Space");
    expect(body.rooms).toHaveLength(1);
    expect(body.archivedRooms).toEqual([]);
    expect(body.agents).toHaveLength(3);
    expect(new Set(body.agents.map((agent) => agent.principalId)).size).toBe(3);
    expect(new Set(body.agents.map((agent) => agent.adapterId)).size).toBe(3);
  });

  it("renames, archives, and restores a room through the owner boundary", async () => {
    const workspace = (await (await getCurrentWorkspace()).json()) as WorkspaceBody;
    const createResponse = await createRoom(
      roomRequest({ name: "临时项目室" }, randomUUID()),
    );
    const created = (await createResponse.json()) as { room: { id: string } };
    const roomId = created.room.id;
    const message = "归档和恢复后仍然存在的房间消息";
    const messageResponse = await postRoomMessage(
      messageRequest(roomId, { content: message, mentionedPrincipalIds: [] }, randomUUID()),
      routeContext(roomId),
    );
    expect(messageResponse.status).toBe(202);

    const invalidResponse = await patchRoom(
      roomPatchRequest(roomId, { name: "   " }),
      routeContext(roomId),
    );
    expect(invalidResponse.status).toBe(400);

    const renameResponse = await patchRoom(
      roomPatchRequest(roomId, { name: "产品归档室" }),
      routeContext(roomId),
    );
    expect(renameResponse.status).toBe(200);
    expect(await renameResponse.json()).toMatchObject({ name: "产品归档室" });

    const archiveResponse = await patchRoom(
      roomPatchRequest(roomId, { status: "archived" }),
      routeContext(roomId),
    );
    expect(archiveResponse.status).toBe(200);
    const afterArchive = (await (await getCurrentWorkspace()).json()) as WorkspaceBody;
    expect(afterArchive.rooms.map((room) => room.id)).not.toContain(roomId);
    expect(afterArchive.archivedRooms).toContainEqual(
      expect.objectContaining({ id: roomId, name: "产品归档室" }),
    );
    expect(
      await getRoom(
        new Request(`http://localhost/api/v1/rooms/${roomId}`),
        routeContext(roomId),
      ),
    ).toMatchObject({ status: 404 });

    const restoreResponse = await patchRoom(
      roomPatchRequest(roomId, { status: "active" }),
      routeContext(roomId),
    );
    expect(restoreResponse.status).toBe(200);
    const restoredResponse = await getRoom(
      new Request(`http://localhost/api/v1/rooms/${roomId}`),
      routeContext(roomId),
    );
    const restored = (await restoredResponse.json()) as {
      room: { id: string };
      messages: Array<{ content: string }>;
    };
    expect(restoredResponse.status).toBe(200);
    expect(restored.room.id).toBe(roomId);
    expect(restored.messages).toContainEqual(expect.objectContaining({ content: message }));
    expect(workspace.rooms.length).toBeGreaterThan(0);
  });

  it("updates the room purpose without changing its canonical room ID", async () => {
    const createResponse = await createRoom(
      roomRequest({ name: "学习室" }, randomUUID()),
    );
    const created = (await createResponse.json()) as { room: { id: string } };
    const response = await patchRoom(
      roomPatchRequest(created.room.id, { purpose: "长期整理机器学习资料" }),
      routeContext(created.room.id),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      id: created.room.id,
      purpose: "长期整理机器学习资料",
    });
    const invalid = await patchRoom(
      roomPatchRequest(created.room.id, { purpose: "x".repeat(501) }),
      routeContext(created.room.id),
    );
    expect(invalid.status).toBe(400);
  });

  it("creates a named room idempotently and includes it in the accessible workspace", async () => {
    const idempotencyKey = randomUUID();
    const firstResponse = await createRoom(
      roomRequest({ name: "产品发布室" }, idempotencyKey),
    );
    const repeatedResponse = await createRoom(
      roomRequest({ name: "不会覆盖原名称" }, idempotencyKey),
    );
    const first = (await firstResponse.json()) as {
      duplicate: boolean;
      room: { id: string; name: string };
    };
    const repeated = (await repeatedResponse.json()) as typeof first;

    expect(firstResponse.status).toBe(201);
    expect(first).toMatchObject({
      duplicate: false,
      room: { name: "产品发布室" },
    });
    expect(repeatedResponse.status).toBe(200);
    expect(repeated).toMatchObject({
      duplicate: true,
      room: { id: first.room.id, name: "产品发布室" },
    });

    const workspace = (await (await getCurrentWorkspace()).json()) as WorkspaceBody;
    expect(workspace.rooms).toContainEqual(
      expect.objectContaining({ id: first.room.id, name: "产品发布室" }),
    );

    const snapshotResponse = await getRoom(
      new Request(`http://localhost/api/v1/rooms/${first.room.id}`),
      routeContext(first.room.id),
    );
    const snapshot = (await snapshotResponse.json()) as { members: unknown[] };
    expect(snapshotResponse.status).toBe(200);
    expect(snapshot.members).toHaveLength(4);
  });

  it("lists, removes, and re-adds room members through the owner boundary", async () => {
    const workspace = (await (await getCurrentWorkspace()).json()) as WorkspaceBody;
    const createResponse = await createRoom(
      roomRequest({ name: "成员管理测试室" }, randomUUID()),
    );
    const created = (await createResponse.json()) as { room: { id: string } };
    const roomId = created.room.id;
    const agent = workspace.agents[0];

    const initialResponse = await getRoomMembers(
      new Request(`http://localhost/api/v1/rooms/${roomId}/members`),
      routeContext(roomId),
    );
    const initial = (await initialResponse.json()) as {
      canManage: boolean;
      canEditProfile: boolean;
      members: Array<{ principalId: string; status: string }>;
      candidates: Array<{ principalId: string }>;
    };
    expect(initialResponse.status).toBe(200);
    expect(initial.canManage).toBe(true);
    expect(initial.canEditProfile).toBe(true);
    expect(initial.members).toHaveLength(4);
    expect(initial.candidates).toEqual([]);

    const removedResponse = await removeRoomMember(
      memberRequest(roomId, "DELETE"),
      memberRouteContext(roomId, agent.principalId),
    );
    expect(removedResponse.status).toBe(200);
    expect(await removedResponse.json()).toMatchObject({
      member: { principalId: agent.principalId, status: "removed" },
    });
    expect(
      await removeRoomMember(
        memberRequest(roomId, "DELETE"),
        memberRouteContext(roomId, agent.principalId),
      ),
    ).toMatchObject({ status: 200 });

    const afterRemoval = (await (
      await getRoomMembers(
        new Request(`http://localhost/api/v1/rooms/${roomId}/members`),
        routeContext(roomId),
      )
    ).json()) as {
      members: Array<{ principalId: string }>;
      candidates: Array<{ principalId: string }>;
    };
    expect(afterRemoval.members.map((member) => member.principalId)).not.toContain(
      agent.principalId,
    );
    expect(afterRemoval.candidates).toContainEqual(
      expect.objectContaining({ principalId: agent.principalId }),
    );

    const invalidResponse = await addRoomMember(
      memberRequest(roomId, "POST", { principalId: "invalid" }),
      routeContext(roomId),
    );
    expect(invalidResponse.status).toBe(400);
    const addedResponse = await addRoomMember(
      memberRequest(roomId, "POST", { principalId: agent.principalId }),
      routeContext(roomId),
    );
    expect(addedResponse.status).toBe(200);
    expect(await addedResponse.json()).toMatchObject({
      member: { principalId: agent.principalId, status: "active" },
    });

    const ownerResponse = await removeRoomMember(
      memberRequest(roomId, "DELETE"),
      memberRouteContext(roomId, workspace.principal.id),
    );
    const ownerBody = (await ownerResponse.json()) as { error: { code: string } };
    expect(ownerResponse.status).toBe(409);
    expect(ownerBody.error.code).toBe("ROOM_MEMBERSHIP_CONFLICT");
  });

  it("rejects invalid room creation and hides rooms the principal cannot access", async () => {
    const missingKeyResponse = await createRoom(roomRequest({ name: "无请求键" }));
    const invalidNameResponse = await createRoom(
      roomRequest({ name: "   " }, randomUUID()),
    );
    expect(missingKeyResponse.status).toBe(400);
    expect(invalidNameResponse.status).toBe(400);

    const runtime = await getServerRuntime();
    const repository = new RoomRepository(runtime.pool);
    const inaccessible = await repository.create({
      workspaceId: runtime.collaboration.bootstrap.workspace.id,
      name: "不可访问房间",
      createdByPrincipalId: runtime.collaboration.bootstrap.agents[0].principal.id,
    });
    const response = await getRoom(
      new Request(`http://localhost/api/v1/rooms/${inaccessible.id}`),
      routeContext(inaccessible.id),
    );
    const body = (await response.json()) as { error: { code: string } };

    expect(response.status).toBe(404);
    expect(body.error.code).toBe("ROOM_NOT_FOUND");
  });

  it("routes one message to selected Agents, streams events, and restores room facts", async () => {
    const workspaceResponse = await getCurrentWorkspace();
    const workspace = (await workspaceResponse.json()) as WorkspaceBody;
    const roomId = workspace.rooms[0].id;
    const planner = workspace.agents.find((agent) =>
      agent.displayName.includes("Planner"),
    );
    const reviewer = workspace.agents.find((agent) =>
      agent.displayName.includes("Reviewer"),
    );
    expect(planner).toBeDefined();
    expect(reviewer).toBeDefined();

    const key = randomUUID();
    const requestBody = {
      content: "@Planner @Reviewer 请共同完成发布方案",
      mentionedPrincipalIds: [planner!.principalId, reviewer!.principalId],
    };
    const firstResponse = await postRoomMessage(
      messageRequest(roomId, requestBody, key),
      routeContext(roomId),
    );
    const first = (await firstResponse.json()) as SubmissionBody;
    const repeatedResponse = await postRoomMessage(
      messageRequest(roomId, requestBody, key),
      routeContext(roomId),
    );
    const repeated = (await repeatedResponse.json()) as SubmissionBody;

    expect(firstResponse.status).toBe(202);
    expect(repeatedResponse.status).toBe(200);
    expect(first.runs).toHaveLength(2);
    expect(repeated.duplicate).toBe(true);
    expect(repeated.message.id).toBe(first.message.id);
    expect(repeated.runs.map((run) => run.id).sort()).toEqual(
      first.runs.map((run) => run.id).sort(),
    );

    const plannerRun = first.runs.find(
      (run) => run.targetAgentPrincipalId === planner!.principalId,
    );
    const eventResponse = await getRoomEvents(
      new Request(
        `http://localhost/api/v1/rooms/${roomId}/events?runId=${plannerRun!.id}`,
      ),
      routeContext(roomId),
    );
    const eventText = await eventResponse.text();
    expect(eventResponse.status).toBe(200);
    expect(eventText).toContain("event: delegation");
    expect(eventText).toContain("event: completed");

    const runtime = await getServerRuntime();
    await waitFor(
      async () => {
        const snapshot = await runtime.collaboration.service.getSnapshot(roomId);
        return snapshot.delegations.length === 1 && snapshot.artifacts.length === 1;
      },
      "Delegation and Artifact did not persist",
    );
    const refreshResponse = await getRoom(
      new Request(`http://localhost/api/v1/rooms/${roomId}`),
      routeContext(roomId),
    );
    const refresh = (await refreshResponse.json()) as {
      members: unknown[];
      messages: Array<{ content: string; kind: string }>;
      delegations: unknown[];
      artifacts: unknown[];
    };
    expect(refresh.members).toHaveLength(4);
    expect(refresh.messages).toContainEqual(
      expect.objectContaining({ content: requestBody.content, kind: "message" }),
    );
    expect(refresh.delegations).toHaveLength(1);
    expect(refresh.artifacts).toHaveLength(1);
    await Promise.all(
      first.runs.map((run) => runtime.collaboration.coordinator.waitFor(run.id)),
    );
  });

  it("persists a human intervention and stops only its targeted Agent run", async () => {
    const workspace = (await (await getCurrentWorkspace()).json()) as WorkspaceBody;
    const roomId = workspace.rooms[0].id;
    const reviewer = workspace.agents.find((agent) =>
      agent.displayName.includes("Reviewer"),
    );
    const submissionResponse = await postRoomMessage(
      messageRequest(
        roomId,
        {
          content: "@Reviewer 请做一次长时间审阅",
          mentionedPrincipalIds: [reviewer!.principalId],
        },
        randomUUID(),
      ),
      routeContext(roomId),
    );
    const submission = (await submissionResponse.json()) as SubmissionBody;
    const run = submission.runs[0];
    const runtime = await getServerRuntime();
    await waitFor(
      async () => (await runtime.collaboration.runs.get(run.id)).status === "running",
      "Reviewer run did not start",
    );

    const interventionResponse = await interveneRun(
      new Request(
        `http://localhost/api/v1/rooms/${roomId}/runs/${run.id}/intervene`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "Idempotency-Key": randomUUID(),
          },
          body: JSON.stringify({ content: "先停止，等最终方案生成后再审阅。" }),
        },
      ),
      runRouteContext(roomId, run.id),
    );
    expect(interventionResponse.status).toBe(202);

    await runtime.collaboration.coordinator.waitFor(run.id);
    expect(await runtime.collaboration.runs.get(run.id)).toMatchObject({
      status: "stopped",
    });
    const snapshot = await runtime.collaboration.service.getSnapshot(roomId);
    expect(snapshot.messages).toContainEqual(
      expect.objectContaining({
        kind: "intervention",
        content: "先停止，等最终方案生成后再审阅。",
      }),
    );
  });

  it("retries a failed room run idempotently", async () => {
    const workspace = (await (await getCurrentWorkspace()).json()) as WorkspaceBody;
    const roomId = workspace.rooms[0].id;
    const reviewer = workspace.agents.find((agent) =>
      agent.displayName.includes("Reviewer"),
    );
    const submissionResponse = await postRoomMessage(
      messageRequest(
        roomId,
        {
          content: "@Reviewer 请触发一次可恢复的失败",
          mentionedPrincipalIds: [reviewer!.principalId],
        },
        randomUUID(),
      ),
      routeContext(roomId),
    );
    const submission = (await submissionResponse.json()) as SubmissionBody;
    const original = submission.runs[0];
    const runtime = await getServerRuntime();
    await runtime.collaboration.coordinator.waitFor(original.id);
    expect(await runtime.collaboration.runs.get(original.id)).toMatchObject({
      status: "failed",
      errorCode: "LOCAL_REVIEW_FAILURE",
    });

    const key = randomUUID();
    const makeRequest = () =>
      new Request(
        `http://localhost/api/v1/rooms/${roomId}/runs/${original.id}/retry`,
        { method: "POST", headers: { "Idempotency-Key": key } },
      );
    const firstResponse = await retryRun(
      makeRequest(),
      runRouteContext(roomId, original.id),
    );
    const secondResponse = await retryRun(
      makeRequest(),
      runRouteContext(roomId, original.id),
    );
    const first = (await firstResponse.json()) as {
      duplicate: boolean;
      run: { id: string; retryOfRunId: string };
    };
    const second = (await secondResponse.json()) as typeof first;

    expect(firstResponse.status).toBe(202);
    expect(first.run.retryOfRunId).toBe(original.id);
    expect(second.duplicate).toBe(true);
    expect(second.run.id).toBe(first.run.id);
    await runtime.collaboration.coordinator.waitFor(first.run.id);
  });

  it("accepts a PostgreSQL GUID owner retained from the deterministic migration", async () => {
    await closeServerRuntime();
    process.env.YOYOO_LOCAL_OWNER_ID = "local-owner-ui";
    const runtime = await getServerRuntime();
    expect(runtime.collaboration.bootstrap.principal.id).toBe(
      "ca6dfb20-8a88-88d7-00f3-72201c6f19ed",
    );

    await expect(
      runtime.collaboration.service.submitMessage({
        roomId: runtime.collaboration.bootstrap.room.id,
        senderPrincipalId: runtime.collaboration.bootstrap.principal.id,
        content: "迁移 GUID 发送验证",
        idempotencyKey: randomUUID(),
        mentionedPrincipalIds: [],
      }),
    ).resolves.toMatchObject({ duplicate: false });
  });
});
