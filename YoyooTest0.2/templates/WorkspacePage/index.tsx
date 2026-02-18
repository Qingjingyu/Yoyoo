"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import Layout from "@/components/Layout";
import Message from "@/components/Message";
import Question from "@/components/Question";
import Answer from "@/components/Answer";
import TaskCard from "@/components/TaskCard";
import TaskTimeline, { TimelineEvent } from "@/components/TaskTimeline";
import ArtifactCard from "@/components/ArtifactCard";
import { useLocale } from "@/contexts/locale-context";
import {
    getWorkspaceConversation,
} from "@/mocks/workspace";
import {
    appendConversationMessage,
    appendConversationMessageReliable,
    buildConversationTitleFromMessage,
    createConversationMessage,
    fetchConversationMessagesFromServer,
    getCurrentUserId,
    getConversationMessages,
    patchConversationState,
    PersistedConversationMessage,
    readConversationStateMap,
    setConversationMessages,
    streamAssistantReply,
    updateConversationMessage,
    updateConversationMessageStatus,
} from "@/lib/chat-storage";
import { TaskItem } from "@/types/workspace";

type WorkspacePanel = "chat" | "tasks" | "files";

const WorkspacePage = () => {
    const { t } = useLocale();
    const searchParams = useSearchParams();
    const conv = decodeURIComponent(searchParams.get("conv") || "/");
    const [panel, setPanel] = useState<WorkspacePanel>("chat");
    const [message, setMessage] = useState<string>("");
    const [localMessages, setLocalMessages] = useState<
        PersistedConversationMessage[]
    >([]);
    const [backendTasks, setBackendTasks] = useState<TaskItem[]>([]);
    const [backendTimeline, setBackendTimeline] = useState<TimelineEvent[]>([]);
    const [isGenerating, setIsGenerating] = useState(false);
    const abortRef = useRef<AbortController | null>(null);
    const [search, setSearch] = useState<string>("");
    const workspaceData = useMemo(
        () => getWorkspaceConversation(conv),
        [conv]
    );

    const loadBackendTaskCenter = async () => {
        try {
            const userId = getCurrentUserId();
            const response = await fetch(
                `/api/chat/tasks?userId=${encodeURIComponent(
                    userId
                )}&conversationId=${encodeURIComponent(conv)}`,
                { cache: "no-store" }
            );
            if (!response.ok) {
                setBackendTasks([]);
                setBackendTimeline([]);
                return;
            }
            const data = (await response.json()) as {
                ok?: boolean;
                tasks?: TaskItem[];
                timeline?: TimelineEvent[];
            };
            setBackendTasks(Array.isArray(data.tasks) ? data.tasks : []);
            setBackendTimeline(Array.isArray(data.timeline) ? data.timeline : []);
        } catch {
            setBackendTasks([]);
            setBackendTimeline([]);
        }
    };

    useEffect(() => {
        const local = getConversationMessages(conv);
        setLocalMessages(local);
        fetchConversationMessagesFromServer(conv)
            .then((remote) => {
                if (remote.length > 0) {
                    setLocalMessages(remote);
                    setConversationMessages(conv, remote);
                }
            })
            .catch(() => null);
        loadBackendTaskCenter().catch(() => null);
    }, [conv]);

    const mergedMessages = useMemo<PersistedConversationMessage[]>(
        () => [
            ...workspaceData.messages.map((item) => ({
                ...item,
                status: "sent" as const,
            })),
            ...localMessages,
        ],
        [workspaceData.messages, localMessages]
    );

    const handleSend = () => {
        if (isGenerating) return;
        const content = message.trim();
        if (!content) return;

        const userMessage = createConversationMessage("user", content, "sending");
        appendConversationMessage(conv, userMessage);

        const stateMap = readConversationStateMap();
        const currentTitle = stateMap[conv]?.title;
        const defaultTitle = t("rightSidebar.newChat").trim();
        if (!currentTitle || currentTitle.trim() === defaultTitle) {
            patchConversationState(conv, {
                title: buildConversationTitleFromMessage(content),
            });
        }

        patchConversationState(conv, {
            updatedAt: Date.now(),
            deleted: false,
        });
        setLocalMessages((prev) => [...prev, userMessage]);
        setMessage("");
        generateAssistantReply(content);
        appendConversationMessageReliable(conv, {
            ...userMessage,
            status: "sent",
        })
            .then(() => {
                updateConversationMessageStatus(conv, userMessage.id, "sent");
                setLocalMessages((prev) =>
                    prev.map((item) =>
                        item.id === userMessage.id
                            ? { ...item, status: "sent" }
                            : item
                    )
                );
            })
            .catch(() => {
                updateConversationMessageStatus(conv, userMessage.id, "failed");
                setLocalMessages((prev) =>
                    prev.map((item) =>
                        item.id === userMessage.id
                            ? { ...item, status: "failed" }
                            : item
                    )
                );
            });
    };

    const generateAssistantReply = async (prompt: string) => {
        const assistantMessage = createConversationMessage("assistant", "", "sending");
        appendConversationMessage(conv, assistantMessage);
        setLocalMessages((prev) => [...prev, assistantMessage]);
        setIsGenerating(true);
        const controller = new AbortController();
        abortRef.current = controller;
        let streamed = "";

        try {
            await streamAssistantReply({
                conversationId: conv,
                prompt,
                signal: controller.signal,
                onChunk: (chunk) => {
                    streamed += chunk;
                    updateConversationMessage(conv, assistantMessage.id, {
                        content: streamed,
                        status: "sending",
                    });
                    setLocalMessages((prev) =>
                        prev.map((item) =>
                            item.id === assistantMessage.id
                                ? { ...item, content: streamed, status: "sending" }
                                : item
                        )
                    );
                },
            });
        } catch (error) {
            if ((error as Error)?.name !== "AbortError") {
                streamed =
                    streamed || "抱歉，这次生成失败了。请稍后重试或调整问题描述。";
            }
        }

        const finalContent = streamed.trim() || "（已停止生成）";
        updateConversationMessage(conv, assistantMessage.id, {
            content: finalContent,
            status: "sent",
        });
        setLocalMessages((prev) =>
            prev.map((item) =>
                item.id === assistantMessage.id
                    ? { ...item, content: finalContent, status: "sent" }
                    : item
            )
        );
        patchConversationState(conv, {
            updatedAt: Date.now(),
            deleted: false,
        });
        appendConversationMessageReliable(conv, {
            ...assistantMessage,
            content: finalContent,
            status: "sent",
        }).catch(() => null);
        loadBackendTaskCenter().catch(() => null);
        setIsGenerating(false);
        abortRef.current = null;
    };

    const failedCount = useMemo(
        () => mergedMessages.filter((item) => item.status === "failed").length,
        [mergedMessages]
    );

    const retryFailedMessages = () => {
        mergedMessages
            .filter((item) => item.status === "failed")
            .forEach((failedMessage) => retryOneMessage(failedMessage.id));
    };

    const retryOneMessage = (messageId: string) => {
        const failedMessage = mergedMessages.find((item) => item.id === messageId);
        if (!failedMessage || failedMessage.role !== "user") return;
        updateConversationMessageStatus(conv, failedMessage.id, "sending");
        setLocalMessages((prev) =>
            prev.map((item) =>
                item.id === failedMessage.id ? { ...item, status: "sending" } : item
            )
        );
        appendConversationMessageReliable(conv, {
            ...failedMessage,
            status: "sent",
        })
            .then(() => {
                updateConversationMessageStatus(conv, failedMessage.id, "sent");
                setLocalMessages((prev) =>
                    prev.map((item) =>
                        item.id === failedMessage.id
                            ? { ...item, status: "sent" }
                            : item
                    )
                );
            })
            .catch(() => {
                updateConversationMessageStatus(conv, failedMessage.id, "failed");
                setLocalMessages((prev) =>
                    prev.map((item) =>
                        item.id === failedMessage.id
                            ? { ...item, status: "failed" }
                            : item
                    )
                );
            });
    };

    const hasSending = isGenerating;

    const stopGeneration = () => {
        abortRef.current?.abort();
    };

    const activeTasks = backendTasks.length > 0 ? backendTasks : workspaceData.tasks;
    const rootTasks = useMemo(
        () => activeTasks.filter((item) => !item.parentTaskId),
        [activeTasks]
    );
    const childTasks = useMemo(
        () => activeTasks.filter((item) => item.parentTaskId),
        [activeTasks]
    );

    const timelineItems = useMemo<TimelineEvent[]>(
        () => (backendTimeline.length > 0 ? backendTimeline : workspaceData.timeline),
        [backendTimeline, workspaceData.timeline]
    );

    const filteredArtifacts = useMemo(() => {
        const q = search.trim().toLowerCase();
        if (!q) return workspaceData.artifacts;
        return workspaceData.artifacts.filter(
            (item) =>
                item.title.toLowerCase().includes(q) ||
                item.description.toLowerCase().includes(q) ||
                item.version.toLowerCase().includes(q)
        );
    }, [search, workspaceData.artifacts]);

    return (
        <Layout hideRightSidebar>
            <div className="p-8 space-y-6 md:p-4">
                <div>
                    <div className="h3 md:h4">{t("workspace.section.conversation")}</div>
                    {failedCount > 0 && (
                        <button
                            className="mt-3 h-8 px-3 rounded-lg border border-accent-1 text-accent-1 caption1"
                            onClick={retryFailedMessages}
                        >
                            {t("chat.status.retryAll")} ({failedCount})
                        </button>
                    )}
                    {isGenerating && (
                        <button
                            className="mt-3 ml-3 h-8 px-3 rounded-lg border border-primary-1 text-primary-1 caption1"
                            onClick={stopGeneration}
                        >
                            {t("chat.stopGeneration")}
                        </button>
                    )}
                    <div className="mt-3 inline-flex rounded-xl border border-n-3 bg-n-1 p-1 dark:border-n-5 dark:bg-n-7">
                        <button
                            className={`h-9 px-4 rounded-lg base2 transition-colors ${
                                panel === "chat"
                                    ? "bg-primary-1 text-n-1"
                                    : "text-n-4 hover:text-n-1"
                            }`}
                            onClick={() => setPanel("chat")}
                        >
                            {t("workspace.section.conversation")}
                        </button>
                        <button
                            className={`h-9 px-4 rounded-lg base2 transition-colors ${
                                panel === "tasks"
                                    ? "bg-primary-1 text-n-1"
                                    : "text-n-4 hover:text-n-1"
                            }`}
                            onClick={() => setPanel("tasks")}
                        >
                            {t("workspace.section.taskCenter")}
                        </button>
                        <button
                            className={`h-9 px-4 rounded-lg base2 transition-colors ${
                                panel === "files"
                                    ? "bg-primary-1 text-n-1"
                                    : "text-n-4 hover:text-n-1"
                            }`}
                            onClick={() => setPanel("files")}
                        >
                            {t("workspace.section.artifactSearch")}
                        </button>
                    </div>
                </div>

                <section className="rounded-2xl border border-n-3 bg-n-1 dark:bg-n-6 dark:border-n-5">
                    <div className="px-6 py-4 border-b border-n-3 dark:border-n-5">
                        <div className="h6">{t("workspace.section.conversation")}</div>
                    </div>
                    <div className="px-6 py-5 space-y-5 max-h-[24rem] overflow-y-auto scrollbar-none md:px-4">
                        {mergedMessages.map((item) =>
                            item.role === "user" ? (
                                <Question
                                    key={item.id}
                                    content={item.content}
                                    time={item.createdAt}
                                    status={item.status}
                                    statusLabel={
                                        item.status === "sending"
                                            ? t("chat.status.sending")
                                            : item.status === "failed"
                                            ? t("chat.status.failed")
                                            : undefined
                                    }
                                    retryLabel={t("chat.status.retry")}
                                    onRetry={
                                        item.status === "failed"
                                            ? () => retryOneMessage(item.id)
                                            : undefined
                                    }
                                />
                            ) : (
                                <Answer key={item.id} time={item.createdAt}>
                                    {item.content}
                                </Answer>
                            )
                        )}
                        {hasSending && (
                            <div className="max-w-[50rem]">
                                <div className="inline-flex items-center px-4 py-2 rounded-xl border border-primary-1/35 bg-primary-1/10 caption1 text-primary-1">
                                    {t("chat.assistant.typing")}
                                </div>
                            </div>
                        )}
                    </div>
                    <Message
                        value={message}
                        onChange={(e) => setMessage(e.target.value)}
                        placeholder={t("workspace.conversation.placeholder")}
                        onSubmit={handleSend}
                        disabled={isGenerating}
                    />
                </section>

                {panel === "tasks" && (
                    <section className="rounded-2xl border border-n-3 bg-n-1 p-6 dark:bg-n-6 dark:border-n-5 md:p-4">
                        <div className="h6">{t("workspace.section.taskCenter")}</div>
                        <div className="mt-1 caption1 text-n-4">
                            {t("workspace.section.taskCenterHint")}
                        </div>
                        <div className="grid grid-cols-2 gap-4 mt-4 xl:grid-cols-1">
                            <div className="space-y-4">
                                {rootTasks.map((task) => (
                                    <TaskCard
                                        key={task.id}
                                        title={task.title}
                                        owner={task.owner}
                                        status={task.status}
                                        priority={task.priority}
                                        eta={task.eta}
                                        progress={task.progress}
                                        tags={task.tags}
                                        dependencies={
                                            childTasks.filter(
                                                (child) =>
                                                    child.parentTaskId === task.id
                                            ).length
                                        }
                                        updatedAt={task.updatedAt}
                                    />
                                ))}
                            </div>
                            <TaskTimeline items={timelineItems} />
                        </div>
                    </section>
                )}

                {panel === "files" && (
                    <section className="rounded-2xl border border-n-3 bg-n-1 p-6 dark:bg-n-6 dark:border-n-5 md:p-4">
                        <div className="flex items-center gap-3 mb-4 md:block">
                            <div>
                                <div className="h6">
                                    {t("workspace.section.artifactSearch")}
                                </div>
                                <div className="mt-1 caption1 text-n-4">
                                    {t("workspace.section.artifactSearchHint")}
                                </div>
                            </div>
                            <div className="relative ml-auto w-[22rem] md:mt-3 md:w-full">
                                <input
                                    className="w-full h-11 pl-4 pr-4 rounded-xl border border-n-3 bg-transparent base2 outline-none text-n-7 focus:border-primary-1 dark:border-n-5 dark:text-n-1"
                                    placeholder={t("workspace.search.placeholder")}
                                    value={search}
                                    onChange={(event) =>
                                        setSearch(event.target.value)
                                    }
                                />
                            </div>
                        </div>
                        <div className="grid grid-cols-2 gap-4 xl:grid-cols-1">
                            {filteredArtifacts.map((item) => (
                                <ArtifactCard
                                    key={item.id}
                                    type={item.type}
                                    title={item.title}
                                    description={item.description}
                                    version={item.version}
                                    fromTask={item.fromTaskId}
                                    updatedAt={item.updatedAt}
                                    previewUrl={item.previewUrl}
                                    sourceUrl={item.sourceUrl}
                                    codeSnippet={item.codeSnippet}
                                />
                            ))}
                        </div>
                    </section>
                )}
            </div>
        </Layout>
    );
};

export default WorkspacePage;
