/** @vitest-environment node */

import { createHash, randomUUID } from "node:crypto";

import { afterAll, describe, expect, it, vi } from "vitest";

import { AgentGatewayAdapter } from "@/agents/agent-gateway-adapter";
import { AgentRegistry } from "@/agents/registry";
import { CollaborationRunCoordinator } from "@/server/collaboration-run-coordinator";
import { ArtifactRepository } from "@/server/postgres/artifact-repository";
import { DelegationRepository } from "@/server/postgres/delegation-repository";
import { PrincipalRepository } from "@/server/postgres/principal-repository";
import { CollaborationRunRepository } from "@/server/postgres/collaboration-run-repository";
import { RoomRepository } from "@/server/postgres/room-repository";
import { WorkspaceRepository } from "@/server/postgres/workspace-repository";
import { createPostgresPool } from "@/server/postgres/client";

const databaseUrl =
  process.env.TEST_DATABASE_URL ??
  "postgresql://yoyoo:yoyoo_dev@127.0.0.1:55432/yoyoo_space";
const pool = createPostgresPool(databaseUrl, { max: 4 });

interface GatewayAgent {
  principalId: string;
  workspaceId: string;
  handle: string;
  displayName: string;
  credentialStatus: "active" | "revoked";
  connectionStatus: "never_connected" | "connected" | "offline" | "revoked";
}

interface GatewaySession {
  principalId: string;
  workspaceId: string;
  handle: string;
  displayName: string;
}

interface GatewayJob {
  id: string;
  runId: string;
  principalId: string;
  request: Record<string, unknown>;
  status: "queued" | "leased" | "completed" | "failed";
  leaseId: string | null;
  leasedAt: Date | null;
  leaseExpiresAt: Date | null;
  result: Record<string, unknown> | null;
  createdAt: Date;
  updatedAt: Date;
  finishedAt: Date | null;
}

interface GatewayRepository {
  createAgent(input: {
    workspaceId: string;
    actorPrincipalId: string;
    handle: string;
    displayName: string;
  }): Promise<{ agent: GatewayAgent; token: string }>;
  authenticate(token: string): Promise<GatewaySession | null>;
  listAgents(input: {
    workspaceId: string;
    actorPrincipalId: string;
    now?: Date;
  }): Promise<GatewayAgent[]>;
  heartbeat(principalId: string, now?: Date): Promise<GatewayAgent>;
  rotateCredential(input: {
    workspaceId: string;
    actorPrincipalId: string;
    principalId: string;
  }): Promise<{ agent: GatewayAgent; token: string }>;
  revokeCredential(input: {
    workspaceId: string;
    actorPrincipalId: string;
    principalId: string;
  }): Promise<GatewayAgent>;
  enqueueJob(input: {
    runId: string;
    request: Record<string, unknown>;
  }): Promise<GatewayJob>;
  getJobByRunId(runId: string): Promise<GatewayJob | null>;
  claimJob(input: {
    principalId: string;
    now?: Date;
    leaseMs?: number;
  }): Promise<GatewayJob | null>;
  settleJob(input: {
    principalId: string;
    jobId: string;
    leaseId: string;
    result: Record<string, unknown>;
    now?: Date;
  }): Promise<{ duplicate: boolean; job: GatewayJob }>;
}

type GatewayRepositoryConstructor = new (
  database: typeof pool,
) => GatewayRepository;

async function loadGatewayRepository(): Promise<GatewayRepositoryConstructor> {
  const gatewayModule = await vi
    .importActual<Record<string, unknown>>(
      "@/server/postgres/agent-gateway-repository",
    )
    .catch(() => null);
  expect(gatewayModule?.AgentGatewayRepository).toBeTypeOf("function");
  return gatewayModule!.AgentGatewayRepository as GatewayRepositoryConstructor;
}

async function createWorkspaceFixture() {
  const suffix = randomUUID();
  const principals = new PrincipalRepository(pool);
  const workspaces = new WorkspaceRepository(pool);
  const owner = await principals.create({
    kind: "human",
    externalKey: `human:gateway-owner-${suffix}`,
    handle: `owner-${suffix.slice(0, 8)}`,
    displayName: "Su Bai",
  });
  const workspace = await workspaces.create({
    slug: `gateway-${suffix}`,
    name: "Gateway Test Space",
    ownerPrincipalId: owner.id,
  });
  return { owner, workspace };
}

