import type { Role } from "./identity";
import type { ChatType, GroupSessionScope, MemoryBridgeMode } from "./session";

export type MemoryBackendKind = "local" | "memu" | "letta";

export interface BuildMemoryNamespaceInput {
  channel?: string;
  chatType: ChatType;
  conversationId: string;
  senderId: string;
  role: Role;
  memoryBridgeMode?: MemoryBridgeMode;
  groupSessionScope?: GroupSessionScope;
}

export interface MemoryRecord {
  id: string;
  text: string;
  createdAt: number;
}

export interface MemoryBackend {
  kind: string;
  available?: () => boolean | Promise<boolean>;
  append: (namespace: string, text: string) => Promise<MemoryRecord>;
  list: (namespace: string, limit?: number) => Promise<MemoryRecord[]>;
}

export interface CreateMemoryServiceInput {
  backend: string;
  adapters: Record<string, MemoryBackend>;
  fallbackBackend?: string;
}

export interface MemoryService {
  backendKind: () => string;
  append: (namespace: string, text: string) => Promise<MemoryRecord>;
  list: (namespace: string, limit?: number) => Promise<MemoryRecord[]>;
}

export interface CreateHttpJsonMemoryBackendInput {
  kind: MemoryBackendKind | string;
  baseUrl: string;
  appendPath?: string;
  listPath?: string;
  healthPath?: string;
  token?: string;
  headers?: Record<string, string>;
  namespaceField?: string;
  textField?: string;
  limitField?: string;
  fetcher?: typeof fetch;
}

export function buildMemoryNamespace(input: BuildMemoryNamespaceInput): string {
  const senderId = input.senderId.trim();
  const conversationId = input.conversationId.trim();
  const channel = (input.channel ?? "").trim().toLowerCase();
  const bridgeMode = input.memoryBridgeMode ?? "isolated";
  const groupScope = input.groupSessionScope ?? "per-user";

  if (input.role === "admin") {
    return `admin:${senderId}`;
  }

  if (bridgeMode === "user-global") {
    return `user:${senderId}`;
  }

  if (input.chatType === "direct") {
    if (channel) {
      return `direct:${channel}:${senderId}`;
    }
    return `direct:${senderId}`;
  }

  if (groupScope === "per-user") {
    if (channel) {
      return `group:${channel}:${conversationId}:user:${senderId}`;
    }
    return `group:${conversationId}:user:${senderId}`;
  }

  if (channel) {
    return `group:${channel}:${conversationId}`;
  }
  return `group:${conversationId}`;
}

export function createInMemoryMemoryBackend(kind: string): MemoryBackend {
  const memory = new Map<string, MemoryRecord[]>();
  let seq = 0;

  return {
    kind,
    available: () => true,
    async append(namespace: string, text: string): Promise<MemoryRecord> {
      const list = memory.get(namespace) ?? [];
      const record: MemoryRecord = {
        id: `${kind}-${Date.now()}-${seq}`,
        text,
        createdAt: Date.now(),
      };
      seq += 1;
      list.push(record);
      memory.set(namespace, list);
      return record;
    },
    async list(namespace: string, limit?: number): Promise<MemoryRecord[]> {
      const list = memory.get(namespace) ?? [];
      if (!limit || limit <= 0 || limit >= list.length) {
        return [...list];
      }
      return list.slice(list.length - limit);
    },
  };
}

function normalizeBaseUrl(raw: string): string {
  return raw.endsWith("/") ? raw.slice(0, -1) : raw;
}

function joinUrl(baseUrl: string, path: string): string {
  const normalizedBase = normalizeBaseUrl(baseUrl);
  if (!path) {
    return normalizedBase;
  }
  if (path.startsWith("/")) {
    return `${normalizedBase}${path}`;
  }
  return `${normalizedBase}/${path}`;
}

function toMemoryRecord(raw: unknown, fallbackId: string): MemoryRecord {
  if (!raw || typeof raw !== "object") {
    return {
      id: fallbackId,
      text: String(raw ?? ""),
      createdAt: Date.now(),
    };
  }
  const obj = raw as Record<string, unknown>;
  return {
    id: String(obj.id ?? fallbackId),
    text: String(obj.text ?? obj.content ?? obj.message ?? ""),
    createdAt:
      typeof obj.createdAt === "number"
        ? obj.createdAt
        : typeof obj.timestamp === "number"
          ? obj.timestamp
          : Date.now(),
  };
}

