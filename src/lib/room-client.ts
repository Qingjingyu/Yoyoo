import type {
  AgentBindingRecord,
  ArtifactRecord,
  CollaborationRunRecord,
  DelegationRecord,
  LinkedAttachmentMetadata,
  PrincipalRecord,
  RoomMemberRecord,
  RoomMemberCandidateRecord,
  RoomMemberStateRecord,
  RoomMessageRecord,
  RoomRecord,
  RoomStatus,
  RoomSummaryRecord,
  WorkspaceRecord,
} from "@/domain/collaboration";

export interface WorkspaceAgent {
  principalId: string;
  displayName: string;
  adapterId: string;
  capabilities: AgentBindingRecord["capabilities"];
}

export interface CurrentWorkspace {
  principal: PrincipalRecord;
  workspace: WorkspaceRecord;
  rooms: RoomSummaryRecord[];
  archivedRooms: RoomSummaryRecord[];
  agents: WorkspaceAgent[];
}

export interface RoomSnapshot {
  room: RoomRecord;
  members: RoomMemberRecord[];
  messages: RoomMessageRecord[];
  runs: CollaborationRunRecord[];
  delegations: DelegationRecord[];
  artifacts: ArtifactRecord[];
  attachments: LinkedAttachmentMetadata[];
  memberState: RoomMemberStateRecord;
}

export interface RoomMembershipDetails {
  canManage: boolean;
  members: RoomMemberRecord[];
  candidates: RoomMemberCandidateRecord[];
}

export interface RoomRunEvent {
  runId: string;
  sequence: number;
  type: "status" | "text_delta" | "delegation" | "artifact" | "completed" | "failed" | "stopped";
  status?: string;
  delta?: string;
  text?: string;
  error?: { code: string; message: string; retriable: boolean };
}

export interface RoomSubmission {
  duplicate: boolean;
  message: RoomMessageRecord;
  runs: CollaborationRunRecord[];
  memberState?: RoomMemberStateRecord;
}

interface RoomEventHandlers {
  onEvent: (event: RoomRunEvent) => void;
  onOpen?: () => void;
  onReconnecting?: () => void;
}

export interface RoomClient {
  getCurrentWorkspace(): Promise<CurrentWorkspace>;
  createRoom(
    name: string,
    idempotencyKey: string,
  ): Promise<{ duplicate: boolean; room: RoomRecord }>;
  createDirectRoom(
    agentPrincipalId: string,
  ): Promise<{ duplicate: boolean; room: RoomRecord }>;
  renameRoom(roomId: string, name: string): Promise<RoomRecord>;
  setRoomStatus(roomId: string, status: RoomStatus): Promise<RoomRecord>;
  getRoom(roomId: string): Promise<RoomSnapshot>;
  getRoomMembers(roomId: string): Promise<RoomMembershipDetails>;
  addRoomMember(roomId: string, principalId: string): Promise<RoomMemberRecord>;
  removeRoomMember(roomId: string, principalId: string): Promise<RoomMemberRecord>;
  sendMessage(
    roomId: string,
    input: {
      content: string;
      attachmentIds?: string[];
      mentionedPrincipalIds: string[];
      idempotencyKey: string;
      replyToMessageId?: string | null;
      draftRevision?: number;
    },
  ): Promise<RoomSubmission>;
  updateReadState(
    roomId: string,
    input: { lastReadMessageId?: string; readingMessageId?: string },
  ): Promise<RoomMemberStateRecord>;
  saveDraft(
    roomId: string,
    content: string,
    expectedRevision: number,
  ): Promise<RoomMemberStateRecord>;
  editMessage(
    roomId: string,
    messageId: string,
    content: string,
    expectedRevisionNumber: number,
  ): Promise<RoomMessageRecord>;
  retractMessage(
    roomId: string,
    messageId: string,
    expectedRevisionNumber: number,
  ): Promise<RoomMessageRecord>;
  subscribeToRun(roomId: string, runId: string, handlers: RoomEventHandlers): () => void;
  intervene(
    roomId: string,
    runId: string,
    content: string,
    idempotencyKey: string,
  ): Promise<RoomMessageRecord>;
  retryRun(
    roomId: string,
    runId: string,
    idempotencyKey: string,
  ): Promise<{ duplicate: boolean; run: CollaborationRunRecord }>;
}

export class RoomApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "RoomApiError";
  }
}