async function createRunFixture(input: {
  workspaceId: string;
  ownerPrincipalId: string;
  agentPrincipalId: string;
}) {
  const rooms = new RoomRepository(pool);
  const runs = new CollaborationRunRepository(pool);
  const room = await rooms.create({
    workspaceId: input.workspaceId,
    name: "Gateway Job Room",
    createdByPrincipalId: input.ownerPrincipalId,
  });
  await rooms.addMemberByOwner({
    roomId: room.id,
    actorPrincipalId: input.ownerPrincipalId,
    memberPrincipalId: input.agentPrincipalId,
  });
  const { message } = await rooms.createMessage({
    roomId: room.id,
    senderPrincipalId: input.ownerPrincipalId,
    kind: "message",
    content: "请分析这份材料",
    status: "completed",
    idempotencyKey: `gateway-message-${randomUUID()}`,
    mentionedPrincipalIds: [input.agentPrincipalId],
  });
  const [run] = await runs.createForMessage({
    roomId: room.id,
    triggerMessageId: message.id,
    targets: [
      {
        principalId: input.agentPrincipalId,
        adapterId: "yoyoo-agent-gateway",
      },
    ],
  });
  const context = await runs.getExecutionContext(run.id);
  return { room, message, run, request: context.request };
}

afterAll(async () => {
  await pool.end();
});

