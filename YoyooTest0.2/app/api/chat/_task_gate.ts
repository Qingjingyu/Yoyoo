import { promises as fs } from "fs";
import path from "path";

type RunningTask = {
    ticketId: string;
    userId: string;
    conversationId: string;
    prompt: string;
    startedAt: string;
};

type QueuedTask = {
    ticketId: string;
    userId: string;
    conversationId: string;
    prompt: string;
    queuedAt: string;
};

type TaskGateStore = {
    running: Record<string, RunningTask>;
    queue: QueuedTask[];
};

type ExecutionRequestResult =
    | {
          mode: "running";
          ticketId: string;
      }
    | {
          mode: "queued";
          ticketId: string;
          position: number;
      }
    | {
          mode: "rejected";
          reason: string;
      };

type PromoteResult =
    | {
          mode: "running";
          ticketId: string;
          prompt: string;
      }
    | {
          mode: "queued";
          position: number;
      }
    | {
          mode: "none";
      };

const DATA_DIR = path.join(process.cwd(), ".yoyoo-data");
const STORE_FILE = path.join(DATA_DIR, "task-gate.json");

const MAX_RUNNING_PER_USER = Number.parseInt(
    process.env.YOYOO_CTO_MAX_RUNNING_PER_USER || "2",
    10
);
const MAX_RUNNING_GLOBAL = Number.parseInt(
    process.env.YOYOO_CTO_MAX_RUNNING_GLOBAL || "4",
    10
);
const MAX_QUEUE_PER_USER = Number.parseInt(
    process.env.YOYOO_CTO_MAX_QUEUE_PER_USER || "8",
    10
);
const RUNNING_TTL_MS = Number.parseInt(
    process.env.YOYOO_CTO_RUNNING_TTL_MS || `${20 * 60 * 1000}`,
    10
);

const emptyStore = (): TaskGateStore => ({
    running: {},
    queue: [],
});

const ensureDataDir = async () => {
    await fs.mkdir(DATA_DIR, { recursive: true });
};

const readStore = async (): Promise<TaskGateStore> => {
    await ensureDataDir();
    try {
        const raw = await fs.readFile(STORE_FILE, "utf-8");
        const parsed = JSON.parse(raw) as TaskGateStore;
        if (!parsed || typeof parsed !== "object") return emptyStore();
        return {
            running: parsed.running ?? {},
            queue: Array.isArray(parsed.queue) ? parsed.queue : [],
        };
    } catch {
        return emptyStore();
    }
};

let writeChain: Promise<void> = Promise.resolve();

const writeStore = async (store: TaskGateStore) => {
    await ensureDataDir();
    await fs.writeFile(STORE_FILE, JSON.stringify(store, null, 2), "utf-8");
};

const mutateStore = async <T>(mutator: (store: TaskGateStore) => T | Promise<T>) => {
    let result: T | undefined;
    writeChain = writeChain.then(async () => {
        const store = await readStore();
        result = await mutator(store);
        await writeStore(store);
    });
    await writeChain;
    return result as T;
};

const makeTicketId = () =>
    `gate_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

const cleanupExpiredRunning = (store: TaskGateStore) => {
    const now = Date.now();
    Object.entries(store.running).forEach(([ticketId, item]) => {
        const startedAt = new Date(item.startedAt).getTime();
        if (!Number.isFinite(startedAt)) {
            delete store.running[ticketId];
            return;
        }
        if (now - startedAt > Math.max(RUNNING_TTL_MS, 60_000)) {
            delete store.running[ticketId];
        }
    });
};

const countRunningForUser = (store: TaskGateStore, userId: string) =>
    Object.values(store.running).filter((item) => item.userId === userId).length;

const hasRunningCapacity = (store: TaskGateStore, userId: string) =>
    countRunningForUser(store, userId) < Math.max(MAX_RUNNING_PER_USER, 1) &&
    Object.keys(store.running).length < Math.max(MAX_RUNNING_GLOBAL, 1);

const queueCountForUser = (store: TaskGateStore, userId: string) =>
    store.queue.filter((item) => item.userId === userId).length;

export const requestExecutionSlot = async ({
    userId,
    conversationId,
    prompt,
}: {
    userId: string;
    conversationId: string;
    prompt: string;
}): Promise<ExecutionRequestResult> =>
    mutateStore((store) => {
        cleanupExpiredRunning(store);

        const existingRunning = Object.values(store.running).find(
            (item) => item.userId === userId && item.conversationId === conversationId
        );
        if (existingRunning) {
            return { mode: "running", ticketId: existingRunning.ticketId } as const;
        }

        const existingQueueIndex = store.queue.findIndex(
            (item) => item.userId === userId && item.conversationId === conversationId
        );
        if (existingQueueIndex >= 0) {
            const existing = store.queue[existingQueueIndex];
            store.queue[existingQueueIndex] = {
                ...existing,
                prompt,
            };
            return {
                mode: "queued",
                ticketId: existing.ticketId,
                position: existingQueueIndex + 1,
            } as const;
        }

        if (hasRunningCapacity(store, userId) && store.queue.length === 0) {
            const ticketId = makeTicketId();
            store.running[ticketId] = {
                ticketId,
                userId,
                conversationId,
                prompt,
                startedAt: new Date().toISOString(),
            };
            return { mode: "running", ticketId } as const;
        }

        if (queueCountForUser(store, userId) >= Math.max(MAX_QUEUE_PER_USER, 1)) {
            return {
                mode: "rejected",
                reason: "queue_limit_reached",
            } as const;
        }

        const ticketId = makeTicketId();
        store.queue.push({
            ticketId,
            userId,
            conversationId,
            prompt,
            queuedAt: new Date().toISOString(),
        });
        return {
            mode: "queued",
            ticketId,
            position: store.queue.length,
        } as const;
    });

export const promoteQueuedTaskForConversation = async ({
    userId,
    conversationId,
}: {
    userId: string;
    conversationId: string;
}): Promise<PromoteResult> =>
    mutateStore((store) => {
        cleanupExpiredRunning(store);
        const idx = store.queue.findIndex(
            (item) => item.userId === userId && item.conversationId === conversationId
        );
        if (idx < 0) return { mode: "none" } as const;
        if (idx > 0 || !hasRunningCapacity(store, userId)) {
            return { mode: "queued", position: idx + 1 } as const;
        }

        const next = store.queue.shift();
        if (!next) return { mode: "none" } as const;
        store.running[next.ticketId] = {
            ticketId: next.ticketId,
            userId: next.userId,
            conversationId: next.conversationId,
            prompt: next.prompt,
            startedAt: new Date().toISOString(),
        };
        return {
            mode: "running",
            ticketId: next.ticketId,
            prompt: next.prompt,
        } as const;
    });

export const cancelQueuedTaskForConversation = async ({
    userId,
    conversationId,
}: {
    userId: string;
    conversationId: string;
}) =>
    mutateStore((store) => {
        const before = store.queue.length;
        store.queue = store.queue.filter(
            (item) => !(item.userId === userId && item.conversationId === conversationId)
        );
        return before !== store.queue.length;
    });

export const getQueuePositionForConversation = async ({
    userId,
    conversationId,
}: {
    userId: string;
    conversationId: string;
}) =>
    mutateStore((store) => {
        cleanupExpiredRunning(store);
        const idx = store.queue.findIndex(
            (item) => item.userId === userId && item.conversationId === conversationId
        );
        if (idx < 0) return null;
        return idx + 1;
    });

export const finishExecutionTicket = async (ticketId: string) => {
    await mutateStore((store) => {
        delete store.running[ticketId];
        cleanupExpiredRunning(store);
    });
};
