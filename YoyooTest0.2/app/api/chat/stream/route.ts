import { NextRequest } from "next/server";
import {
    cancelQueuedTaskForConversation,
    finishExecutionTicket,
    getQueuePositionForConversation,
    promoteQueuedTaskForConversation,
    requestExecutionSlot,
} from "../_task_gate";
import { clearPendingIntent, getPendingIntent, setPendingIntent } from "../_store";

export const runtime = "nodejs";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const POLL_INTERVAL_MS = Number.parseInt(
    process.env.YOYOO_TASK_POLL_INTERVAL_MS || "2000",
    10
);
const POLL_TIMEOUT_MS = Number.parseInt(
    process.env.YOYOO_TASK_TIMEOUT_MS || "600000",
    10
);
const INITIAL_REPORT_WINDOW_MS = Number.parseInt(
    process.env.YOYOO_INITIAL_REPORT_WINDOW_MS || "18000",
    10
);
const BACKEND_TIMEOUT_MS = Number.parseInt(
    process.env.YOYOO_BACKEND_TIMEOUT_MS || "600000",
    10
);
const BACKEND_HEALTH_TIMEOUT_MS = Number.parseInt(
    process.env.YOYOO_BACKEND_HEALTH_TIMEOUT_MS || "3000",
    10
);
const TASK_DISPATCH_MODE = (
    process.env.YOYOO_TASK_DISPATCH_MODE || "confirm"
).toLowerCase();
const BACKEND_BASE_URL = (
    process.env.YOYOO_BACKEND_BASE_URL || "http://127.0.0.1:8000"
).replace(/\/+$/, "");

type CreateTaskResponse = {
    ok: boolean;
    task_id: string;
    reply?: string;
    status?: string;
};

type TimelineEvent = {
    timestamp?: string;
    actor?: string;
    event?: string;
    detail?: string;
    role?: string;
    stage?: string;
};

type TaskDetailResponse = {
    task_id: string;
    status: string;
    timeline?: TimelineEvent[];
};

type TaskRunAsyncResponse = {
    ok: boolean;
    task_id: string;
    accepted: boolean;
    status: string;
    message?: string;
};

type TeamCeoChatResponse = {
    ok: boolean;
    reply: string;
    task_intent?: boolean;
    require_confirmation?: boolean;
    suggested_executor?: string;
    cto_lane?: string;
    execution_mode?: string;
    eta_minutes?: number;
};

const fetchJson = async <T>(
    url: string,
    init?: RequestInit,
    timeoutMs: number = BACKEND_TIMEOUT_MS
): Promise<T> => {
    const controller = new AbortController();
    const timeoutId = setTimeout(
        () => controller.abort(new Error("backend request timeout")),
        Math.max(timeoutMs, 1000)
    );
    const response = await fetch(url, {
        ...init,
        signal: controller.signal,
    }).finally(() => clearTimeout(timeoutId));
    if (!response.ok) {
        const text = await response.text().catch(() => "");
        throw new Error(`HTTP ${response.status} ${text}`.trim());
    }
    return (await response.json()) as T;
};

const isBackendHealthy = async (): Promise<boolean> => {
    try {
        const data = await fetchJson<{ ok?: boolean }>(
            `${BACKEND_BASE_URL}/api/v1/team/runtime/health`,
            {
                method: "GET",
                headers: { "Content-Type": "application/json" },
            },
            BACKEND_HEALTH_TIMEOUT_MS
        );
        return Boolean(data?.ok);
    } catch {
        return false;
    }
};

const normalize = (text: string) => text.replace(/\s+/g, " ").trim();

const isGreetingOrSmallTalk = (prompt: string) => {
    const text = normalize(prompt).toLowerCase();
    if (!text) return true;
    const tiny = text.length <= 8;
    const greetingKeywords = [
        "你好",
        "在吗",
        "嗨",
        "hi",
        "hello",
        "早上好",
        "晚上好",
        "辛苦了",
    ];
    const capabilityKeywords = ["你是谁", "你能做什么", "你有什么能力", "介绍一下"];
    if (greetingKeywords.some((word) => text.includes(word)) && tiny) return true;
    if (capabilityKeywords.some((word) => text.includes(word))) return true;
    return false;
};

