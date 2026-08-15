export interface AgentDirectoryRecord {
  principalId: string;
  workspaceId: string;
  handle: string;
  displayName: string;
  cardId: string | null;
  machineName: string | null;
  authenticationMode: "gateway_token" | "aicard";
  credentialStatus: "active" | "revoked" | null;
  connectionStatus: "never_connected" | "connected" | "offline" | "revoked";
  tokenHint: string | null;
  credentialVersion: number | null;
  lastSeenAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export type AgentAdmissionPermission =
  | "message.read"
  | "message.write"
  | "attachment.read"
  | "attachment.write";

export interface AgentAdmissionRoom {
  id: string;
  name: string;
  status: "active" | "archived";
}

export interface AgentAdmissionInvitation {
  invitationId: string;
  displayName: string;
  machineName: string | null;
  roomIds: string[];
  permissions: AgentAdmissionPermission[];
  status: "pending" | "admitted" | "expired" | "revoked" | "failed";
  expiresAt: string;
  cardId: string | null;
  principalId: string | null;
  nodeId: string | null;
  createdAt: string;
  admittedAt: string | null;
}

export interface CreatedAgentAdmissionInvitation extends AgentAdmissionInvitation {
  instructions: string;
}

export interface AgentDirectoryClient {
  listAgents(): Promise<AgentDirectoryRecord[]>;
  listRooms(): Promise<AgentAdmissionRoom[]>;
  listInvitations(): Promise<AgentAdmissionInvitation[]>;
  createInvitation(input: {
    displayName: string;
    roomIds: string[];
    permissions: AgentAdmissionPermission[];
  }): Promise<CreatedAgentAdmissionInvitation>;
  revokeInvitation(invitationId: string): Promise<void>;
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
    listRooms: async () => {
      const response = await requestJson<{ rooms: AgentAdmissionRoom[] }>(
        fetcher,
        "/api/v1/rooms",
      );
      return response.rooms;
    },
    listInvitations: async () => {
      const response = await requestJson<{ invitations: AgentAdmissionInvitation[] }>(
        fetcher,
        "/api/v1/workspaces/current/agent-invitations",
      );
      return response.invitations;
    },
    createInvitation: async (input) => {
      const response = await requestJson<{ invitation: CreatedAgentAdmissionInvitation }>(
        fetcher,
        "/api/v1/workspaces/current/agent-invitations",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(input),
        },
      );
      return response.invitation;
    },
    revokeInvitation: async (invitationId) => {
      const response = await fetcher(
        `/api/v1/workspaces/current/agent-invitations/${encodeURIComponent(invitationId)}`,
        { method: "DELETE" },
      );
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as {
          error?: { message?: string };
        } | null;
        throw new AgentDirectoryApiError(body?.error?.message ?? "邀请未能撤销。");
      }
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
