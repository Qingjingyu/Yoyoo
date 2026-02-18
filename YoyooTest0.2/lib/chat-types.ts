export type PersistedConversationState = {
    title?: string;
    pinned?: boolean;
    updatedAt?: number;
    deleted?: boolean;
};

export type PersistedMessageStatus = "sending" | "sent" | "failed";

export type PersistedMessageRole = "user" | "assistant" | "yoyoo" | "system";

export type PersistedConversationMessage = {
    id: string;
    role: PersistedMessageRole;
    content: string;
    createdAt: string;
    status?: PersistedMessageStatus;
};