const isTaskIntent = (prompt: string) => {
    const text = normalize(prompt).toLowerCase();
    if (!text) return false;
    if (isGreetingOrSmallTalk(text)) return false;
    const actionKeywords = [
        "开发",
        "实现",
        "写一个",
        "做一个",
        "生成",
        "分析",
        "部署",
        "排查",
        "修复",
        "优化",
        "上线",
        "执行",
        "创建",
        "制作",
        "搭建",
        "重构",
        "整理",
        "提取",
        "转写",
    ];
    const requestPrefixes = ["帮我", "请你", "请帮我", "麻烦你"];
    const hasAction = actionKeywords.some((word) => text.includes(word));
    const hasRequestPrefix = requestPrefixes.some((word) => text.includes(word));
    const explicitTask = text.includes("任务：") || text.startsWith("任务 ");
    if (explicitTask && text.length >= 6) return true;
    if (hasAction && hasRequestPrefix) return true;
    if (hasAction && text.length >= 10) return true;
    return false;
};

const shouldAutoDispatchByCeoReply = (reply: string) => {
    const text = normalize(reply).toLowerCase();
    if (!text) return true;
    const clarifyHints = ["澄清", "先回答", "请先", "在分发", "需要确认", "先确认"];
    const hasClarifyHint = clarifyHints.some((token) => text.includes(token));
    const questionMarks = (reply.match(/[?？]/g) || []).length;
    if (hasClarifyHint || questionMarks >= 2) return false;
    return true;
};

const isConfirmExecutionIntent = (prompt: string) => {
    const text = normalize(prompt).toLowerCase();
    if (!text) return false;
    if (text.includes("确认执行") || text.includes("开始执行")) return true;
    if (text === "确认" || text === "执行") return true;
    if (
        text.includes("执行") &&
        ["确认", "可以", "马上", "开工", "现在", "继续"].some((w) => text.includes(w))
    ) {
        return true;
    }
    return false;
};

const isRejectExecutionIntent = (prompt: string) => {
    const text = normalize(prompt).toLowerCase();
    if (!text) return false;
    const keywords = ["取消执行", "先不执行", "暂不执行", "不用执行", "只讨论", "先聊"];
    return keywords.some((word) => text.includes(word));
};

const isCancelExecutionIntent = (prompt: string) => {
    const text = normalize(prompt).toLowerCase();
    const keywords = ["取消排队", "取消任务", "先不执行", "不用执行", "取消"];
    return keywords.some((word) => text.includes(word));
};

const isQueueQueryIntent = (prompt: string) => {
    const text = normalize(prompt).toLowerCase();
    const keywords = ["排队", "队列", "进度", "状态", "什么时候"];
    return keywords.some((word) => text.includes(word));
};

const hasConfirmInstructionInReply = (reply: string) => {
    const text = normalize(reply).toLowerCase();
    if (!text) return false;
    return (
        text.includes("确认执行") ||
        text.includes("开始执行") ||
        text.includes("若你确认现在开始")
    );
};

const eventKey = (event: TimelineEvent) =>
    `${event.timestamp || ""}|${event.event || ""}|${event.detail || ""}`;

const formatEventLine = (event: TimelineEvent) => {
    const actor = (event.actor || event.role || "Yoyoo").toString();
    const detail = (event.detail || "").trim();
    if (!detail) return "";
    return `【${actor}】${detail}`;
};

const statusCn = (status: string) => {
    switch (status) {
        case "done":
            return "已完成";
        case "failed":
            return "失败";
        case "review":
            return "待验收";
        case "running":
            return "执行中";
        default:
            return "处理中";
    }
};

const enqueueText = (
    controller: ReadableStreamDefaultController<Uint8Array>,
    encoder: TextEncoder,
    text: string
) => {
    if (!text) return;
    controller.enqueue(encoder.encode(text));
};

const streamByChunks = async (
    controller: ReadableStreamDefaultController<Uint8Array>,
    encoder: TextEncoder,
    text: string,
    chunkSize = 22
) => {
    for (let i = 0; i < text.length; i += chunkSize) {
        enqueueText(controller, encoder, text.slice(i, i + chunkSize));
        await sleep(25);
    }
};

