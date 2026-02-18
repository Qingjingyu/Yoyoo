import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import Message from "@/components/Message";
import Question from "@/components/Question";
import Answer from "@/components/Answer";
import { useLocale } from "@/contexts/locale-context";
import { getWorkspaceConversation } from "@/mocks/workspace";
import {
    appendConversationMessage,
    appendConversationMessageReliable,
    buildConversationTitleFromMessage,
    createConversationMessage,
    fetchConversationMessagesFromServer,
    getConversationMessages,
    patchConversationState,
    PersistedConversationMessage,
    readConversationStateMap,
    setConversationMessages,
    streamAssistantReply,
    updateConversationMessage,
    updateConversationMessageStatus,
} from "@/lib/chat-storage";

type MainProps = {};

const Main = ({}: MainProps) => {
    const searchParams = useSearchParams();
    const [message, setMessage] = useState<string>("");
    const [localMessages, setLocalMessages] = useState<
        PersistedConversationMessage[]
    >([]);
    const [isGenerating, setIsGenerating] = useState(false);
    const abortRef = useRef<AbortController | null>(null);
    const { t } = useLocale();
    const conv = decodeURIComponent(searchParams.get("conv") || "/");

    const workspaceData = useMemo(
        () => getWorkspaceConversation(conv),
        [conv]
    );

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

    return (
        <>
            <div className="flex items-center min-h-[4.5rem] px-10 py-3 border-b border-n-3 shadow-[0_0.75rem_2.5rem_-0.75rem_rgba(0,0,0,0.06)] 2xl:px-6 md:pl-5 md:pr-6 dark:border-n-5 dark:shadow-[0_0.75rem_2.5rem_-0.75rem_rgba(0,0,0,0.15)]">
                <div className="mr-auto h5 truncate md:h6">
                    {t("workspace.section.conversation")}
                </div>
                {failedCount > 0 && (
                    <button
                        className="ml-3 h-8 px-3 rounded-lg border border-accent-1 text-accent-1 caption1"
                        onClick={retryFailedMessages}
                    >
                        {t("chat.status.retryAll")} ({failedCount})
                    </button>
                )}
                {isGenerating && (
                    <button
                        className="ml-3 h-8 px-3 rounded-lg border border-primary-1 text-primary-1 caption1"
                        onClick={stopGeneration}
                    >
                        {t("chat.stopGeneration")}
                    </button>
                )}
            </div>

            <div className="relative z-2 grow p-10 space-y-10 overflow-y-auto scroll-smooth scrollbar-none 2xl:p-6 md:p-5">
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
                onChange={(e: any) => setMessage(e.target.value)}
                placeholder={t("workspace.conversation.placeholder")}
                onSubmit={handleSend}
                disabled={isGenerating}
            />
        </>
    );
};

export default Main;
