/** @vitest-environment node */

import { randomUUID } from "node:crypto";

import { afterAll, describe, expect, it, vi } from "vitest";

import { createPostgresPool } from "@/server/postgres/client";
import { AttachmentRepository } from "@/server/postgres/attachment-repository";
import { CollaborationRunRepository } from "@/server/postgres/collaboration-run-repository";
import { MemberStateRepository } from "@/server/postgres/member-state-repository";

const databaseUrl =
  process.env.TEST_DATABASE_URL ??
  "postgresql://yoyoo:yoyoo_dev@127.0.0.1:55432/yoyoo_space";
const pool = createPostgresPool(databaseUrl, { max: 4 });

interface RepositoryModules {
  PrincipalRepository: new (database: typeof pool) => {
    create(input: Record<string, unknown>): Promise<Record<string, unknown>>;
    bindAgent(input: Record<string, unknown>): Promise<Record<string, unknown>>;
    getAgentBinding(principalId: string): Promise<Record<string, unknown>>;
  };
  WorkspaceRepository: new (database: typeof pool) => {
    create(input: Record<string, unknown>): Promise<Record<string, unknown>>;
    addMember(input: Record<string, unknown>): Promise<Record<string, unknown>>;
    listMembers(workspaceId: string): Promise<Record<string, unknown>[]>;
  };
  RoomRepository: new (database: typeof pool) => {
    create(input: Record<string, unknown>): Promise<Record<string, unknown>>;
    createWithWorkspaceAgents(input: Record<string, unknown>): Promise<{
      duplicate: boolean;
      room: Record<string, unknown>;
    }>;
    createDirect(input: Record<string, unknown>): Promise<{
      duplicate: boolean;
      room: Record<string, unknown>;
    }>;
    listAccessible(
      workspaceId: string,
      principalId: string,
    ): Promise<Record<string, unknown>[]>;
    listAccessibleSummaries(
      workspaceId: string,
      principalId: string,
    ): Promise<{
      active: Record<string, unknown>[];
      archived: Record<string, unknown>[];
    }>;
    rename(input: Record<string, unknown>): Promise<Record<string, unknown>>;
    setStatus(input: Record<string, unknown>): Promise<Record<string, unknown>>;
    addMember(input: Record<string, unknown>): Promise<Record<string, unknown>>;
    addMemberByOwner(input: Record<string, unknown>): Promise<Record<string, unknown>>;
    removeMember(input: Record<string, unknown>): Promise<Record<string, unknown>>;
    listEligibleMembers(input: Record<string, unknown>): Promise<Record<string, unknown>[]>;
    listMembers(roomId: string): Promise<Record<string, unknown>[]>;
    createMessage(input: Record<string, unknown>): Promise<{
      duplicate: boolean;
      message: Record<string, unknown>;
    }>;
    listMessages(roomId: string): Promise<Record<string, unknown>[]>;
  };
  DelegationRepository: new (database: typeof pool) => {
    create(input: Record<string, unknown>): Promise<{
      duplicate: boolean;
      delegation: Record<string, unknown>;
    }>;
    listForRoom(roomId: string): Promise<Record<string, unknown>[]>;
  };
  ArtifactRepository: new (database: typeof pool) => {
    create(input: Record<string, unknown>): Promise<{
      duplicate: boolean;
      artifact: Record<string, unknown>;
    }>;
    listForRoom(roomId: string): Promise<Record<string, unknown>[]>;
  };
}

async function loadRepositoryModules(): Promise<RepositoryModules> {
  const moduleIds = [
    "@/server/postgres/principal-repository",
    "@/server/postgres/workspace-repository",
    "@/server/postgres/room-repository",
    "@/server/postgres/delegation-repository",
    "@/server/postgres/artifact-repository",
  ];
  const loaded = await Promise.all(
    moduleIds.map((moduleId) =>
      vi.importActual<Record<string, unknown>>(moduleId).catch(() => null),
    ),
  );
  expect(loaded.every(Boolean), "all collaboration repositories must exist").toBe(true);
  const [principal, workspace, room, delegation, artifact] = loaded;
  if (!principal || !workspace || !room || !delegation || !artifact) {
    throw new Error("Collaboration repository modules are unavailable");
  }
  return {
    PrincipalRepository: principal.PrincipalRepository,
    WorkspaceRepository: workspace.WorkspaceRepository,
    RoomRepository: room.RoomRepository,
    DelegationRepository: delegation.DelegationRepository,
    ArtifactRepository: artifact.ArtifactRepository,
  } as RepositoryModules;
}