const runCeoChat = async ({
    userId,
    conversationId,
    prompt,
}: {
    userId: string;
    conversationId: string;
    prompt: string;
}): Promise<TeamCeoChatResponse> => {
    try {
        return await fetchJson<TeamCeoChatResponse>(`${BACKEND_BASE_URL}/api/v1/team/chat/ceo`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                user_id: userId,
                message: prompt,
                conversation_id: conversationId,
                channel: "web",
                project_key: "yoyoo-ui",
            }),
        });
    } catch (error) {
        const msg = (error as Error)?.message || "unknown error";
        const isTimeout = msg.includes("backend request timeout");
        if (isTimeout) {
            const healthy = await isBackendHealthy();
            if (healthy) {
                try {
                    return await fetchJson<TeamCeoChatResponse>(
                        `${BACKEND_BASE_URL}/api/v1/team/chat/ceo`,
                        {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({
                                user_id: userId,
                                message: prompt,
                                conversation_id: conversationId,
                                channel: "web",
                                project_key: "yoyoo-ui",
                            }),
                        },
                        Math.max(BACKEND_TIMEOUT_MS, 100000)
                    );
                } catch (retryError) {
                    return {
                        ok: false,
                        reply: `我在。后端正在处理长任务（服务健康），这次响应超时：${
                            (retryError as Error)?.message || "unknown error"
                        }。请稍后重试或继续发送下一条指令。`,
                        task_intent: isTaskIntent(prompt),
                        require_confirmation: false,
                        suggested_executor: "CTO",
                        cto_lane: "ENG",
                        execution_mode: "subagent",
                        eta_minutes: 8,
                    };
                }
            }
        }
        return {
            ok: false,
            reply: `我在。后端暂时繁忙：${msg}。请稍后重试。`,
            task_intent: isTaskIntent(prompt),
            require_confirmation: false,
            suggested_executor: "CTO",
            cto_lane: "ENG",
            execution_mode: "subagent",
            eta_minutes: 8,
        };
    }
};

const runTaskExecutionFlow = async ({
    request,
    controller,
    encoder,
    userId,
    conversationId,
    taskPrompt,
    ticketId,
    intro,
}: {
    request: NextRequest;
    controller: ReadableStreamDefaultController<Uint8Array>;
    encoder: TextEncoder;
    userId: string;
    conversationId: string;
    taskPrompt: string;
    ticketId?: string;
    intro?: string;
}) => {
    if (intro) {
        enqueueText(controller, encoder, `\n\n${intro}\n`);
    }

    try {
        let created: CreateTaskResponse;
        try {
            created = await fetchJson<CreateTaskResponse>(`${BACKEND_BASE_URL}/api/v1/team/tasks`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({
                    user_id: userId,
                    message: taskPrompt,
                    conversation_id: conversationId,
                    channel: "web",
                    project_key: "yoyoo-ui",
                }),
            });
        } catch (error) {
            enqueueText(
                controller,
                encoder,
                `\nYoyoo 后端不可达（${BACKEND_BASE_URL}）：${
                    (error as Error)?.message || "unknown error"
                }`
            );
            return;
        }

        if (!created.ok || !created.task_id) {
            enqueueText(controller, encoder, "\n任务创建失败，请稍后重试。");
            return;
        }
        if (created.reply) {
            enqueueText(controller, encoder, `\n${created.reply}\n`);
        }

        const taskId = created.task_id;
        try {
            const runAccepted = await fetchJson<TaskRunAsyncResponse>(
                `${BACKEND_BASE_URL}/api/v1/team/tasks/${encodeURIComponent(taskId)}/run-async`,
                {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                    },
                    body: JSON.stringify({
                        max_attempts: 2,
                        resume: true,
                    }),
                }
            );
            if (runAccepted.message) {
                enqueueText(controller, encoder, `\n${runAccepted.message}`);
            }
            if (!runAccepted.accepted && runAccepted.status === "done") {
                enqueueText(controller, encoder, "\n任务已是完成态，正在回收执行结果。");
            }
        } catch (error) {
            enqueueText(
                controller,
                encoder,
                `\n触发执行失败：${(error as Error)?.message || "unknown error"}`
            );
        }

        const startedAt = Date.now();
        const seenEvents = new Set<string>();
        let lastStatus = created.status || "running";
        let emittedProgress = 0;

        while (!request.signal.aborted) {
            const elapsed = Date.now() - startedAt;
            if (elapsed > POLL_TIMEOUT_MS) {
                enqueueText(
                    controller,
                    encoder,
                    "\n任务仍在执行中，已超出本次等待时间。你可以稍后继续查看进度。"
                );
                break;
            }

            let detail: TaskDetailResponse;
            try {
                detail = await fetchJson<TaskDetailResponse>(
                    `${BACKEND_BASE_URL}/api/v1/team/tasks/${encodeURIComponent(taskId)}`
                );
            } catch (error) {
                enqueueText(
                    controller,
                    encoder,
                    `\n进度查询失败：${(error as Error)?.message || "unknown error"}`
                );
                break;
            }

            lastStatus = detail.status || lastStatus;
            const freshLines = (detail.timeline || [])
                .filter((event) => {
                    const key = eventKey(event);
                    if (seenEvents.has(key)) return false;
                    seenEvents.add(key);
                    return true;
                })
                .map(formatEventLine)
                .filter(Boolean);

            if (freshLines.length > 0) {
                const visible = freshLines
                    .filter((line) => !line.includes("已创建任务并进入协作流程"))
                    .slice(0, 2 - emittedProgress);
                if (visible.length > 0) {
                    enqueueText(controller, encoder, `\n${visible.join("\n")}\n`);
                    emittedProgress += visible.length;
                }
            }

            if (lastStatus === "done") {
                enqueueText(controller, encoder, "\n这条任务已完成，我可以继续为你做验收总结。");
                break;
            }
            if (lastStatus === "failed") {
                enqueueText(controller, encoder, "\n任务执行失败。我可以立刻给你一个修复方案并重派。");
                break;
            }
            if (elapsed > INITIAL_REPORT_WINDOW_MS && emittedProgress > 0) {
                enqueueText(
                    controller,
                    encoder,
                    `\n当前状态：${statusCn(lastStatus)}。你随时说“汇报 ${taskId} 进展”，我会继续播报。`
                );
                break;
            }

            await sleep(Math.max(POLL_INTERVAL_MS, 1000));
        }
    } finally {
        if (ticketId) {
            await finishExecutionTicket(ticketId);
        }
    }
};

