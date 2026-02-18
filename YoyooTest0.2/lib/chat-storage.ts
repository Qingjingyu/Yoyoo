import {
    PersistedConversationMessage,
    PersistedConversationState,
    PersistedMessageRole,
    PersistedMessageStatus,
} from "@/lib/chat-types";
export type {
    PersistedConversationMessage,
    PersistedConversationState,
    PersistedMessageRole,
    PersistedMessageStatus,
} from "@/lib/chat-types";

export const CHAT_STATE_STORAGE_KEY = "yoyoo.chatList.state.v1";
const CHAT_MESSAGES_STORAGE_KEY = "yoyoo.chat.messages.v1";
const CHAT_USER_STORAGE_KEY = "yoyoo.chat.user.v1";
export const CHAT_STATE_PATCHED_EVENT = "yoyoo:chat-state-patched";

const API_BASE = "/api/chat";

const canUseStorage = () => typeof window !== "undefined";

const safeParse = <T>(raw: string | null, fallback: T): T => {
    if (!raw) return fallback;
    try {
        const parsed = JSON.parse(raw);
        return (parsed ?? fallback) as T;
    } catch {
        return fallback;
    }
};

export const readConversationStateMap = (): Record<
    string,
    PersistedConversationState
> => {
    if (!canUseStorage()) return {};
    return safeParse<Record<string, PersistedConversationState>>(
        window.localStorage.getItem(CHAT_STATE_STORAGE_KEY),
        {}
    );
};

export const writeConversationStateMap = (
    state: Record<string, PersistedConversationState>
) => {
    if (!canUseStorage()) return;
    window.localStorage.setItem(CHAT_STATE_STORAGE_KEY, JSON.stringify(state));
};

export const patchConversationState = (
    url: string,
    patch: Partial<PersistedConversationState>
) => {
    if (!url) return;
    const state = readConversationStateMap();
    writeConversationStateMap({
        ...state,
        [url]: {
            ...(state[url] ?? {}),
            ...patch,
        },
    });
    if (canUseStorage()) {
        window.dispatchEvent(
            new CustomEvent(CHAT_STATE_PATCHED_EVENT, {
                detail: { conversationId: url },
            })
        );
    }
};

export const createConversationUrl = () =>
    `conv_${Date.now().toString(36)}_${Math.random()
        .toString(36)
        .slice(2, 7)}`;

export const buildConversationTitleFromMessage = (
    content: string,
    maxLength = 18
) => {
    const normalized = content.replace(/\s+/g, " ").trim();
    if (!normalized) return "";
    if (normalized.length <= maxLength) return normalized;
    return `${normalized.slice(0, maxLength)}...`;
};

const readMessageMap = (): Record<string, PersistedConversationMessage[]> => {
    if (!canUseStorage()) return {};
    return safeParse<Record<string, PersistedConversationMessage[]>>(
        window.localStorage.getItem(CHAT_MESSAGES_STORAGE_KEY),
        {}
    );
};

const writeMessageMap = (map: Record<string, PersistedConversationMessage[]>) => {
    if (!canUseStorage()) return;
    window.localStorage.setItem(CHAT_MESSAGES_STORAGE_KEY, JSON.stringify(map));
};

export const getConversationMessages = (url: string) => {
    const map = readMessageMap();
    return map[url] ?? [];
};

export const appendConversationMessage = (
    url: string,
    message: PersistedConversationMessage
) => {
    const map = readMessageMap();
    const next = [...(map[url] ?? []), message];
    writeMessageMap({
        ...map,
        [url]: next,
    });
    return message;
};

export const setConversationMessages = (
    url: string,
    messages: PersistedConversationMessage[]
) => {
    const map = readMessageMap();
    writeMessageMap({
        ...map,
        [url]: messages,
    });
};

export const updateConversationMessageStatus = (
    url: string,
    messageId: string,
    status: PersistedMessageStatus
) => {
    const map = readMessageMap();
    const next = (map[url] ?? []).map((item) =>
        item.id === messageId ? { ...item, status } : item
    );
    writeMessageMap({
        ...map,
        [url]: next,
    });
};

export const updateConversationMessage = (
    url: string,
    messageId: string,
    patch: Partial<PersistedConversationMessage>
) => {
    const map = readMessageMap();
    const next = (map[url] ?? []).map((item) =>
        item.id === messageId ? { ...item, ...patch } : item
    );
    writeMessageMap({
        ...map,
        [url]: next,
    });
};