async function requestJson<T>(
  fetcher: typeof fetch,
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<T> {
  const response = await fetcher(input, init);
  const body = (await response.json()) as T & {
    error?: { code?: string; message?: string };
  };
  if (!response.ok) {
    throw new RoomApiError(
      body.error?.code ?? "REQUEST_FAILED",
      body.error?.message ?? "请求失败。",
      response.status,
    );
  }
  return body;
}

export function createRoomClient(options: {
  fetcher?: typeof fetch;
  createEventSource?: (url: string) => EventSource;
} = {}): RoomClient {
  const fetcher = options.fetcher ?? fetch;
  const createEventSource = options.createEventSource ?? ((url: string) => new EventSource(url));
  return {
    getCurrentWorkspace: () => requestJson(fetcher, "/api/v1/workspaces/current"),

    createRoom: (name, idempotencyKey) =>
      requestJson(fetcher, "/api/v1/rooms", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "Idempotency-Key": idempotencyKey,
        },
        body: JSON.stringify({ name }),
      }),

    createDirectRoom: (agentPrincipalId) =>
      requestJson(fetcher, "/api/v1/direct-rooms", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ agentPrincipalId }),
      }),

    renameRoom: (roomId, name) =>
      requestJson(fetcher, `/api/v1/rooms/${encodeURIComponent(roomId)}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name }),
      }),

    setRoomStatus: (roomId, status) =>
      requestJson(fetcher, `/api/v1/rooms/${encodeURIComponent(roomId)}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ status }),
      }),

    getRoom: (roomId) =>
      requestJson(fetcher, `/api/v1/rooms/${encodeURIComponent(roomId)}`),

    getRoomMembers: (roomId) =>
      requestJson(fetcher, `/api/v1/rooms/${encodeURIComponent(roomId)}/members`),

    addRoomMember: async (roomId, principalId) => {
      const response = await requestJson<{ member: RoomMemberRecord }>(
        fetcher,
        `/api/v1/rooms/${encodeURIComponent(roomId)}/members`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ principalId }),
        },
      );
      return response.member;
    },

    removeRoomMember: async (roomId, principalId) => {
      const response = await requestJson<{ member: RoomMemberRecord }>(
        fetcher,
        `/api/v1/rooms/${encodeURIComponent(roomId)}/members/${encodeURIComponent(principalId)}`,
        { method: "DELETE" },
      );
      return response.member;
    },

    sendMessage: (roomId, input) =>
      requestJson(fetcher, `/api/v1/rooms/${encodeURIComponent(roomId)}/messages`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "Idempotency-Key": input.idempotencyKey,
        },
        body: JSON.stringify({
          content: input.content,
          mentionedPrincipalIds: input.mentionedPrincipalIds,
          ...(input.attachmentIds?.length
            ? { attachmentIds: input.attachmentIds }
            : {}),
          ...(input.replyToMessageId
            ? { replyToMessageId: input.replyToMessageId }
            : {}),
          ...(input.draftRevision === undefined
            ? {}
            : { draftRevision: input.draftRevision }),
        }),
      }),

    updateReadState: async (roomId, input) => {
      const response = await requestJson<{ memberState: RoomMemberStateRecord }>(
        fetcher,
        `/api/v1/rooms/${encodeURIComponent(roomId)}/read`,
        {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(input),
        },
      );
      return response.memberState;
    },

    saveDraft: async (roomId, content, expectedRevision) => {
      const response = await requestJson<{ memberState: RoomMemberStateRecord }>(
        fetcher,
        `/api/v1/rooms/${encodeURIComponent(roomId)}/draft`,
        {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ content, expectedRevision }),
        },
      );
      return response.memberState;
    },

    editMessage: async (roomId, messageId, content, expectedRevisionNumber) => {
      const response = await requestJson<{ message: RoomMessageRecord }>(
        fetcher,
        `/api/v1/rooms/${encodeURIComponent(roomId)}/messages/${encodeURIComponent(messageId)}`,
        {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ content, expectedRevisionNumber }),
        },
      );
      return response.message;
    },

    retractMessage: async (roomId, messageId, expectedRevisionNumber) => {
      const response = await requestJson<{ message: RoomMessageRecord }>(
        fetcher,
        `/api/v1/rooms/${encodeURIComponent(roomId)}/messages/${encodeURIComponent(messageId)}`,
        {
          method: "DELETE",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ expectedRevisionNumber }),
        },
      );
      return response.message;
    },

    subscribeToRun: (roomId, runId, handlers) => {
      const source = createEventSource(
        `/api/v1/rooms/${encodeURIComponent(roomId)}/events?runId=${encodeURIComponent(runId)}`,
      );
      const terminalTypes = new Set(["completed", "failed", "stopped"]);
      const eventTypes = [
        "status",
        "text_delta",
        "delegation",
        "artifact",
        "completed",
        "failed",
        "stopped",
      ];
      const handleEvent = (rawEvent: Event) => {
        const event = JSON.parse((rawEvent as MessageEvent<string>).data) as RoomRunEvent;
        handlers.onEvent(event);
        if (terminalTypes.has(event.type)) source.close();
      };
      for (const type of eventTypes) source.addEventListener(type, handleEvent);
      source.onopen = () => handlers.onOpen?.();
      source.onerror = () => handlers.onReconnecting?.();
      return () => source.close();
    },

    intervene: async (roomId, runId, content, idempotencyKey) => {
      const response = await requestJson<{ message: RoomMessageRecord }>(
        fetcher,
        `/api/v1/rooms/${encodeURIComponent(roomId)}/runs/${encodeURIComponent(runId)}/intervene`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "Idempotency-Key": idempotencyKey,
          },
          body: JSON.stringify({ content }),
        },
      );
      return response.message;
    },

    retryRun: (roomId, runId, idempotencyKey) =>
      requestJson(
        fetcher,
        `/api/v1/rooms/${encodeURIComponent(roomId)}/runs/${encodeURIComponent(runId)}/retry`,
        { method: "POST", headers: { "Idempotency-Key": idempotencyKey } },
      ),
  };
}

export const browserRoomClient = createRoomClient();