export async function POST(request: NextRequest) {
    const body = (await request.json()) as {
        userId?: string;
        conversationId?: string;
        prompt?: string;
    };
    const prompt = (body.prompt ?? "").trim();
    if (!prompt) {
        return new Response("missing prompt", { status: 400 });
    }

    const encoder = new TextEncoder();
    const userId = (body.userId || "web-user").trim() || "web-user";
    const conversationId =
        (body.conversationId || `web:${userId}`).trim() || `web:${userId}`;

    const stream = new ReadableStream({
        async start(controller) {
            try {
                const promoted = await promoteQueuedTaskForConversation({
                    userId,
                    conversationId,
                });
                if (promoted.mode === "running") {
                    await runTaskExecutionFlow({
                        request,
                        controller,
                        encoder,
                        userId,
                        conversationId,
                        taskPrompt: promoted.prompt,
                        ticketId: promoted.ticketId,
                        intro: "你的排队任务已轮到，现在开始执行并给你关键进度。",
                    });
                    controller.close();
                    return;
                }

                const queuePosition = await getQueuePositionForConversation({
                    userId,
                    conversationId,
                });
                const pendingIntent = await getPendingIntent(userId, conversationId);
                if (queuePosition) {
                    if (isCancelExecutionIntent(prompt)) {
                        await cancelQueuedTaskForConversation({
                            userId,
                            conversationId,
                        });
                        enqueueText(controller, encoder, "已取消这条排队任务。我们继续聊。");
                        controller.close();
                        return;
                    }
                    if (isQueueQueryIntent(prompt)) {
                        enqueueText(
                            controller,
                            encoder,
                            `这条任务仍在队列中，当前第 ${queuePosition} 位。轮到后会自动开始执行。`
                        );
                        controller.close();
                        return;
                    }
                }

                const confirmIntent = isConfirmExecutionIntent(prompt);
                const rejectIntent = isRejectExecutionIntent(prompt);

                const skipCeoForConfirm = Boolean(pendingIntent && confirmIntent);
                let ceoResult: TeamCeoChatResponse = {
                    ok: true,
                    reply: "",
                    task_intent: true,
                    require_confirmation: false,
                    suggested_executor: "CTO",
                    cto_lane: "ENG",
                    execution_mode: "subagent",
                    eta_minutes: 8,
                };
                let ceoReply = "";
                let taskIntent = false;

                if (!skipCeoForConfirm) {
                    if (pendingIntent && confirmIntent) {
                        enqueueText(controller, encoder, "CEO 正在理解任务上下文，请稍候...\n");
                    }
                    ceoResult = await runCeoChat({
                        userId,
                        conversationId,
                        prompt,
                    });
                    ceoReply = (ceoResult.reply || "").trim() || "我在，请继续说。";
                    taskIntent = Boolean(ceoResult.task_intent ?? isTaskIntent(prompt));
                } else {
                    taskIntent = true;
                }

                if (taskIntent && !pendingIntent) {
                    enqueueText(controller, encoder, "CEO 正在理解任务上下文，请稍候...\n");
                }
                if (!skipCeoForConfirm) {
                    await streamByChunks(controller, encoder, ceoReply);
                }

                if (pendingIntent && rejectIntent) {
                    await clearPendingIntent(userId, conversationId);
                    enqueueText(controller, encoder, "\n\n好的，已取消待执行任务。我们继续只讨论。");
                    controller.close();
                    return;
                }

                let shouldDispatch = false;
                let dispatchPrompt = prompt;

                if (pendingIntent && confirmIntent) {
                    shouldDispatch = true;
                    dispatchPrompt = pendingIntent.prompt;
                    await clearPendingIntent(userId, conversationId);
                } else if (taskIntent) {
                    if (TASK_DISPATCH_MODE === "auto") {
                        shouldDispatch = shouldAutoDispatchByCeoReply(ceoReply);
                    } else if (TASK_DISPATCH_MODE === "confirm") {
                        await setPendingIntent(userId, conversationId, {
                            prompt,
                            suggestedExecutor: ceoResult.suggested_executor || "CTO",
                        });
                        if (!hasConfirmInstructionInReply(ceoReply)) {
                            enqueueText(
                                controller,
                                encoder,
                                "\n\n我已识别到这是一条可执行任务。若要开始执行，请回复“确认执行”；若只想继续讨论，直接继续聊即可。"
                            );
                        }
                        controller.close();
                        return;
                    } else {
                        shouldDispatch = false;
                    }
                }

                if (!shouldDispatch) {
                    controller.close();
                    return;
                }
                if (TASK_DISPATCH_MODE === "auto" && !shouldAutoDispatchByCeoReply(ceoReply)) {
                    enqueueText(
                        controller,
                        encoder,
                        "\n\n我会先按 CEO 的澄清问题推进，待信息齐全后再自动分发 CTO 执行。"
                    );
                    controller.close();
                    return;
                }

                const slot = await requestExecutionSlot({
                    userId,
                    conversationId,
                    prompt: dispatchPrompt,
                });
                if (slot.mode === "running") {
                    await runTaskExecutionFlow({
                        request,
                        controller,
                        encoder,
                        userId,
                        conversationId,
                        taskPrompt: dispatchPrompt,
                        ticketId: slot.ticketId,
                        intro:
                            pendingIntent && confirmIntent
                                ? "已收到确认，CEO 现已派发 CTO 开始执行。"
                                : "我已识别为可执行任务，已自动派给 CTO 开始执行。",
                    });
                } else if (slot.mode === "queued") {
                    enqueueText(
                        controller,
                        encoder,
                        `\n\n执行并发已满，任务已自动排队（第 ${slot.position} 位）。你可以随时说“查看队列”。`
                    );
                } else {
                    enqueueText(
                        controller,
                        encoder,
                        "\n\n当前你的排队任务已达到上限。请先等待已有任务完成，或发送“取消排队”。"
                    );
                }

                controller.close();
            } catch (error) {
                controller.error(error);
            }
        },
    });

    return new Response(stream, {
        headers: {
            "Content-Type": "text/plain; charset=utf-8",
            "Cache-Control": "no-cache, no-transform",
            Connection: "keep-alive",
        },
    });
}