async function createCollaborationFixture() {
  const modules = await loadRepositoryModules();
  const principals = new modules.PrincipalRepository(pool);
  const workspaces = new modules.WorkspaceRepository(pool);
  const rooms = new modules.RoomRepository(pool);
  const suffix = randomUUID();
  const human = await principals.create({
    kind: "human",
    externalKey: `human:${suffix}`,
    handle: `human-${suffix.slice(0, 8)}`,
    displayName: "Su Bai",
  });
  const agentOne = await principals.create({
    kind: "agent",
    externalKey: `agent:planner-${suffix}`,
    handle: `planner-${suffix.slice(0, 8)}`,
    displayName: "Planner",
  });
  const agentTwo = await principals.create({
    kind: "agent",
    externalKey: `agent:builder-${suffix}`,
    handle: `builder-${suffix.slice(0, 8)}`,
    displayName: "Builder",
  });
  const outsider = await principals.create({
    kind: "agent",
    externalKey: `agent:outsider-${suffix}`,
    handle: `outsider-${suffix.slice(0, 8)}`,
    displayName: "Outsider",
  });
  await principals.bindAgent({
    principalId: agentOne.id,
    adapterId: `planner-${suffix}`,
    capabilities: { streaming: true, cancellation: true },
  });
  await principals.bindAgent({
    principalId: agentTwo.id,
    adapterId: `builder-${suffix}`,
    capabilities: { streaming: true, cancellation: true, artifacts: true },
  });
  const workspace = await workspaces.create({
    slug: `space-${suffix}`,
    name: "V0.2 Test Space",
    ownerPrincipalId: human.id,
  });
  await workspaces.addMember({
    workspaceId: workspace.id,
    principalId: agentOne.id,
    role: "member",
  });
  await workspaces.addMember({
    workspaceId: workspace.id,
    principalId: agentTwo.id,
    role: "member",
  });
  const room = await rooms.create({
    workspaceId: workspace.id,
    name: "Launch Room",
    createdByPrincipalId: human.id,
  });
  await rooms.addMember({
    roomId: room.id,
    principalId: agentOne.id,
    role: "member",
    listenerPolicy: "mention_only",
  });
  await rooms.addMember({
    roomId: room.id,
    principalId: agentTwo.id,
    role: "member",
    listenerPolicy: "mention_only",
  });
  return {
    ...modules,
    principals,
    workspaces,
    rooms,
    human,
    agentOne,
    agentTwo,
    outsider,
    workspace,
    room,
  };
}

afterAll(async () => {
  await pool.end();
});

