/** @vitest-environment node */

import { createHash, randomBytes, randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createPostgresPool } from "@/server/postgres/client";
import { AgentAdmissionRepository } from "@/server/postgres/agent-admission-repository";
import { AgentGatewayRepository } from "@/server/postgres/agent-gateway-repository";
import { PrincipalRepository } from "@/server/postgres/principal-repository";
import { closeServerRuntime, getServerRuntime } from "@/server/runtime";

const pool = createPostgresPool(process.env.TEST_DATABASE_URL
  ?? "postgresql://yoyoo:yoyoo_dev@127.0.0.1:55432/yoyoo_space");
const repository = new AgentAdmissionRepository(pool);
const hash = (value: string) => createHash("sha256").update(value).digest();

describe("Agent admission repository", () => {
  beforeAll(async () => {
    await closeServerRuntime();
    process.env.DATABASE_URL = process.env.TEST_DATABASE_URL
      ?? "postgresql://yoyoo:yoyoo_dev@127.0.0.1:55432/yoyoo_space";
  });

  afterAll(async () => {
    await pool.end();
    await closeServerRuntime();
  });

  it("admits one verified Card into only the selected rooms and recovers idempotently", async () => {
    const runtime = await getServerRuntime();
    const ownerId = runtime.collaboration.bootstrap.principal.id;
    const workspaceId = runtime.collaboration.bootstrap.workspace.id;
    const room = await runtime.collaboration.service.createRoom({
      workspaceId,
      createdByPrincipalId: ownerId,
      name: `Agent admission ${randomUUID().slice(0, 8)}`,
      idempotencyKey: randomUUID(),
    });
    const ticket = randomBytes(32).toString("base64url");
    const invitationId = randomUUID();
    await repository.createInvitation({
      invitationId,
      workspaceId,
      createdByPrincipalId: ownerId,
      displayName: "悠悠执行官",
      machineName: "yoyoo-executive",
      aicardInvitationId: randomUUID(),
      ticketHash: hash(ticket),
      roomIds: [room.room.id],
      permissions: ["message.read", "message.write"],
      expiresAt: new Date(Date.now() + 15 * 60_000),
    });

    const claim = {
      invitationId,
      ticketHash: hash(ticket),
      claimId: randomUUID(),
      issuer: "https://id.yoyooai.test/",
      clientId: "yoyoo_test",
      subject: `sub_${randomBytes(32).toString("base64url")}`,
      nodeId: randomUUID(),
      cardId: `AI_${Date.now()}`,
      machineName: "yoyoo-executive",
      displayName: "悠悠执行官",
      handle: `ai_${Date.now()}`,
    };
    const first = await repository.claim(claim);
    const replay = await repository.claim(claim);

    expect(replay).toEqual(first);
    expect(first).toMatchObject({
      cardId: claim.cardId,
      roomIds: [room.room.id],
      permissions: ["message.read", "message.write"],
      status: "admitted",
    });
    const state = await pool.query<{ workspace_members: string; room_members: string; bindings: string }>(
      `select
        (select count(*) from workspace_members where workspace_id = $1 and principal_id = $2 and status = 'active')::text as workspace_members,
        (select count(*) from room_members where room_id = $3 and principal_id = $2 and status = 'active')::text as room_members,
        (select count(*) from agent_bindings where principal_id = $2 and status = 'enabled')::text as bindings`,
      [workspaceId, first.principalId, room.room.id],
    );
    expect(state.rows[0]).toEqual({ workspace_members: "1", room_members: "1", bindings: "1" });
    const gatewaySession = await new AgentGatewayRepository(pool).authenticateAICardRuntime({
      issuer: claim.issuer,
      clientId: claim.clientId,
      subject: claim.subject,
      nodeId: claim.nodeId,
      expiresAt: new Date(Date.now() + 60_000),
    });
    expect(gatewaySession).toMatchObject({
      principalId: first.principalId,
      permissions: ["message.read", "message.write"],
    });
  });

  it.each([
    ["wrong ticket", false],
    ["expired ticket", true],
  ])("does not write partial membership for a %s", async (_label, expired) => {
    const runtime = await getServerRuntime();
    const ownerId = runtime.collaboration.bootstrap.principal.id;
    const workspaceId = runtime.collaboration.bootstrap.workspace.id;
    const room = await runtime.collaboration.service.createRoom({
      workspaceId,
      createdByPrincipalId: ownerId,
      name: `Rejected admission ${randomUUID().slice(0, 8)}`,
      idempotencyKey: randomUUID(),
    });
    const ticket = randomBytes(32).toString("base64url");
    const invitationId = randomUUID();
    await repository.createInvitation({
      invitationId,
      workspaceId,
      createdByPrincipalId: ownerId,
      displayName: "不应接入的 Agent",
      machineName: "rejected-agent",
      aicardInvitationId: randomUUID(),
      ticketHash: hash(ticket),
      roomIds: [room.room.id],
      permissions: ["message.read", "message.write"],
      expiresAt: new Date(Date.now() + 60_000),
    });
    const subject = `sub_${randomBytes(32).toString("base64url")}`;
    await expect(repository.claim({
      invitationId,
      ticketHash: hash(expired ? ticket : `${ticket}wrong`),
      claimId: randomUUID(),
      issuer: "https://id.yoyooai.test/",
      clientId: "yoyoo_test",
      subject,
      nodeId: randomUUID(),
      machineName: "rejected-agent",
      cardId: `AI_${Date.now()}${expired ? "1" : "2"}`,
      displayName: "不应接入的 Agent",
      handle: `rejected_${Date.now()}`,
      now: expired ? new Date(Date.now() + 120_000) : new Date(),
    })).rejects.toThrow(expired ? "已经过期" : "邀请无效");

    const partial = await pool.query<{ mappings: string; memberships: string }>(
      `SELECT
        (SELECT count(*) FROM aicard_identity_mappings WHERE subject = $1)::text AS mappings,
        (SELECT count(*) FROM room_members WHERE room_id = $2 AND principal_id IN (
          SELECT principal_id FROM aicard_identity_mappings WHERE subject = $1
        ))::text AS memberships`,
      [subject, room.room.id],
    );
    expect(partial.rows[0]).toEqual({ mappings: "0", memberships: "0" });
  });

  it("revokes admitted runtime access while preserving the AI Card mapping and message history", async () => {
    const runtime = await getServerRuntime();
    const ownerId = runtime.collaboration.bootstrap.principal.id;
    const workspaceId = runtime.collaboration.bootstrap.workspace.id;
    const room = await runtime.collaboration.service.createRoom({
      workspaceId,
      createdByPrincipalId: ownerId,
      name: `Revoked admission ${randomUUID().slice(0, 8)}`,
      idempotencyKey: randomUUID(),
    });
    const invitationId = randomUUID();
    const ticket = randomBytes(32).toString("base64url");
    const subject = `sub_${randomBytes(32).toString("base64url")}`;
    await repository.createInvitation({
      invitationId,
      workspaceId,
      createdByPrincipalId: ownerId,
      displayName: "可撤销 Agent",
      machineName: "revocable-agent",
      aicardInvitationId: randomUUID(),
      ticketHash: hash(ticket),
      roomIds: [room.room.id],
      permissions: ["message.read", "message.write"],
      expiresAt: new Date(Date.now() + 60_000),
    });
    const admitted = await repository.claim({
      invitationId,
      ticketHash: hash(ticket),
      claimId: randomUUID(),
      issuer: "https://id.yoyooai.test/",
      clientId: "yoyoo_test",
      subject,
      nodeId: randomUUID(),
      machineName: "revocable-agent",
      cardId: `AI_${Date.now()}`,
      displayName: "可撤销 Agent",
      handle: `revocable_${Date.now()}`,
    });

    const prepared = await repository.prepareRevocation({
      invitationId,
      workspaceId,
      createdByPrincipalId: ownerId,
    });
    expect(prepared?.status).toBe("admitted");
    await expect(repository.finalizeRevocation({
      invitationId,
      workspaceId,
      createdByPrincipalId: ownerId,
    })).resolves.toBe(true);

    await expect(new AgentGatewayRepository(pool).authenticateAICardRuntime({
      issuer: "https://id.yoyooai.test/",
      clientId: "yoyoo_test",
      subject,
      nodeId: admitted.nodeId,
      expiresAt: new Date(Date.now() + 60_000),
    })).resolves.toBeNull();
    const preserved = await pool.query<{ mappings: string; principals: string }>(
      `SELECT
        (SELECT count(*) FROM aicard_identity_mappings WHERE subject = $1)::text AS mappings,
        (SELECT count(*) FROM principals WHERE id = $2)::text AS principals`,
      [subject, admitted.principalId],
    );
    expect(preserved.rows[0]).toEqual({ mappings: "1", principals: "1" });
    await expect(new PrincipalRepository(pool).listAICardAgents(workspaceId))
      .resolves.toEqual(expect.arrayContaining([
        expect.objectContaining({
          principalId: admitted.principalId,
          connectionStatus: "revoked",
          cardId: admitted.cardId,
          machineName: "revocable-agent",
        }),
      ]));
  });
});
