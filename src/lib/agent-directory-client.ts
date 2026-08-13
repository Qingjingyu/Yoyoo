export interface AgentDirectoryRecord {
  principalId: string;
  workspaceId: string;
  handle: string;
  displayName: string;
  authenticationMode: "gateway_token" | "aicard";
  credentialStatus: "active" | "revoked" | null;
  connectionStatus: "never_connected" | "connected" | "offline" | "revoked";
  tokenHint: string | null;
  credentialVersion: number | null;
  lastSeenAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AgentDirectoryClient {
  listAgents(): Promise<AgentDirectoryRecord[]>;
  rotateCredential(
    principalId: string,
  ): Promise<{ agent: AgentDirectoryRecord; token: string }>;
  revokeCredential(principalId: string): Promise<AgentDirectoryRecord>;
}

class AgentDirectoryApiError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AgentDirectoryApiError";
  }
}

async function requestJson<T>(
  fetcher: typeof fetch,
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<T> {
  const response = await fetcher(input, init);
  const body = (await response.json()) as T & { error?: { message?: string } };
  if (!response.ok) {
    throw new AgentDirectoryApiError(body.error?.message ?? "请求失败。");
  }
  return body;
}

export function createAgentDirectoryClient(
  fetcher: typeof fetch = fetch,
): AgentDirectoryClient {
  return {
    listAgents: async () => {
      const response = await requestJson<{ agents: AgentDirectoryRecord[] }>(
        fetcher,
        "/api/v1/workspaces/current/agents",
      );
      return response.agents;
    },
    rotateCredential: (principalId) =>
      requestJson(
        fetcher,
        `/api/v1/workspaces/current/agents/${encodeURIComponent(principalId)}/rotate`,
        { method: "POST" },
      ),
    revokeCredential: async (principalId) => {
      const response = await requestJson<{ agent: AgentDirectoryRecord }>(
        fetcher,
        `/api/v1/workspaces/current/agents/${encodeURIComponent(principalId)}/revoke`,
        { method: "POST" },
      );
      return response.agent;
    },
  };
}

export const browserAgentDirectoryClient = createAgentDirectoryClient();