describe("collaboration repositories", () => {
  it("creates one idempotent room with the current workspace Agents", async () => {
    const fixture = await createCollaborationFixture();
    const idempotencyKey = randomUUID();
    const input = {
      workspaceId: fixture.workspace.id,
      name: "产品发布室",
      createdByPrincipalId: fixture.human.id,
      idempotencyKey,
    };

    const first = await fixture.rooms.createWithWorkspaceAgents(input);
    const duplicate = await fixture.rooms.createWithWorkspaceAgents(input);
    const members = await fixture.rooms.listMembers(first.room.id as string);

    expect(first.duplicate).toBe(false);
    expect(duplicate).toMatchObject({
      duplicate: true,
      room: { id: first.room.id, name: "产品发布室" },
    });
    expect(members).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          principalId: fixture.human.id,
          role: "owner",
          listenerPolicy: "always",
        }),
        expect.objectContaining({
          principalId: fixture.agentOne.id,
          role: "member",
          listenerPolicy: "mention_only",
        }),
        expect.objectContaining({
          principalId: fixture.agentTwo.id,
          role: "member",
          listenerPolicy: "mention_only",
        }),
      ]),
    );
    expect(members).toHaveLength(3);
  });

  it("lists only active rooms joined by the current principal", async () => {
    const fixture = await createCollaborationFixture();
    const joined = await fixture.rooms.createWithWorkspaceAgents({
      workspaceId: fixture.workspace.id,
      name: "已加入房间",
      createdByPrincipalId: fixture.human.id,
      idempotencyKey: randomUUID(),
    });
    const inaccessible = await fixture.rooms.create({
      workspaceId: fixture.workspace.id,
      name: "未加入房间",
      createdByPrincipalId: fixture.agentOne.id,
    });
    await pool.query("UPDATE room_members SET status = 'removed' WHERE room_id = $1", [
      inaccessible.id,
    ]);

    const visible = await fixture.rooms.listAccessible(
      fixture.workspace.id as string,
      fixture.human.id as string,
    );

    expect(visible.map((room) => room.id)).toContain(fixture.room.id);
    expect(visible.map((room) => room.id)).toContain(joined.room.id);
    expect(visible.map((room) => room.id)).not.toContain(inaccessible.id);
  });

  it("orders accessible room summaries by the latest completed message", async () => {
    const fixture = await createCollaborationFixture();
    const recent = await fixture.rooms.createWithWorkspaceAgents({
      workspaceId: fixture.workspace.id,
      name: "最近活动室",
      createdByPrincipalId: fixture.human.id,
      idempotencyKey: randomUUID(),
    });
    const olderMessage = await fixture.rooms.createMessage({
      roomId: fixture.room.id,
      senderPrincipalId: fixture.human.id,
      kind: "message",
      content: "较早的公开消息",
      status: "completed",
      idempotencyKey: randomUUID(),
    });
    const recentMessage = await fixture.rooms.createMessage({
      roomId: recent.room.id,
      senderPrincipalId: fixture.human.id,
      kind: "message",
      content: "这是最近活动房间的一条很长消息，需要在房间栏中安全截断而不是改变原始内容。",
      status: "completed",
      idempotencyKey: randomUUID(),
    });
    const failedMessage = await fixture.rooms.createMessage({
      roomId: recent.room.id,
      senderPrincipalId: fixture.human.id,
      kind: "message",
      content: "失败消息不能成为公开预览",
      status: "failed",
      idempotencyKey: randomUUID(),
    });
    await pool.query(
      `UPDATE room_messages SET created_at = CASE id
         WHEN $1 THEN '2026-08-07T01:00:00Z'::timestamptz
         WHEN $2 THEN '2026-08-07T02:00:00Z'::timestamptz
         WHEN $3 THEN '2026-08-07T03:00:00Z'::timestamptz
       END WHERE id = ANY($4::uuid[])`,
      [
        olderMessage.message.id,
        recentMessage.message.id,
        failedMessage.message.id,
        [olderMessage.message.id, recentMessage.message.id, failedMessage.message.id],
      ],
    );
    await pool.query(
      `UPDATE rooms SET created_at = '2026-08-06T23:59:00Z'::timestamptz,
                        updated_at = '2026-08-07T00:00:00Z'::timestamptz
       WHERE id = ANY($1::uuid[])`,
      [[fixture.room.id, recent.room.id]],
    );

    const summaries = await fixture.rooms.listAccessibleSummaries(
      fixture.workspace.id as string,
      fixture.human.id as string,
    );

    expect(summaries.archived).toEqual([]);
    expect(summaries.active[0]).toMatchObject({
      id: recent.room.id,
      lastMessagePreview: recentMessage.message.content,
      lastMessageAt: new Date("2026-08-07T02:00:00.000Z"),
      lastActivityAt: new Date("2026-08-07T02:00:00.000Z"),
    });
    expect(summaries.active[1]).toMatchObject({
      id: fixture.room.id,
      lastMessagePreview: "较早的公开消息",
    });
  });

  it("keeps pin and hidden room-list state personal and restores hidden rooms on activity", async () => {
    const fixture = await createCollaborationFixture();
    const states = new MemberStateRepository(pool);
    const second = await fixture.rooms.createWithWorkspaceAgents({
      workspaceId: fixture.workspace.id,
      name: "同名协作室",
      createdByPrincipalId: fixture.human.id,
      idempotencyKey: randomUUID(),
    });
    const third = await fixture.rooms.createWithWorkspaceAgents({
      workspaceId: fixture.workspace.id,
      name: "同名协作室",
      createdByPrincipalId: fixture.human.id,
      idempotencyKey: randomUUID(),
    });

    await states.updateListState({
      roomId: second.room.id as string,
      principalId: fixture.human.id as string,
      action: "pin",
    });

    const humanPinned = await fixture.rooms.listAccessibleSummaries(
      fixture.workspace.id as string,
      fixture.human.id as string,
    );
    const agentUnpinned = await fixture.rooms.listAccessibleSummaries(
      fixture.workspace.id as string,
      fixture.agentOne.id as string,
    );
    expect(humanPinned.active[0]).toMatchObject({
      id: second.room.id,
      name: "同名协作室",
      pinnedAt: expect.any(Date),
    });
    expect(agentUnpinned.active.find((room) => room.id === second.room.id)).toMatchObject({
      pinnedAt: null,
    });
    expect(second.room.id).not.toBe(third.room.id);

    await states.updateListState({
      roomId: second.room.id as string,
      principalId: fixture.human.id as string,
      action: "hide",
    });
    const humanHidden = await fixture.rooms.listAccessibleSummaries(
      fixture.workspace.id as string,
      fixture.human.id as string,
    );
    const agentStillVisible = await fixture.rooms.listAccessibleSummaries(
      fixture.workspace.id as string,
      fixture.agentOne.id as string,
    );
    expect(humanHidden.active.map((room) => room.id)).not.toContain(second.room.id);
    expect(agentStillVisible.active.map((room) => room.id)).toContain(second.room.id);

    await fixture.rooms.createMessage({
      roomId: second.room.id,
      senderPrincipalId: fixture.agentOne.id,
      kind: "message",
      content: "新消息让会话重新出现",
      status: "completed",
      idempotencyKey: randomUUID(),
    });
    const humanRestored = await fixture.rooms.listAccessibleSummaries(
      fixture.workspace.id as string,
      fixture.human.id as string,
    );
    expect(humanRestored.active.find((room) => room.id === second.room.id)).toMatchObject({
      pinnedAt: null,
      lastMessagePreview: "新消息让会话重新出现",
    });
  });

  it("reopens a hidden direct room by its existing room ID", async () => {
    const fixture = await createCollaborationFixture();
    const states = new MemberStateRepository(pool);
    const first = await fixture.rooms.createDirect({
      workspaceId: fixture.workspace.id,
      humanPrincipalId: fixture.human.id,
      agentPrincipalId: fixture.agentOne.id,
    });
    await states.updateListState({
      roomId: first.room.id as string,
      principalId: fixture.human.id as string,
      action: "hide",
    });
    const hidden = await fixture.rooms.listAccessibleSummaries(
      fixture.workspace.id as string,
      fixture.human.id as string,
    );
    expect(hidden.active.map((room) => room.id)).not.toContain(first.room.id);

    const reopened = await fixture.rooms.createDirect({
      workspaceId: fixture.workspace.id,
      humanPrincipalId: fixture.human.id,
      agentPrincipalId: fixture.agentOne.id,
    });
    const visible = await fixture.rooms.listAccessibleSummaries(
      fixture.workspace.id as string,
      fixture.human.id as string,
    );

    expect(reopened).toMatchObject({ duplicate: true, room: { id: first.room.id } });
    expect(visible.active.map((room) => room.id)).toContain(first.room.id);
  });

  it("renames, archives, and restores a room without losing its history", async () => {
    const fixture = await createCollaborationFixture();
    const second = await fixture.rooms.createWithWorkspaceAgents({
      workspaceId: fixture.workspace.id,
      name: "可归档房间",
      createdByPrincipalId: fixture.human.id,
      idempotencyKey: randomUUID(),
    });
    await fixture.rooms.createMessage({
      roomId: second.room.id,
      senderPrincipalId: fixture.human.id,
      kind: "message",
      content: "归档后仍需保留的消息",
      status: "completed",
      idempotencyKey: randomUUID(),
    });

    await expect(
      fixture.rooms.rename({
        roomId: second.room.id,
        principalId: fixture.agentOne.id,
        name: "越权改名",
      }),
    ).rejects.toThrow("Only a room owner can manage this room");

    expect(
      await fixture.rooms.rename({
        roomId: second.room.id,
        principalId: fixture.human.id,
        name: "发布归档室",
      }),
    ).toMatchObject({ name: "发布归档室", status: "active" });
    expect(
      await fixture.rooms.setStatus({
        roomId: second.room.id,
        principalId: fixture.human.id,
        status: "archived",
      }),
    ).toMatchObject({ id: second.room.id, status: "archived" });
    expect(await fixture.rooms.listMessages(second.room.id as string)).toEqual([
      expect.objectContaining({ content: "归档后仍需保留的消息" }),
    ]);

    await expect(
      fixture.rooms.setStatus({
        roomId: fixture.room.id,
        principalId: fixture.human.id,
        status: "archived",
      }),
    ).rejects.toThrow("The final active room cannot be archived");

    expect(
      await fixture.rooms.setStatus({
        roomId: second.room.id,
        principalId: fixture.human.id,
        status: "active",
      }),
    ).toMatchObject({ id: second.room.id, status: "active" });
    const summaries = await fixture.rooms.listAccessibleSummaries(
      fixture.workspace.id as string,
      fixture.human.id as string,
    );
    expect(summaries.active.map((room) => room.id)).toContain(second.room.id);
    expect(summaries.archived).toEqual([]);
  });

  it("rejects archiving a room while an Agent run is active", async () => {
    const fixture = await createCollaborationFixture();
    const second = await fixture.rooms.createWithWorkspaceAgents({
      workspaceId: fixture.workspace.id,
      name: "执行中房间",
      createdByPrincipalId: fixture.human.id,
      idempotencyKey: randomUUID(),
    });
    const trigger = await fixture.rooms.createMessage({
      roomId: second.room.id,
      senderPrincipalId: fixture.human.id,
      kind: "message",
      content: "正在执行的任务",
      status: "completed",
      idempotencyKey: randomUUID(),
      mentionedPrincipalIds: [fixture.agentOne.id],
    });
    const runId = randomUUID();
    await pool.query(
      `INSERT INTO room_runs
        (id, room_id, trigger_message_id, target_agent_principal_id,
         adapter_id, trigger_type, status, idempotency_key, started_at)
       VALUES ($1, $2, $3, $4, 'planner-adapter', 'message', 'running', $5, NOW())`,
      [runId, second.room.id, trigger.message.id, fixture.agentOne.id, randomUUID()],
    );

    await expect(
      fixture.rooms.setStatus({
        roomId: second.room.id,
        principalId: fixture.human.id,
        status: "archived",
      }),
    ).rejects.toThrow("A room with active Agent runs cannot be archived");

    await pool.query(
      "UPDATE room_runs SET status = 'completed', finished_at = NOW() WHERE id = $1",
      [runId],
    );
    await expect(
      fixture.rooms.setStatus({
        roomId: second.room.id,
        principalId: fixture.human.id,
        status: "archived",
      }),
    ).resolves.toMatchObject({ status: "archived" });
  });

  it("builds same-room history strictly before the trigger message", async () => {
    const fixture = await createCollaborationFixture();
    const attachments = new AttachmentRepository(pool);
    const otherRoom = await fixture.rooms.create({
      workspaceId: fixture.workspace.id,
      name: "Other Room",
      createdByPrincipalId: fixture.human.id,
    });
    const priorHuman = await fixture.rooms.createMessage({
      roomId: fixture.room.id,
      senderPrincipalId: fixture.human.id,
      kind: "message",
      content: "先确认发布目标。",
      status: "completed",
      idempotencyKey: randomUUID(),
      mentionedPrincipalIds: [],
    });
    const priorAgent = await fixture.rooms.createMessage({
      roomId: fixture.room.id,
      senderPrincipalId: fixture.agentTwo.id,
      kind: "message",
      content: "Builder 已经给出上一轮方案。",
      status: "completed",
      idempotencyKey: randomUUID(),
      mentionedPrincipalIds: [],
    });
    const otherRoomMessage = await fixture.rooms.createMessage({
      roomId: otherRoom.id,
      senderPrincipalId: fixture.human.id,
      kind: "message",
      content: "不能泄漏到当前房间",
      status: "completed",
      idempotencyKey: randomUUID(),
      mentionedPrincipalIds: [],
    });
    const pending = await attachments.createPending({
      workspaceId: fixture.workspace.id as string,
      uploaderPrincipalId: fixture.human.id as string,
      objectKey: `context/${randomUUID().replaceAll("-", "")}`,
      originalName: "发布计划.pdf",
      declaredMediaType: "application/pdf",
      expiresAt: new Date(Date.now() + 60_000),
    });
    await attachments.markReady({
      attachmentId: pending.attachment.id,
      principalId: fixture.human.id as string,
      detectedMediaType: "application/pdf",
      sizeBytes: 2_048,
      sha256: "a".repeat(64),
    });
    const trigger = await fixture.rooms.createMessage({
      roomId: fixture.room.id,
      senderPrincipalId: fixture.human.id,
      kind: "message",
      content: "请继续上一轮方案",
      status: "completed",
      idempotencyKey: randomUUID(),
      mentionedPrincipalIds: [fixture.agentOne.id],
      attachmentIds: [pending.attachment.id],
    });
    const afterTrigger = await fixture.rooms.createMessage({
      roomId: fixture.room.id,
      senderPrincipalId: fixture.agentTwo.id,
      kind: "message",
      content: "同一触发后的并行回复不能提前出现",
      status: "completed",
      idempotencyKey: randomUUID(),
      mentionedPrincipalIds: [],
    });
    await pool.query(
      `UPDATE room_messages SET created_at = CASE id
         WHEN $1 THEN '2026-08-07T01:00:00Z'::timestamptz
         WHEN $2 THEN '2026-08-07T01:01:00Z'::timestamptz
         WHEN $3 THEN '2026-08-07T01:02:00Z'::timestamptz
         WHEN $4 THEN '2026-08-07T01:03:00Z'::timestamptz
         WHEN $5 THEN '2026-08-07T01:04:00Z'::timestamptz
       END WHERE id = ANY($6::uuid[])`,
      [
        priorHuman.message.id,
        priorAgent.message.id,
        otherRoomMessage.message.id,
        trigger.message.id,
        afterTrigger.message.id,
        [
          priorHuman.message.id,
          priorAgent.message.id,
          otherRoomMessage.message.id,
          trigger.message.id,
          afterTrigger.message.id,
        ],
      ],
    );
    const runs = new CollaborationRunRepository(pool);
    const [run] = await runs.createForMessage({
      roomId: fixture.room.id as string,
      triggerMessageId: trigger.message.id as string,
      targets: [
        {
          principalId: fixture.agentOne.id as string,
          adapterId: `planner-${String(fixture.agentOne.id).slice(0, 8)}`,
        },
      ],
    });

    const context = await runs.getExecutionContext(run.id);

    expect("history" in context.request ? context.request.history : null).toEqual([
      expect.objectContaining({
        senderKind: "human",
        senderDisplayName: "Su Bai",
        content: "先确认发布目标。",
      }),
      expect.objectContaining({
        senderKind: "agent",
        senderDisplayName: "Builder",
        content: "Builder 已经给出上一轮方案。",
      }),
    ]);
    expect(JSON.stringify(context.request)).not.toContain("不能泄漏到当前房间");
    expect(JSON.stringify(context.request)).not.toContain("并行回复不能提前出现");
    expect("attachments" in context.request ? context.request.attachments : null).toEqual([
      expect.objectContaining({
        attachmentId: pending.attachment.id,
        originalName: "发布计划.pdf",
        mediaType: "application/pdf",
        resource: {
          method: "GET",
          path: `/api/v1/agent-gateway/resources/${pending.attachment.id}?runId=${run.id}`,
        },
      }),
    ]);
  });

  it("persists first-class human and Agent membership with declared bindings", async () => {
    const fixture = await createCollaborationFixture();

    expect(await fixture.workspaces.listMembers(fixture.workspace.id as string)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          principalId: fixture.human.id,
          principalKind: "human",
          role: "owner",
        }),
        expect.objectContaining({
          principalId: fixture.agentOne.id,
          principalKind: "agent",
          role: "member",
        }),
      ]),
    );
    expect(await fixture.rooms.listMembers(fixture.room.id as string)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          principalId: fixture.human.id,
          listenerPolicy: "always",
        }),
        expect.objectContaining({
          principalId: fixture.agentOne.id,
          listenerPolicy: "mention_only",
        }),
      ]),
    );
    expect(
      await fixture.principals.getAgentBinding(fixture.agentTwo.id as string),
    ).toMatchObject({
      principalId: fixture.agentTwo.id,
      capabilities: { streaming: true, cancellation: true, artifacts: true },
      status: "enabled",
    });
  });

  it("lets only the room owner add an eligible workspace principal", async () => {
    const fixture = await createCollaborationFixture();
    const suffix = randomUUID();
    const candidate = await fixture.principals.create({
      kind: "agent",
      externalKey: `agent:candidate-${suffix}`,
      handle: `candidate-${suffix.slice(0, 8)}`,
      displayName: "Candidate",
    });
    await fixture.principals.bindAgent({
      principalId: candidate.id,
      adapterId: `candidate-${suffix}`,
      capabilities: { streaming: true },
    });
    await fixture.workspaces.addMember({
      workspaceId: fixture.workspace.id,
      principalId: candidate.id,
      role: "member",
    });

    expect(
      await fixture.rooms.listEligibleMembers({
        roomId: fixture.room.id,
        principalId: fixture.human.id,
      }),
    ).toEqual([
      expect.objectContaining({
        principalId: candidate.id,
        principalKind: "agent",
        displayName: "Candidate",
      }),
    ]);
    await expect(
      fixture.rooms.addMemberByOwner({
        roomId: fixture.room.id,
        actorPrincipalId: fixture.agentOne.id,
        memberPrincipalId: candidate.id,
      }),
    ).rejects.toThrow("Only a room owner can manage this room");

    expect(
      await fixture.rooms.addMemberByOwner({
        roomId: fixture.room.id,
        actorPrincipalId: fixture.human.id,
        memberPrincipalId: candidate.id,
      }),
    ).toMatchObject({
      principalId: candidate.id,
      listenerPolicy: "mention_only",
      status: "active",
    });
    expect(
      await fixture.rooms.listEligibleMembers({
        roomId: fixture.room.id,
        principalId: fixture.human.id,
      }),
    ).toEqual([]);
  });

  it("removes and re-adds a member without deleting its history or identity", async () => {
    const fixture = await createCollaborationFixture();
    const historicalMessage = await fixture.rooms.createMessage({
      roomId: fixture.room.id,
      senderPrincipalId: fixture.agentTwo.id,
      kind: "message",
      content: "这条历史消息必须保留作者身份。",
      status: "completed",
      idempotencyKey: randomUUID(),
    });

    await expect(
      fixture.rooms.removeMember({
        roomId: fixture.room.id,
        actorPrincipalId: fixture.human.id,
        memberPrincipalId: fixture.human.id,
      }),
    ).rejects.toThrow("The room owner cannot be removed");
    expect(
      await fixture.rooms.removeMember({
        roomId: fixture.room.id,
        actorPrincipalId: fixture.human.id,
        memberPrincipalId: fixture.agentTwo.id,
      }),
    ).toMatchObject({ principalId: fixture.agentTwo.id, status: "removed" });
    expect(
      await fixture.rooms.removeMember({
        roomId: fixture.room.id,
        actorPrincipalId: fixture.human.id,
        memberPrincipalId: fixture.agentTwo.id,
      }),
    ).toMatchObject({ principalId: fixture.agentTwo.id, status: "removed" });
    expect(await fixture.rooms.listMessages(fixture.room.id as string)).toContainEqual(
      expect.objectContaining({
        id: historicalMessage.message.id,
        senderPrincipalId: fixture.agentTwo.id,
      }),
    );

    const beforeReAdd = (await fixture.rooms.listMembers(
      fixture.room.id as string,
    )).find((member) => member.principalId === fixture.agentTwo.id);
    const reAdded = await fixture.rooms.addMemberByOwner({
      roomId: fixture.room.id,
      actorPrincipalId: fixture.human.id,
      memberPrincipalId: fixture.agentTwo.id,
    });
    expect(reAdded).toMatchObject({
      principalId: fixture.agentTwo.id,
      status: "active",
      joinedAt: beforeReAdd?.joinedAt,
    });
  });

  it("rejects removing an Agent while its run is active", async () => {
    const fixture = await createCollaborationFixture();
    const trigger = await fixture.rooms.createMessage({
      roomId: fixture.room.id,
      senderPrincipalId: fixture.human.id,
      kind: "message",
      content: "仍在执行的任务",
      status: "completed",
      idempotencyKey: randomUUID(),
      mentionedPrincipalIds: [fixture.agentOne.id],
    });
    const runId = randomUUID();
    await pool.query(
      `INSERT INTO room_runs
        (id, room_id, trigger_message_id, target_agent_principal_id,
         adapter_id, trigger_type, status, idempotency_key, started_at)
       VALUES ($1, $2, $3, $4, 'planner-adapter', 'message', 'running', $5, NOW())`,
      [runId, fixture.room.id, trigger.message.id, fixture.agentOne.id, randomUUID()],
    );

    await expect(
      fixture.rooms.removeMember({
        roomId: fixture.room.id,
        actorPrincipalId: fixture.human.id,
        memberPrincipalId: fixture.agentOne.id,
      }),
    ).rejects.toThrow("An Agent with an active run cannot be removed");
    await pool.query(
      "UPDATE room_runs SET status = 'completed', finished_at = NOW() WHERE id = $1",
      [runId],
    );
  });

  it("deduplicates messages and restores mentions and reply context", async () => {
    const fixture = await createCollaborationFixture();
    const firstInput = {
      roomId: fixture.room.id,
      senderPrincipalId: fixture.human.id,
      kind: "message",
      content: "@Planner 请先给出方案",
      status: "completed",
      idempotencyKey: randomUUID(),
      mentionedPrincipalIds: [fixture.agentOne.id],
    };

    const first = await fixture.rooms.createMessage(firstInput);
    const duplicate = await fixture.rooms.createMessage(firstInput);
    const reply = await fixture.rooms.createMessage({
      roomId: fixture.room.id,
      senderPrincipalId: fixture.agentOne.id,
      kind: "message",
      content: "方案已经整理。",
      status: "completed",
      idempotencyKey: randomUUID(),
      mentionedPrincipalIds: [fixture.human.id],
      replyToMessageId: first.message.id,
      threadRootMessageId: first.message.id,
    });

    expect(first.duplicate).toBe(false);
    expect(duplicate).toMatchObject({ duplicate: true });
    expect(duplicate.message.id).toBe(first.message.id);
    expect(reply.duplicate).toBe(false);
    expect(await fixture.rooms.listMessages(fixture.room.id as string)).toEqual([
      expect.objectContaining({
        id: first.message.id,
        mentionedPrincipalIds: [fixture.agentOne.id],
      }),
      expect.objectContaining({
        id: reply.message.id,
        replyToMessageId: first.message.id,
        threadRootMessageId: first.message.id,
        mentionedPrincipalIds: [fixture.human.id],
      }),
    ]);

    await expect(
      fixture.rooms.createMessage({
        ...firstInput,
        idempotencyKey: randomUUID(),
        content: "不能路由给房间外的 Agent",
        mentionedPrincipalIds: [fixture.outsider.id],
      }),
    ).rejects.toThrow("not an active room member");
  });

  it("persists idempotent delegation and Artifact provenance across reload", async () => {
    const fixture = await createCollaborationFixture();
    const trigger = await fixture.rooms.createMessage({
      roomId: fixture.room.id,
      senderPrincipalId: fixture.human.id,
      kind: "message",
      content: "@Planner 和 @Builder 完成发布方案",
      status: "completed",
      idempotencyKey: randomUUID(),
      mentionedPrincipalIds: [fixture.agentOne.id, fixture.agentTwo.id],
    });
    const parentRunId = randomUUID();
    const childRunId = randomUUID();
    await pool.query(
      `INSERT INTO room_runs
        (id, room_id, trigger_message_id, target_agent_principal_id,
         adapter_id, trigger_type, status, idempotency_key, started_at, finished_at)
       VALUES ($1, $3, $4, $5, 'planner-adapter', 'message', 'running', $7, NOW(), NULL),
              ($2, $3, $4, $6, 'builder-adapter', 'delegation', 'running', $8,
               NOW(), NULL)`,
      [
        parentRunId,
        childRunId,
        fixture.room.id,
        trigger.message.id,
        fixture.agentOne.id,
        fixture.agentTwo.id,
        randomUUID(),
        randomUUID(),
      ],
    );

    const delegations = new fixture.DelegationRepository(pool);
    const artifacts = new fixture.ArtifactRepository(pool);
    const runs = new CollaborationRunRepository(pool);
    const delegationInput = {
      roomId: fixture.room.id,
      delegatorPrincipalId: fixture.agentOne.id,
      delegatePrincipalId: fixture.agentTwo.id,
      parentRunId,
      childRunId,
      objective: "把方案整理成最终 Markdown 文档",
      status: "running",
      idempotencyKey: randomUUID(),
    };
    const firstDelegation = await delegations.create(delegationInput);
    const duplicateDelegation = await delegations.create(delegationInput);
    await runs.appendEvent(childRunId, {
      sequence: 1,
      type: "completed",
      text: "最终方案已生成。",
    });
    const artifactInput = {
      roomId: fixture.room.id,
      producerPrincipalId: fixture.agentTwo.id,
      sourceRunId: childRunId,
      type: "markdown",
      title: "发布方案",
      content: "# 发布方案\n\n最终交付内容。",
      metadata: { version: 1 },
      idempotencyKey: randomUUID(),
    };
    const firstArtifact = await artifacts.create(artifactInput);
    const duplicateArtifact = await artifacts.create(artifactInput);

    expect(firstDelegation.duplicate).toBe(false);
    expect(duplicateDelegation).toMatchObject({
      duplicate: true,
      delegation: { id: firstDelegation.delegation.id },
    });
    expect(await delegations.listForRoom(fixture.room.id as string)).toEqual([
      expect.objectContaining({
        delegatorPrincipalId: fixture.agentOne.id,
        delegatePrincipalId: fixture.agentTwo.id,
        parentRunId,
        childRunId,
        status: "completed",
      }),
    ]);
    expect(firstArtifact.duplicate).toBe(false);
    expect(duplicateArtifact).toMatchObject({
      duplicate: true,
      artifact: { id: firstArtifact.artifact.id },
    });
    expect(await artifacts.listForRoom(fixture.room.id as string)).toEqual([
      expect.objectContaining({
        producerPrincipalId: fixture.agentTwo.id,
        sourceRunId: childRunId,
        title: "发布方案",
        content: "# 发布方案\n\n最终交付内容。",
        metadata: { version: 1 },
      }),
    ]);
  });
});
