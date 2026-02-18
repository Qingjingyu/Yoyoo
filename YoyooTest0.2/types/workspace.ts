export type ConversationRole = "user" | "yoyoo" | "system";

export type ConversationMessageType = "text" | "voice" | "file";

export type ConversationMessage = {
    id: string;
    role: ConversationRole;
    type: ConversationMessageType;
    content: string;
    createdAt: string;
    conversationId: string;
    attachments?: string[];
};

export type TaskStatus =
    | "todo"
    | "in_progress"
    | "blocked"
    | "review"
    | "done";

export type TaskPriority = "low" | "medium" | "high" | "urgent";

export type TaskItem = {
    id: string;
    title: string;
    owner: string;
    status: TaskStatus;
    priority: TaskPriority;
    progress: number;
    eta: string;
    updatedAt: string;
    conversationId: string;
    parentTaskId?: string;
    tags?: string[];
};

export type ArtifactType =
    | "code"
    | "image"
    | "audio"
    | "video"
    | "document"
    | "webpage";

export type ArtifactItem = {
    id: string;
    title: string;
    type: ArtifactType;
    description: string;
    version: string;
    updatedAt: string;
    fromTaskId: string;
    sourceUrl?: string;
    previewUrl?: string;
    codeSnippet?: string;
};

