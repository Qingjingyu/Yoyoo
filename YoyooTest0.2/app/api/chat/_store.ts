import { promises as fs } from "fs";
import path from "path";
import {
    PersistedConversationMessage,
    PersistedConversationState,
} from "@/lib/chat-types";

type UserChatStore = {
    state: Record<string, PersistedConversationState>;
    messages: Record<string, PersistedConversationMessage[]>;
    dedupe: Record<string, Record<string, string>>;
    pendingIntents: Record<
        string,
        {
            prompt: string;
            suggestedExecutor: string;
            createdAt: string;
        }
    >;
};

type ChatStore = {
    users: Record<string, UserChatStore>;
};

const DATA_DIR = path.join(process.cwd(), ".yoyoo-data");
const STORE_FILE = path.join(DATA_DIR, "chat-store.json");

const emptyUserStore = (): UserChatStore => ({
    state: {},
    messages: {},
    dedupe: {},
    pendingIntents: {},
});

const emptyStore = (): ChatStore => ({
    users: {},
});

const normalizeUserStore = (input?: Partial<UserChatStore>): UserChatStore => ({
    state: input?.state ?? {},
    messages: input?.messages ?? {},
    dedupe: input?.dedupe ?? {},
    pendingIntents: input?.pendingIntents ?? {},
});

const ensureDataDir = async () => {
    await fs.mkdir(DATA_DIR, { recursive: true });
};

const readStore = async (): Promise<ChatStore> => {
    await ensureDataDir();
    try {
        const raw = await fs.readFile(STORE_FILE, "utf-8");
        const parsed = JSON.parse(raw) as ChatStore;
        if (!parsed?.users || typeof parsed.users !== "object") {
            return emptyStore();
        }
        return parsed;
    } catch {
        return emptyStore();
    }
};

let writeChain: Promise<void> = Promise.resolve();

const writeStore = async (store: ChatStore) => {
    await ensureDataDir();
    await fs.writeFile(STORE_FILE, JSON.stringify(store, null, 2), "utf-8");
};

const queueWrite = async (mutator: (store: ChatStore) => void) => {
    let snapshot: ChatStore | null = null;
    writeChain = writeChain.then(async () => {
        const current = await readStore();
        mutator(current);
        await writeStore(current);
        snapshot = current;
    });
    await writeChain;
    return snapshot ?? emptyStore();
};

export const getUserStore = async (userId: string): Promise<UserChatStore> => {
    const store = await readStore();
    return normalizeUserStore(store.users[userId]);
};

export const setUserState = async (
    userId: string,
    state: Record<string, PersistedConversationState>
) => {
    await queueWrite((store) => {
        const user = store.users[userId] ?? emptyUserStore();
        user.state = state;
        store.users[userId] = user;
    });
};

export const getUserMessages = async (userId: string, conversationId: string) => {
    const user = await getUserStore(userId);
    return user.messages[conversationId] ?? [];
};

export const appendUserMessage = async (
    userId: string,
    conversationId: string,
    message: PersistedConversationMessage,
    dedupeKey?: string
) => {
    let appended: PersistedConversationMessage = message;
    await queueWrite((store) => {
        const user = store.users[userId] ?? emptyUserStore();
        const bucket = user.messages[conversationId] ?? [];
        const dedupeMap = user.dedupe[conversationId] ?? {};

        if (dedupeKey && dedupeMap[dedupeKey]) {
            const existing = bucket.find((item) => item.id === dedupeMap[dedupeKey]);
            if (existing) {
                appended = existing;
                user.messages[conversationId] = bucket;
                user.dedupe[conversationId] = dedupeMap;
                store.users[userId] = user;
                return;
            }
        }

        bucket.push(message);
        if (dedupeKey) {
            dedupeMap[dedupeKey] = message.id;
        }
        user.messages[conversationId] = bucket;
        user.dedupe[conversationId] = dedupeMap;
        store.users[userId] = user;
        appended = message;
    });
    return appended;
};

export const removeUserMessages = async (userId: string, conversationId: string) => {
    await queueWrite((store) => {
        const user = normalizeUserStore(store.users[userId]);
        delete user.messages[conversationId];
        delete user.dedupe[conversationId];
        delete user.pendingIntents[conversationId];
        store.users[userId] = user;
    });
};

export const getPendingIntent = async (userId: string, conversationId: string) => {
    const user = await getUserStore(userId);
    return user.pendingIntents[conversationId] ?? null;
};

export const setPendingIntent = async (
    userId: string,
    conversationId: string,
    intent: {
        prompt: string;
        suggestedExecutor?: string;
        createdAt?: string;
    }
) => {
    await queueWrite((store) => {
        const user = normalizeUserStore(store.users[userId]);
        user.pendingIntents[conversationId] = {
            prompt: intent.prompt,
            suggestedExecutor: intent.suggestedExecutor ?? "CTO",
            createdAt: intent.createdAt ?? new Date().toISOString(),
        };
        store.users[userId] = user;
    });
};

export const clearPendingIntent = async (userId: string, conversationId: string) => {
    await queueWrite((store) => {
        const user = normalizeUserStore(store.users[userId]);
        delete user.pendingIntents[conversationId];
        store.users[userId] = user;
    });
};