describe("AgentGatewayRepository", () => {
  it("returns a one-time token while persisting only its hash and hint", async () => {
    const Repository = await loadGatewayRepository();
    const repository = new Repository(pool);
    const fixture = await createWorkspaceFixture();

    const created = await repository.createAgent({
      workspaceId: fixture.workspace.id,
      actorPrincipalId: fixture.owner.id,
      handle: `researcher-${randomUUID().slice(0, 8)}`,
      displayName: "Research Agent",
    });

    expect(created.token).toMatch(/^yya_[A-Za-z0-9_-]{43}$/);
    expect(created.agent).toMatchObject({
      workspaceId: fixture.workspace.id,
      handle: expect.stringMatching(/^researcher-/),
      displayName: "Research Agent",
      credentialStatus: "active",
      connectionStatus: "never_connected",
    });

    const credential = await pool.query<{
      token_hash: string;
      token_hint: string;
    }>(
      `SELECT token_hash, token_hint
       FROM agent_gateway_credentials
       WHERE principal_id = $1`,
      [created.agent.principalId],
    );
    expect(credential.rows[0]).toEqual({
      token_hash: createHash("sha256").update(created.token).digest("hex"),
      token_hint: created.token.slice(-8),
    });
    expect(JSON.stringify(credential.rows[0])).not.toContain(created.token);

    await expect(repository.authenticate(created.token)).resolves.toMatchObject({
      principalId: created.agent.principalId,
      workspaceId: fixture.workspace.id,
      handle: created.agent.handle,
      displayName: "Research Agent",
    });
    await expect(repository.authenticate(`yya_${"x".repeat(43)}`)).resolves.toBeNull();

    await pool.query("UPDATE workspaces SET status = 'archived' WHERE id = $1", [
      fixture.workspace.id,
    ]);
    try {
      await expect(repository.authenticate(created.token)).resolves.toBeNull();
    } finally {
      await pool.query("UPDATE workspaces SET status = 'active' WHERE id = $1", [
        fixture.workspace.id,
      ]);
    }

    await expect(
      pool.query(
        `SELECT 1
         FROM workspace_members
         JOIN agent_bindings USING (principal_id)
         WHERE workspace_members.workspace_id = $1
           AND workspace_members.principal_id = $2
           AND workspace_members.status = 'active'
           AND agent_bindings.adapter_id = 'yoyoo-agent-gateway'
           AND agent_bindings.status = 'enabled'`,
        [fixture.workspace.id, created.agent.principalId],
      ),
    ).resolves.toMatchObject({ rowCount: 1 });
  });

  it("limits Agent management to workspace owners and enforces unique handles", async () => {
    const Repository = await loadGatewayRepository();
    const repository = new Repository(pool);
    const fixture = await createWorkspaceFixture();
    const principals = new PrincipalRepository(pool);
    const member = await principals.create({
      kind: "human",
      externalKey: `human:gateway-member-${randomUUID()}`,
      handle: `member-${randomUUID().slice(0, 8)}`,
      displayName: "Workspace Member",
    });
    await pool.query(
      `INSERT INTO workspace_members (workspace_id, principal_id, role)
       VALUES ($1, $2, 'member')`,
      [fixture.workspace.id, member.id],
    );

    await expect(
      repository.createAgent({
        workspaceId: fixture.workspace.id,
        actorPrincipalId: member.id,
        handle: "forbidden-agent",
        displayName: "Forbidden Agent",
      }),
    ).rejects.toMatchObject({ name: "AgentGatewayAuthorizationError" });

    const handle = `duplicate-${randomUUID().slice(0, 8)}`;
    await repository.createAgent({
      workspaceId: fixture.workspace.id,
      actorPrincipalId: fixture.owner.id,
      handle,
      displayName: "First Agent",
    });
    await expect(
      repository.createAgent({
        workspaceId: fixture.workspace.id,
        actorPrincipalId: fixture.owner.id,
        handle: handle.toUpperCase(),
        displayName: "Duplicate Agent",
      }),
    ).rejects.toMatchObject({ name: "AgentGatewayConflictError" });
    await expect(
      repository.listAgents({
        workspaceId: fixture.workspace.id,
        actorPrincipalId: member.id,
      }),
    ).rejects.toMatchObject({ name: "AgentGatewayAuthorizationError" });
  });

  it("tracks presence and rotates or revokes credentials without exposing old secrets", async () => {
    const Repository = await loadGatewayRepository();
    const repository = new Repository(pool);
    const fixture = await createWorkspaceFixture();
    const created = await repository.createAgent({
      workspaceId: fixture.workspace.id,
      actorPrincipalId: fixture.owner.id,
      handle: `presence-${randomUUID().slice(0, 8)}`,
      displayName: "Presence Agent",
    });
    const heartbeatAt = new Date(Date.now() + 1_000);

    await expect(
      repository.heartbeat(created.agent.principalId, heartbeatAt),
    ).resolves.toMatchObject({ connectionStatus: "connected" });
    await expect(
      repository.listAgents({
        workspaceId: fixture.workspace.id,
        actorPrincipalId: fixture.owner.id,
        now: new Date(heartbeatAt.getTime() + 46_000),
      }),
    ).resolves.toEqual([
      expect.objectContaining({
        principalId: created.agent.principalId,
        connectionStatus: "offline",
      }),
    ]);

    const rotated = await repository.rotateCredential({
      workspaceId: fixture.workspace.id,
      actorPrincipalId: fixture.owner.id,
      principalId: created.agent.principalId,
    });
    expect(rotated.token).not.toBe(created.token);
    expect(rotated.agent).toMatchObject({
      credentialVersion: 2,
      connectionStatus: "never_connected",
    });
    await expect(repository.authenticate(created.token)).resolves.toBeNull();
    await expect(repository.authenticate(rotated.token)).resolves.toMatchObject({
      principalId: created.agent.principalId,
      credentialVersion: 2,
    });

    await expect(
      repository.revokeCredential({
        workspaceId: fixture.workspace.id,
        actorPrincipalId: fixture.owner.id,
        principalId: created.agent.principalId,
      }),
    ).resolves.toMatchObject({
      credentialStatus: "revoked",
      connectionStatus: "revoked",
    });
    await expect(repository.authenticate(rotated.token)).resolves.toBeNull();
    await expect(
      pool.query<{ status: string }>(
        "SELECT status FROM agent_bindings WHERE principal_id = $1",
        [created.agent.principalId],
      ),
    ).resolves.toMatchObject({ rows: [{ status: "disabled" }] });
  });

  it("leases only the target Agent job, reclaims expiry, and settles idempotently", async () => {
    const Repository = await loadGatewayRepository();
    const repository = new Repository(pool);
    const fixture = await createWorkspaceFixture();
    const first = await repository.createAgent({
      workspaceId: fixture.workspace.id,
      actorPrincipalId: fixture.owner.id,
      handle: `worker-a-${randomUUID().slice(0, 8)}`,
      displayName: "Worker A",
    });
    const second = await repository.createAgent({
      workspaceId: fixture.workspace.id,
      actorPrincipalId: fixture.owner.id,
      handle: `worker-b-${randomUUID().slice(0, 8)}`,
      displayName: "Worker B",
    });
    const fixtureRun = await createRunFixture({
      workspaceId: fixture.workspace.id,
      ownerPrincipalId: fixture.owner.id,
      agentPrincipalId: first.agent.principalId,
    });
    const job = await repository.enqueueJob({
      runId: fixtureRun.run.id,
      request: fixtureRun.request,
    });
    const secondFixtureRun = await createRunFixture({
      workspaceId: fixture.workspace.id,
      ownerPrincipalId: fixture.owner.id,
      agentPrincipalId: first.agent.principalId,
    });
    const secondJob = await repository.enqueueJob({
      runId: secondFixtureRun.run.id,
      request: secondFixtureRun.request,
    });
    await expect(
      repository.enqueueJob({
        runId: fixtureRun.run.id,
        request: fixtureRun.request,
      }),
    ).resolves.toMatchObject({ id: job.id, status: "queued" });
    await expect(
      repository.claimJob({ principalId: second.agent.principalId }),
    ).resolves.toBeNull();

    const leaseAt = new Date(Date.now() + 1_000);
    const firstLease = await repository.claimJob({
      principalId: first.agent.principalId,
      now: leaseAt,
      leaseMs: 1_000,
    });
    expect(firstLease).toMatchObject({ status: "leased" });
    await expect(
      repository.claimJob({
        principalId: first.agent.principalId,
        now: new Date(leaseAt.getTime() + 500),
      }),
    ).resolves.toBeNull();
    await expect(
      repository.settleJob({
        principalId: first.agent.principalId,
        jobId: job.id,
        leaseId: firstLease!.leaseId!,
        result: { type: "completed", text: "过期结果" },
        now: new Date(leaseAt.getTime() + 1_001),
      }),
    ).rejects.toMatchObject({ name: "AgentGatewayConflictError" });
    const reclaimed = await repository.claimJob({
      principalId: first.agent.principalId,
      now: new Date(leaseAt.getTime() + 1_001),
    });
    expect(reclaimed?.leaseId).not.toBe(firstLease?.leaseId);

    await expect(
      repository.settleJob({
        principalId: second.agent.principalId,
        jobId: job.id,
        leaseId: reclaimed!.leaseId!,
        result: { type: "completed", text: "越权结果" },
      }),
    ).rejects.toMatchObject({ name: "AgentGatewayAuthorizationError" });
    const result = { type: "completed", text: "分析完成" };
    await expect(
      repository.settleJob({
        principalId: first.agent.principalId,
        jobId: job.id,
        leaseId: reclaimed!.leaseId!,
        result,
      }),
    ).resolves.toMatchObject({
      duplicate: false,
      job: { status: "completed", result },
    });
    await expect(
      repository.settleJob({
        principalId: first.agent.principalId,
        jobId: job.id,
        leaseId: reclaimed!.leaseId!,
        result: { text: "分析完成", type: "completed" },
      }),
    ).resolves.toMatchObject({ duplicate: true });
    await expect(
      repository.settleJob({
        principalId: first.agent.principalId,
        jobId: job.id,
        leaseId: reclaimed!.leaseId!,
        result: { type: "completed", text: "不同结果" },
      }),
    ).rejects.toMatchObject({ name: "AgentGatewayConflictError" });

    await expect(
      repository.claimJob({
        principalId: first.agent.principalId,
        now: new Date(leaseAt.getTime() + 1_002),
      }),
    ).resolves.toMatchObject({ id: secondJob.id, status: "leased" });
  });

  it("completes an existing collaboration run through the shared Gateway adapter", async () => {
    const Repository = await loadGatewayRepository();
    const repository = new Repository(pool);
    const fixture = await createWorkspaceFixture();
    const created = await repository.createAgent({
      workspaceId: fixture.workspace.id,
      actorPrincipalId: fixture.owner.id,
      handle: `runtime-${randomUUID().slice(0, 8)}`,
      displayName: "Runtime Agent",
    });
    const fixtureRun = await createRunFixture({
      workspaceId: fixture.workspace.id,
      ownerPrincipalId: fixture.owner.id,
      agentPrincipalId: created.agent.principalId,
    });
    const runs = new CollaborationRunRepository(pool);
    const coordinator = new CollaborationRunCoordinator(
      runs,
      new AgentRegistry([
        new AgentGatewayAdapter(repository, {
          pollIntervalMs: 2,
          responseTimeoutMs: 1_000,
        }),
      ]),
      new PrincipalRepository(pool),
      new DelegationRepository(pool),
      new ArtifactRepository(pool),
    );

    const execution = coordinator.start(fixtureRun.run.id);
    let queued: GatewayJob | null = null;
    for (let attempt = 0; attempt < 50 && !queued; attempt += 1) {
      queued = await repository.getJobByRunId(fixtureRun.run.id);
      if (!queued) await new Promise((resolve) => setTimeout(resolve, 2));
    }
    expect(queued).not.toBeNull();
    const leased = await repository.claimJob({
      principalId: created.agent.principalId,
    });
    await repository.settleJob({
      principalId: created.agent.principalId,
      jobId: leased!.id,
      leaseId: leased!.leaseId!,
      result: { type: "completed", text: "来自外部 Agent 的结果" },
    });
    await execution;

    await expect(runs.get(fixtureRun.run.id)).resolves.toMatchObject({
      status: "completed",
      targetAgentPrincipalId: created.agent.principalId,
    });
    await expect(new RoomRepository(pool).listMessages(fixtureRun.room.id)).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          senderPrincipalId: created.agent.principalId,
          content: "来自外部 Agent 的结果",
          status: "completed",
        }),
      ]),
    );
  });

  it("resumes an interrupted Gateway run without discarding its persisted events", async () => {
    const Repository = await loadGatewayRepository();
    const repository = new Repository(pool);
    const fixture = await createWorkspaceFixture();
    const created = await repository.createAgent({
      workspaceId: fixture.workspace.id,
      actorPrincipalId: fixture.owner.id,
      handle: `resume-${randomUUID().slice(0, 8)}`,
      displayName: "Resume Agent",
    });
    const fixtureRun = await createRunFixture({
      workspaceId: fixture.workspace.id,
      ownerPrincipalId: fixture.owner.id,
      agentPrincipalId: created.agent.principalId,
    });
    const runs = new CollaborationRunRepository(pool);
    await runs.claim(fixtureRun.run.id);
    await runs.appendEvent(fixtureRun.run.id, {
      sequence: 1,
      type: "status",
      status: "running",
    });
    await repository.enqueueJob({
      runId: fixtureRun.run.id,
      request: fixtureRun.request,
    });

    await expect(
      runs.requeueInterruptedRuns("yoyoo-agent-gateway"),
    ).resolves.toContain(fixtureRun.run.id);
    const coordinator = new CollaborationRunCoordinator(
      runs,
      new AgentRegistry([
        new AgentGatewayAdapter(repository, {
          pollIntervalMs: 2,
          responseTimeoutMs: 1_000,
        }),
      ]),
      new PrincipalRepository(pool),
      new DelegationRepository(pool),
      new ArtifactRepository(pool),
    );
    const execution = coordinator.start(fixtureRun.run.id);
    const leased = await repository.claimJob({
      principalId: created.agent.principalId,
    });
    await repository.settleJob({
      principalId: created.agent.principalId,
      jobId: leased!.id,
      leaseId: leased!.leaseId!,
      result: { type: "completed", text: "恢复后完成" },
    });
    await execution;

    await expect(runs.get(fixtureRun.run.id)).resolves.toMatchObject({
      status: "completed",
    });
    await expect(runs.listEvents(fixtureRun.run.id)).resolves.toMatchObject([
      { sequence: 1, event: { type: "status" } },
      { sequence: 2, event: { type: "status" } },
      { sequence: 3, event: { type: "completed", text: "恢复后完成" } },
    ]);
  });
});
