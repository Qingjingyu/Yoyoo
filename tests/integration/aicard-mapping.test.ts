/** @vitest-environment node */

import { createHash, randomUUID } from 'node:crypto';

import { afterAll, describe, expect, it } from 'vitest';

import {
  AICardIdentityConflictError,
  PrincipalRepository,
} from '@/server/postgres/principal-repository';
import {
  AgentGatewayRepository,
  GATEWAY_ADAPTER_ID,
} from '@/server/postgres/agent-gateway-repository';
import { WorkspaceRepository } from '@/server/postgres/workspace-repository';
import { RoomRepository } from '@/server/postgres/room-repository';
import { CollaborationRunRepository } from '@/server/postgres/collaboration-run-repository';
import { createPostgresPool } from '@/server/postgres/client';

const databaseUrl =
  process.env.TEST_DATABASE_URL ??
  'postgresql://yoyoo:yoyoo_dev@127.0.0.1:55432/yoyoo_space';
const pool = createPostgresPool(databaseUrl, { max: 4 });
let cardSequence = BigInt(Date.now()) * 1_000n;

function nextCardId(): string {
  cardSequence += 1n;
  return `AI_${cardSequence}`;
}

afterAll(async () => {
  await pool.end();
});

describe('AI Card identity mapping', () => {
  it('can attach a human Card to the existing local owner without changing ownership', async () => {
    const repository = new PrincipalRepository(pool);
    const owner = await repository.create({
      kind: 'human',
      externalKey: `human:existing-owner-${randomUUID()}`,
      handle: `owner-${randomUUID().slice(0, 8)}`,
      displayName: '苏白',
    });
    const subject = `sub_${randomUUID().replaceAll('-', '').padEnd(43, 'e').slice(0, 43)}`;
    const cardId = nextCardId();

    const linked = await repository.mapAICardIdentity({
      issuer: 'http://127.0.0.1:3000',
      clientId: 'yoyoo_dev',
      subject,
      cardId,
      principalType: 'human',
      displayName: '苏白',
      handle: `subai_${randomUUID().slice(0, 8)}`,
      principalId: owner.id,
    });

    expect(linked.created).toBe(false);
    expect(linked.principal.id).toBe(owner.id);
    expect(linked.principal.externalKey).toBe(owner.externalKey);
    expect(linked.mapping.principalId).toBe(owner.id);
  });

  it('maps repeated pairwise subject authorization to one stable local Principal', async () => {
    const repository = new PrincipalRepository(pool);
    const subject = `sub_${randomUUID().replaceAll('-', '').padEnd(43, 'a').slice(0, 43)}`;
    const cardId = nextCardId();
    const first = await repository.mapAICardIdentity({
      issuer: 'http://127.0.0.1:3000',
      clientId: 'yoyoo_dev',
      subject,
      cardId,
      principalType: 'ai',
      displayName: '研究员小悠',
      handle: `researcher_${randomUUID().slice(0, 8)}`,
    });
    const repeated = await repository.mapAICardIdentity({
      issuer: 'http://127.0.0.1:3000',
      clientId: 'yoyoo_dev',
      subject,
      cardId,
      principalType: 'ai',
      displayName: '研究员小悠（更新）',
      handle: first.principal.handle,
    });

    expect(first.created).toBe(true);
    expect(repeated.created).toBe(false);
    expect(repeated.principal.id).toBe(first.principal.id);
    expect(repeated.principal.kind).toBe('agent');
    expect(repeated.principal.displayName).toBe('研究员小悠（更新）');
    expect(repeated.mapping).toMatchObject({
      issuer: 'http://127.0.0.1:3000',
      clientId: 'yoyoo_dev',
      subject,
      principalId: first.principal.id,
    });
    expect(repeated.principal.externalKey).not.toContain(subject);
  });

  it('refuses to silently reuse a mapped Subject when a different local owner is required', async () => {
    const repository = new PrincipalRepository(pool);
    const subject = `sub_${randomUUID().replaceAll('-', '').padEnd(43, 'm').slice(0, 43)}`;
    const cardId = nextCardId();
    const existing = await repository.mapAICardIdentity({
      issuer: 'http://127.0.0.1:3000',
      clientId: 'yoyoo_dev',
      subject,
      cardId,
      principalType: 'human',
      displayName: 'Existing Human',
      handle: `existing-${randomUUID().slice(0, 8)}`,
    });
    const requiredOwner = await repository.create({
      kind: 'human',
      externalKey: `human:required-owner-${randomUUID()}`,
      handle: `required-${randomUUID().slice(0, 8)}`,
      displayName: 'Required Owner',
    });

    await expect(repository.mapAICardIdentity({
      issuer: 'http://127.0.0.1:3000',
      clientId: 'yoyoo_dev',
      subject,
      cardId,
      principalType: 'human',
      displayName: 'Attempted Owner',
      handle: `attempted-${randomUUID().slice(0, 8)}`,
      principalId: requiredOwner.id,
    })).rejects.toBeInstanceOf(AICardIdentityConflictError);

    const mapping = await pool.query<{ principal_id: string }>(
      `SELECT principal_id FROM aicard_identity_mappings
       WHERE issuer = $1 AND client_id = $2 AND subject = $3`,
      ['http://127.0.0.1:3000', 'yoyoo_dev', subject],
    );
    expect(mapping.rows[0]?.principal_id).toBe(existing.principal.id);
  });

  it('atomically activates an AI Card Agent in the selected workspace', async () => {
    const principals = new PrincipalRepository(pool);
    const workspaces = new WorkspaceRepository(pool);
    const owner = await principals.create({
      kind: 'human',
      externalKey: `human:aicard-workspace-owner-${randomUUID()}`,
      handle: `workspace-owner-${randomUUID().slice(0, 8)}`,
      displayName: '工作空间管理员',
    });
    const workspace = await workspaces.create({
      slug: `aicard-agent-${randomUUID()}`,
      name: 'AI Card Agent Workspace',
      ownerPrincipalId: owner.id,
    });
    const subject = `sub_${randomUUID().replaceAll('-', '').padEnd(43, 'd').slice(0, 43)}`;
    const cardId = nextCardId();

    const first = await principals.mapAICardIdentity({
      issuer: 'http://127.0.0.1:3000',
      clientId: 'yoyoo_dev',
      subject,
      cardId,
      principalType: 'ai',
      displayName: 'AI Card 研究员',
      handle: `aicard-agent-${randomUUID().slice(0, 8)}`,
      workspaceId: workspace.id,
    });
    const repeated = await principals.mapAICardIdentity({
      issuer: 'http://127.0.0.1:3000',
      clientId: 'yoyoo_dev',
      subject,
      cardId,
      principalType: 'ai',
      displayName: 'AI Card 研究员（更新）',
      handle: first.principal.handle,
      workspaceId: workspace.id,
    });
    const memberships = await workspaces.listMembers(workspace.id);

    expect(repeated.principal.id).toBe(first.principal.id);
    expect(memberships).toContainEqual(expect.objectContaining({
      principalId: first.principal.id,
      principalKind: 'agent',
      role: 'member',
      status: 'active',
    }));
    expect(memberships.filter((member) => member.principalId === first.principal.id))
      .toHaveLength(1);
    await expect(principals.getAgentBinding(first.principal.id)).resolves.toMatchObject({
      adapterId: GATEWAY_ADAPTER_ID,
      status: 'enabled',
    });
  });

  it('resolves an AI Card runtime claim to one active local Agent and presence record', async () => {
    const principals = new PrincipalRepository(pool);
    const workspaces = new WorkspaceRepository(pool);
    const gateway = new AgentGatewayRepository(pool);
    const owner = await principals.create({
      kind: 'human',
      externalKey: `human:aicard-runtime-owner-${randomUUID()}`,
      handle: `runtime-owner-${randomUUID().slice(0, 8)}`,
      displayName: '运行空间管理员',
    });
    const workspace = await workspaces.create({
      slug: `aicard-runtime-${randomUUID()}`,
      name: 'AI Card Runtime Workspace',
      ownerPrincipalId: owner.id,
    });
    const subject = `sub_${randomUUID().replaceAll('-', '').padEnd(43, 'r').slice(0, 43)}`;
    const cardId = nextCardId();
    const mapped = await principals.mapAICardIdentity({
      issuer: 'http://127.0.0.1:3000',
      clientId: 'yoyoo_dev',
      subject,
      cardId,
      principalType: 'ai',
      displayName: '运行研究员',
      handle: `runtime-agent-${randomUUID().slice(0, 8)}`,
      workspaceId: workspace.id,
    });
    const nodeId = randomUUID();

    await expect(gateway.authenticateAICardRuntime({
      issuer: 'http://127.0.0.1:3000',
      clientId: 'yoyoo_dev',
      subject,
      nodeId,
      expiresAt: new Date(Date.now() + 60_000),
    })).resolves.toMatchObject({
      principalId: mapped.principal.id,
      workspaceId: workspace.id,
      handle: mapped.principal.handle,
      credentialVersion: null,
    });
    await expect(principals.listAICardAgents(workspace.id)).resolves.toEqual([
      expect.objectContaining({
        principalId: mapped.principal.id,
        connectionStatus: 'connected',
        lastSeenAt: expect.any(Date),
      }),
    ]);
    await expect(pool.query(
      'select 1 from agent_gateway_credentials where principal_id = $1',
      [mapped.principal.id],
    )).resolves.toMatchObject({ rowCount: 0 });

    const rooms = new RoomRepository(pool);
    const runs = new CollaborationRunRepository(pool);
    const room = await rooms.create({
      workspaceId: workspace.id,
      name: 'AI Card Runtime Room',
      createdByPrincipalId: owner.id,
    });
    await rooms.addMemberByOwner({
      roomId: room.id,
      actorPrincipalId: owner.id,
      memberPrincipalId: mapped.principal.id,
    });
    const { message } = await rooms.createMessage({
      roomId: room.id,
      senderPrincipalId: owner.id,
      kind: 'message',
      content: '请处理这项运行时任务',
      status: 'completed',
      idempotencyKey: `aicard-runtime-message-${randomUUID()}`,
      mentionedPrincipalIds: [mapped.principal.id],
    });
    const [run] = await runs.createForMessage({
      roomId: room.id,
      triggerMessageId: message.id,
      targets: [{
        principalId: mapped.principal.id,
        adapterId: GATEWAY_ADAPTER_ID,
      }],
    });
    const execution = await runs.getExecutionContext(run.id);
    const queued = await gateway.enqueueJob({
      runId: run.id,
      request: execution.request,
    });
    await expect(gateway.claimJob({
      principalId: mapped.principal.id,
    })).resolves.toMatchObject({
      id: queued.id,
      principalId: mapped.principal.id,
      status: 'leased',
    });

    await expect(gateway.authenticateAICardRuntime({
      issuer: 'http://127.0.0.1:3000',
      clientId: 'yoyoo_dev',
      subject: `sub_${'x'.repeat(43)}`,
      nodeId,
      expiresAt: new Date(Date.now() + 60_000),
    })).resolves.toBeNull();
  });

  it('does not merge different subjects that share Chinese display identity', async () => {
    const repository = new PrincipalRepository(pool);
    const suffix = randomUUID().replaceAll('-', '');
    const shared = {
      issuer: 'http://127.0.0.1:3000',
      clientId: 'yoyoo_dev',
      cardId: nextCardId(),
      principalType: 'human' as const,
      displayName: '苏白',
      handle: `subai_${randomUUID().slice(0, 8)}`,
    };
    const first = await repository.mapAICardIdentity({
      ...shared,
      subject: `sub_${suffix.padEnd(43, 'b').slice(0, 43)}`,
    });
    const second = await repository.mapAICardIdentity({
      ...shared,
      cardId: nextCardId(),
      subject: `sub_${suffix.padEnd(43, 'c').slice(0, 42)}c`,
    });

    expect(second.principal.id).not.toBe(first.principal.id);
    expect(second.principal.kind).toBe('human');
  });

  it('does not bind one authoritative Card ID to two pairwise subjects', async () => {
    const repository = new PrincipalRepository(pool);
    const cardId = nextCardId();
    const firstSubject = `sub_${randomUUID().replaceAll('-', '').padEnd(43, 'x').slice(0, 43)}`;
    const secondSubject = `sub_${randomUUID().replaceAll('-', '').padEnd(43, 'y').slice(0, 43)}`;
    await repository.mapAICardIdentity({
      issuer: 'http://127.0.0.1:3000',
      clientId: 'yoyoo_dev',
      subject: firstSubject,
      cardId,
      principalType: 'human',
      displayName: '同一卡片',
      handle: `card-conflict-${randomUUID().slice(0, 8)}`,
    });

    await expect(repository.mapAICardIdentity({
      issuer: 'http://127.0.0.1:3000',
      clientId: 'yoyoo_dev',
      subject: secondSubject,
      cardId,
      principalType: 'human',
      displayName: '伪造身份',
      handle: `card-conflict-${randomUUID().slice(0, 8)}`,
    })).rejects.toBeInstanceOf(AICardIdentityConflictError);

    const duplicatePrincipal = await pool.query<{ count: string }>(
      `SELECT COUNT(*)::TEXT AS count
       FROM principals
       WHERE external_key = $1`,
      [
        `aicard:${createHash('sha256')
          .update(JSON.stringify(['http://127.0.0.1:3000', 'yoyoo_dev', secondSubject]))
          .digest('hex')}`,
      ],
    );
    expect(duplicatePrincipal.rows[0].count).toBe('0');
  });
});
