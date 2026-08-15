import { describe, expect, it, vi } from 'vitest';

import {
  AgentGatewayAuthenticationError,
  AgentGatewayPermissionError,
  AgentGatewayService,
  createConfiguredAgentGatewayService,
} from '@/server/agent-gateway-service';

const legacySession = {
  principalId: '019f78ba-6ea8-7e85-bdaf-05b5fe7aa0a1',
  workspaceId: '019f78ba-6ea8-7e85-bdaf-05b5fe7aa0a2',
  handle: 'legacy-agent',
  displayName: 'Legacy Agent',
  credentialVersion: 1,
  permissions: null,
};

function createRuntime(overrides: Record<string, unknown> = {}) {
  const repository = {
    authenticate: vi.fn().mockResolvedValue(legacySession),
    authenticateAICardRuntime: vi.fn().mockResolvedValue({
      ...legacySession,
      handle: 'aicard-agent',
      displayName: 'AI Card Agent',
      credentialVersion: null,
    }),
    heartbeat: vi.fn().mockResolvedValue({ connectionStatus: 'connected' }),
    claimJob: vi.fn().mockResolvedValue({ id: 'job-1' }),
  };
  const introspectAgentRuntime = vi.fn().mockResolvedValue({
    active: true,
    subject: `sub_${'b'.repeat(43)}`,
    nodeId: '019f78ba-6ea8-7e85-bdaf-05b5fe7aa0a3',
    machineName: 'aicard-agent',
    clientId: 'yoyoo_dev',
    audience: 'yoyoo',
    scope: 'agent.runtime',
    expiresAt: new Date(Date.now() + 60_000),
    ...overrides,
  });
  const service = new AgentGatewayService(repository as never, {
    issuer: 'http://127.0.0.1:3000',
    clientId: 'yoyoo_dev',
    audience: 'yoyoo',
    introspectAgentRuntime,
  });
  return { repository, introspectAgentRuntime, service };
}

describe('AgentGatewayService runtime authentication', () => {
  it('preserves legacy yya authentication', async () => {
    const { repository, introspectAgentRuntime, service } = createRuntime();
    const token = `yya_${'a'.repeat(43)}`;

    await expect(service.authenticate(`Bearer ${token}`)).resolves.toEqual(legacySession);
    expect(repository.authenticate).toHaveBeenCalledWith(token);
    expect(introspectAgentRuntime).not.toHaveBeenCalled();
  });

  it('maps a validated AI Card runtime claim to one local Agent session', async () => {
    const { repository, introspectAgentRuntime, service } = createRuntime();
    const token = `at_${'a'.repeat(43)}`;

    await expect(service.authenticate(`Bearer ${token}`)).resolves.toMatchObject({
      handle: 'aicard-agent',
      credentialVersion: null,
    });
    expect(introspectAgentRuntime).toHaveBeenCalledWith(token);
    expect(repository.authenticateAICardRuntime).toHaveBeenCalledWith({
      issuer: 'http://127.0.0.1:3000',
      clientId: 'yoyoo_dev',
      subject: `sub_${'b'.repeat(43)}`,
      nodeId: '019f78ba-6ea8-7e85-bdaf-05b5fe7aa0a3',
      expiresAt: expect.any(Date),
    });
  });

  it.each([
    ['wrong client', { clientId: 'other_client' }],
    ['wrong audience', { audience: 'other-platform' }],
    ['wrong scope', { scope: 'card.basic' }],
    ['expired session', { expiresAt: new Date(Date.now() - 1_000) }],
  ])('fails closed for %s', async (_name, override) => {
    const { repository, service } = createRuntime(override);

    await expect(service.authenticate(`Bearer at_${'a'.repeat(43)}`))
      .rejects.toBeInstanceOf(AgentGatewayAuthenticationError);
    expect(repository.authenticateAICardRuntime).not.toHaveBeenCalled();
  });

  it('uses AI Card runtime presence without requiring a legacy credential heartbeat', async () => {
    const { repository, service } = createRuntime();

    await expect(service.heartbeat(`Bearer at_${'a'.repeat(43)}`)).resolves.toMatchObject({
      handle: 'aicard-agent',
      credentialVersion: null,
    });
    expect(repository.heartbeat).not.toHaveBeenCalled();
  });

  it('enforces an admitted Agent minimum permission set while preserving legacy access', async () => {
    const { repository, service } = createRuntime();
    repository.authenticateAICardRuntime.mockResolvedValueOnce({
      ...legacySession,
      credentialVersion: null,
      permissions: ['message.read'],
    });

    await expect(service.authorize(
      `Bearer at_${'a'.repeat(43)}`,
      'message.read',
    )).resolves.toMatchObject({ permissions: ['message.read'] });
    repository.authenticateAICardRuntime.mockResolvedValueOnce({
      ...legacySession,
      credentialVersion: null,
      permissions: ['message.read'],
    });
    await expect(service.authorize(
      `Bearer at_${'a'.repeat(43)}`,
      'message.write',
    )).rejects.toBeInstanceOf(AgentGatewayPermissionError);
    await expect(service.authorize(
      `Bearer yya_${'a'.repeat(43)}`,
      'attachment.write',
    )).resolves.toMatchObject({ permissions: null });
  });

  it('allows an authenticated AI Card Agent to claim work without a legacy credential', async () => {
    const { repository, service } = createRuntime();

    await expect(service.claimJob({
      authorization: `Bearer at_${'a'.repeat(43)}`,
    })).resolves.toEqual({ id: 'job-1' });
    expect(repository.heartbeat).not.toHaveBeenCalled();
    expect(repository.claimJob).toHaveBeenCalledWith({
      principalId: legacySession.principalId,
      leaseMs: undefined,
    });
  });

  it('builds the production service with the configured AI Card authority', async () => {
    const { repository } = createRuntime();
    const fetcher = vi.fn().mockResolvedValue(Response.json({
      active: true,
      sub: `sub_${'b'.repeat(43)}`,
      node_id: '019f78ba-6ea8-7e85-bdaf-05b5fe7aa0a3',
      machine_name: 'aicard-agent',
      client_id: 'yoyoo_dev',
      audience: 'yoyoo',
      scope: 'agent.runtime',
      expires_at: new Date(Date.now() + 60_000).toISOString(),
      card_id: 'AI_100002',
      display_name: 'AI Card Agent',
      handle: 'aicard-agent',
    }));
    const service = createConfiguredAgentGatewayService(
      repository as never,
      {
        issuer: 'http://127.0.0.1:3000',
        clientId: 'yoyoo_dev',
        audience: 'yoyoo',
      },
      fetcher,
    );

    await expect(service.authenticate(`Bearer at_${'a'.repeat(43)}`))
      .resolves.toMatchObject({ credentialVersion: null });
    expect(fetcher).toHaveBeenCalledWith(
      new URL('http://127.0.0.1:3000/api/v1/agent-runtime/introspect'),
      expect.objectContaining({
        method: 'POST',
        headers: { authorization: `Bearer at_${'a'.repeat(43)}` },
      }),
    );
  });
});