function extractListRecords(payload: unknown): MemoryRecord[] {
  if (Array.isArray(payload)) {
    return payload.map((item, idx) => toMemoryRecord(item, `list-${Date.now()}-${idx}`));
  }

  if (payload && typeof payload === "object") {
    const obj = payload as Record<string, unknown>;
    const rawList =
      (Array.isArray(obj.items) && obj.items) ||
      (Array.isArray(obj.records) && obj.records) ||
      (Array.isArray(obj.data) && obj.data) ||
      [];
    return rawList.map((item, idx) => toMemoryRecord(item, `list-${Date.now()}-${idx}`));
  }

  return [];
}

export function createHttpJsonMemoryBackend(
  input: CreateHttpJsonMemoryBackendInput,
): MemoryBackend {
  const fetcher = input.fetcher ?? fetch;
  const appendPath = input.appendPath ?? "/memory/append";
  const listPath = input.listPath ?? "/memory/list";
  const namespaceField = input.namespaceField ?? "namespace";
  const textField = input.textField ?? "text";
  const limitField = input.limitField ?? "limit";

  const baseHeaders: Record<string, string> = {
    "content-type": "application/json",
    ...(input.headers ?? {}),
  };
  if (input.token && !baseHeaders.authorization) {
    baseHeaders.authorization = `Bearer ${input.token}`;
  }

  async function postJson(path: string, payload: Record<string, unknown>) {
    const res = await fetcher(joinUrl(input.baseUrl, path), {
      method: "POST",
      headers: baseHeaders,
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      throw new Error(`memory backend ${input.kind} request failed`);
    }
    return res.json();
  }

  return {
    kind: input.kind,
    async available() {
      if (!input.healthPath) {
        return true;
      }
      try {
        const res = await fetcher(joinUrl(input.baseUrl, input.healthPath), {
          method: "GET",
          headers: baseHeaders,
        });
        return res.ok;
      } catch {
        return false;
      }
    },
    async append(namespace: string, text: string): Promise<MemoryRecord> {
      const payload = await postJson(appendPath, {
        [namespaceField]: namespace,
        [textField]: text,
      });
      return toMemoryRecord(payload, `${input.kind}-${Date.now()}`);
    },
    async list(namespace: string, limit?: number): Promise<MemoryRecord[]> {
      const payload = await postJson(listPath, {
        [namespaceField]: namespace,
        [limitField]: limit,
      });
      return extractListRecords(payload);
    },
  };
}

export function createMemoryService(input: CreateMemoryServiceInput): MemoryService {
  const fallbackKey = input.fallbackBackend ?? "local";
  const primary = input.adapters[input.backend];
  const fallback = input.adapters[fallbackKey];
  const emergency = createInMemoryMemoryBackend("local");

  const selected = primary ?? fallback ?? Object.values(input.adapters)[0] ?? emergency;
  const selectedKind = selected.kind;

  async function isBackendAvailable(backend: MemoryBackend): Promise<boolean> {
    try {
      return (await backend.available?.()) ?? true;
    } catch {
      return false;
    }
  }

  async function callWithFallback<T>(
    call: (backend: MemoryBackend) => Promise<T>,
  ): Promise<T> {
    const canUsePrimary = !!primary && (await isBackendAvailable(primary));
    if (canUsePrimary && primary) {
      try {
        return await call(primary);
      } catch {
        // Try fallback on runtime failure.
      }
    }

    const backup = fallback ?? (primary ? emergency : selected);
    const canUseBackup = await isBackendAvailable(backup);
    if (canUseBackup) {
      return call(backup);
    }

    return call(emergency);
  }

  return {
    backendKind() {
      return selectedKind;
    },
    async append(namespace: string, text: string) {
      return callWithFallback((backend) => backend.append(namespace, text));
    },
    async list(namespace: string, limit?: number) {
      return callWithFallback((backend) => backend.list(namespace, limit));
    },
  };
}
