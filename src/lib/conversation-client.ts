import type { AgentEvent } from "@/agents/contract";

export interface ClientMessage {
  id: string;
  conversationId: string;
  senderType: "human" | "agent" | "system";
  content: string;
  status: "pending" | "streaming" | "completed" | "stopped" | "failed";
}

export interface ClientRun {
  id: string;
  status: "queued" | "running" | "completed" | "stopped" | "failed";
}

export interface ConversationSnapshot {
  conversation: { id: string };
  messages: ClientMessage[];
  activeRun: ClientRun | null;
  capabilities: { cancellation: boolean };
}

export interface SubmissionResponse {
  duplicate: boolean;
  message: ClientMessage;
  run: ClientRun;
}

export type ClientRunEvent = AgentEvent & { runId: string };

export interface RunEventHandlers {
  onEvent: (event: ClientRunEvent) => void;
  onOpen?: () => void;
  onReconnecting?: () => void;
}

export interface ConversationClient {
  getCurrent(): Promise<ConversationSnapshot>;
  sendMessage(content: string, idempotencyKey: string): Promise<SubmissionResponse>;
  subscribeToRun(runId: string, handlers: RunEventHandlers): () => void;
  cancelRun(runId: string): Promise<void>;
  retryRun(runId: string): Promise<ClientRun>;
}

export class ConversationApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "ConversationApiError";
  }
}

async function requestJson<T>(input: RequestInfo | URL, init?: RequestInit): Promise<T> {
  const response = await fetch(input, init);
  const body = (await response.json()) as T & {
    error?: { code?: string; message?: string };
  };
  if (!response.ok) {
    throw new ConversationApiError(
      body.error?.code ?? "REQUEST_FAILED",
      body.error?.message ?? "请求失败。",
      response.status,
    );
  }
  return body;
}

export const browserConversationClient: ConversationClient = {
  getCurrent: () => requestJson("/api/v1/conversations/current"),

  sendMessage: (content, idempotencyKey) =>
    requestJson("/api/v1/conversations/current/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "Idempotency-Key": idempotencyKey,
      },
      body: JSON.stringify({ content }),
    }),

  subscribeToRun: (runId, handlers) => {
    const source = new EventSource(
      `/api/v1/conversations/current/events?runId=${encodeURIComponent(runId)}`,
    );
    const eventTypes = ["status", "text_delta", "completed", "failed", "stopped"];
    const handleEvent = (rawEvent: Event) => {
      const event = JSON.parse((rawEvent as MessageEvent<string>).data) as ClientRunEvent;
      handlers.onEvent(event);
      if (event.type === "completed" || event.type === "failed" || event.type === "stopped") {
        source.close();
      }
    };
    for (const type of eventTypes) source.addEventListener(type, handleEvent);
    source.onopen = () => handlers.onOpen?.();
    source.onerror = () => handlers.onReconnecting?.();
    return () => source.close();
  },

  cancelRun: async (runId) => {
    await requestJson(`/api/v1/runs/${encodeURIComponent(runId)}/cancel`, {
      method: "POST",
    });
  },

  retryRun: async (runId) => {
    const response = await requestJson<{ run: ClientRun }>(
      `/api/v1/runs/${encodeURIComponent(runId)}/retry`,
      {
        method: "POST",
        headers: { "Idempotency-Key": crypto.randomUUID() },
      },
    );
    return response.run;
  },
};
