import type {
  AgentGatewayJobRecord,
  AgentGatewayPermission,
  AgentGatewaySessionRecord,
} from "@/domain/collaboration";
import {
  introspectAICardAgentRuntime,
  type AICardAgentRuntimeSession,
} from "@/server/aicard-client";
import { AgentGatewayRepository } from "@/server/postgres/agent-gateway-repository";

export class AgentGatewayAuthenticationError extends Error {
  constructor() {
    super("A valid Agent Bearer token is required");
    this.name = "AgentGatewayAuthenticationError";
  }
}

export class AgentGatewayPermissionError extends Error {
  constructor() {
    super("The Agent does not have the required permission");
    this.name = "AgentGatewayPermissionError";
  }
}

type AICardRuntimeAuthority = {
  issuer: string;
  clientId: string;
  audience: string;
  introspectAgentRuntime(token: string): Promise<AICardAgentRuntimeSession>;
};

type RuntimeCapableAgentGatewayRepository = AgentGatewayRepository & {
  authenticateAICardRuntime(input: {
    issuer: string;
    clientId: string;
    subject: string;
    nodeId: string;
    expiresAt: Date;
  }): Promise<AgentGatewaySessionRecord | null>;
};

export class AgentGatewayService {
  constructor(
    private readonly repository: RuntimeCapableAgentGatewayRepository,
    private readonly aicardRuntime?: AICardRuntimeAuthority,
  ) {}

  async authenticate(
    authorization: string | null,
  ): Promise<AgentGatewaySessionRecord> {
    const legacyMatch = authorization?.match(/^Bearer (yya_[A-Za-z0-9_-]{43})$/);
    if (legacyMatch) {
      const session = await this.repository.authenticate(legacyMatch[1]);
      if (!session) throw new AgentGatewayAuthenticationError();
      return session;
    }

    const runtimeMatch = authorization?.match(/^Bearer (at_[A-Za-z0-9_-]{43})$/);
    if (!runtimeMatch || !this.aicardRuntime) {
      throw new AgentGatewayAuthenticationError();
    }
    try {
      const claim = await this.aicardRuntime.introspectAgentRuntime(runtimeMatch[1]);
      if (
        !claim.active
        || claim.clientId !== this.aicardRuntime.clientId
        || claim.audience !== this.aicardRuntime.audience
        || claim.scope !== "agent.runtime"
        || claim.expiresAt.getTime() <= Date.now()
      ) {
        throw new AgentGatewayAuthenticationError();
      }
      const session = await this.repository.authenticateAICardRuntime({
        issuer: this.aicardRuntime.issuer,
        clientId: claim.clientId,
        subject: claim.subject,
        nodeId: claim.nodeId,
        expiresAt: claim.expiresAt,
      });
      if (!session) throw new AgentGatewayAuthenticationError();
      return session;
    } catch {
      throw new AgentGatewayAuthenticationError();
    }
  }

  async heartbeat(
    authorization: string | null,
  ): Promise<
    AgentGatewaySessionRecord
    | Awaited<ReturnType<AgentGatewayRepository["heartbeat"]>>
  > {
    const session = await this.authenticate(authorization);
    if (session.credentialVersion === null) return session;
    return this.repository.heartbeat(session.principalId);
  }

  async authorize(
    authorization: string | null,
    permission: AgentGatewayPermission,
  ): Promise<AgentGatewaySessionRecord> {
    const session = await this.authenticate(authorization);
    if (session.permissions !== null && !session.permissions.includes(permission)) {
      throw new AgentGatewayPermissionError();
    }
    return session;
  }

  async claimJob(input: {
    authorization: string | null;
    leaseMs?: number;
  }): Promise<AgentGatewayJobRecord | null> {
    const session = await this.authorize(input.authorization, "message.read");
    if (session.credentialVersion !== null) {
      await this.repository.heartbeat(session.principalId);
    }
    return this.repository.claimJob({
      principalId: session.principalId,
      leaseMs: input.leaseMs,
    });
  }

  async settleJob(input: {
    authorization: string | null;
    jobId: string;
    leaseId: string;
    result: Record<string, unknown>;
  }): Promise<Awaited<ReturnType<AgentGatewayRepository["settleJob"]>>> {
    const session = await this.authorize(input.authorization, "message.write");
    return this.repository.settleJob({
      principalId: session.principalId,
      jobId: input.jobId,
      leaseId: input.leaseId,
      result: input.result,
    });
  }
}

export function createConfiguredAgentGatewayService(
  repository: RuntimeCapableAgentGatewayRepository,
  runtimeConfig: {
    issuer: string;
    clientId: string;
    audience: string;
  } | null,
  fetcher: typeof fetch = fetch,
): AgentGatewayService {
  if (!runtimeConfig) return new AgentGatewayService(repository);
  return new AgentGatewayService(repository, {
    ...runtimeConfig,
    introspectAgentRuntime: (token) => introspectAICardAgentRuntime(
      runtimeConfig.issuer,
      token,
      fetcher,
    ),
  });
}