export const removeConversationMessages = (url: string) => {
    const map = readMessageMap();
    if (!(url in map)) return;
    delete map[url];
    writeMessageMap(map);
};

export const formatMessageTime = (date = new Date()) =>
    `${date.getHours().toString().padStart(2, "0")}:${date
        .getMinutes()
        .toString()
        .padStart(2, "0")}`;

export const createConversationMessage = (
    role: PersistedMessageRole,
    content: string,
    status: PersistedMessageStatus = "sent"
): PersistedConversationMessage => ({
    id: `msg-${Date.now().toString(36)}-${Math.random()
        .toString(36)
        .slice(2, 7)}`,
    role,
    content,
    createdAt: formatMessageTime(),
    status,
});

const generateUserId = () =>
    `u_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

export const getCurrentUserId = () => {
    if (!canUseStorage()) return "anonymous";
    const existing = window.localStorage.getItem(CHAT_USER_STORAGE_KEY);
    if (existing) return existing;
    const next = generateUserId();
    window.localStorage.setItem(CHAT_USER_STORAGE_KEY, next);
    return next;
};

const safeFetchJson = async <T>(
    input: RequestInfo | URL,
    init?: RequestInit,
    fallback?: T
) => {
    try {
        const response = await fetch(input, init);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return (await response.json()) as T;
    } catch (error) {
        if (fallback !== undefined) return fallback;
        throw error;
    }
};

export const fetchConversationStateMapFromServer = async () => {
    const userId = getCurrentUserId();
    const result = await safeFetchJson<{
        ok: boolean;
        state: Record<string, PersistedConversationState>;
    }>(`${API_BASE}/state?userId=${encodeURIComponent(userId)}`, undefined, {
        ok: true,
        state: {},
    });
    return result.state ?? {};
};

export const persistConversationStateMapToServer = async (
    state: Record<string, PersistedConversationState>
) => {
    const userId = getCurrentUserId();
    await safeFetchJson(
        `${API_BASE}/state`,
        {
            method: "PUT",
            headers: {
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                userId,
                state,
            }),
        },
        { ok: false }
    );
};

export const fetchConversationMessagesFromServer = async (
    conversationId: string
) => {
    const userId = getCurrentUserId();
    const result = await safeFetchJson<{
        ok: boolean;
        messages: PersistedConversationMessage[];
    }>(
        `${API_BASE}/messages?userId=${encodeURIComponent(
            userId
        )}&conversationId=${encodeURIComponent(conversationId)}`,
        undefined,
        {
            ok: true,
            messages: [],
        }
    );
    return result.messages ?? [];
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export const appendConversationMessageReliable = async (
    conversationId: string,
    message: PersistedConversationMessage,
    retries = 3
) => {
    const userId = getCurrentUserId();
    let lastError: unknown;
    for (let attempt = 1; attempt <= retries; attempt += 1) {
        try {
            const result = await safeFetchJson<{
                ok: boolean;
                message: PersistedConversationMessage;
            }>(`${API_BASE}/messages`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({
                    userId,
                    conversationId,
                    dedupeKey: message.id,
                    message,
                }),
            });
            return result.message;
        } catch (error) {
            lastError = error;
            if (attempt < retries) {
                await sleep(250 * attempt);
            }
        }
    }
    throw lastError ?? new Error("appendConversationMessageReliable failed");
};

export const removeConversationMessagesFromServer = async (
    conversationId: string
) => {
    const userId = getCurrentUserId();
    await safeFetchJson(
        `${API_BASE}/messages?userId=${encodeURIComponent(
            userId
        )}&conversationId=${encodeURIComponent(conversationId)}`,
        { method: "DELETE" },
        { ok: false }
    );
};

type StreamAssistantReplyParams = {
    conversationId: string;
    prompt: string;
    signal?: AbortSignal;
    onChunk: (chunk: string) => void;
};

export const streamAssistantReply = async ({
    conversationId,
    prompt,
    signal,
    onChunk,
}: StreamAssistantReplyParams) => {
    const userId = getCurrentUserId();
    const response = await fetch(`${API_BASE}/stream`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
        },
        body: JSON.stringify({
            userId,
            conversationId,
            prompt,
        }),
        signal,
    });

    if (!response.ok || !response.body) {
        throw new Error(`stream failed: ${response.status}`);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();

    while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) {
            const chunk = decoder.decode(value, { stream: true });
            if (chunk) onChunk(chunk);
        }
    }

    const tail = decoder.decode();
    if (tail) onChunk(tail);
};
