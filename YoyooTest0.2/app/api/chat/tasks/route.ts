import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

const BACKEND_TIMEOUT_MS = Number.parseInt(
    process.env.YOYOO_BACKEND_TIMEOUT_MS || "600000",
    10
);
const BACKEND_BASE_URL = (
    process.env.YOYOO_BACKEND_BASE_URL || "http://127.0.0.1:8000"
).replace(/\/+$/, "");

type TeamTaskListItem = {
    task_id: string;
    title: string;
    owner_role: string;
    status: string;
    eta_minutes?: number | null;
    cto_lane?: string | null;
    execution_mode?: string | null;
    updated_at: string;
};

type TeamTaskListResponse = {
    ok: boolean;
    items?: TeamTaskListItem[];
};

type TeamTaskDetailResponse = {
    task_id: string;
    timeline?: Array<{
        timestamp?: string;
        actor?: string;
        event?: string;
        detail?: string;
    }>;
};

type WorkspaceTaskItem = {
    id: string;
    title: string;
    owner: string;
    status: "todo" | "in_progress" | "blocked" | "review" | "done";
    priority: "low" | "medium" | "high" | "urgent";
    progress: number;
    eta: string;
    updatedAt: string;
    conversationId: string;
    tags: string[];
};

type WorkspaceTimelineItem = {
    id: string;
    type: "created" | "assigned" | "artifact";
    time: string;
    actor: string;
    title: string;
    detail: string;
};

const badRequest = (message: string) =>
    NextResponse.json({ ok: false, error: message }, { status: 400 });

const fetchJson = async <T>(url: string): Promise<T> => {
    const controller = new AbortController();
    const timeoutId = setTimeout(
        () => controller.abort(new Error("backend request timeout")),
        Math.max(BACKEND_TIMEOUT_MS, 1000)
    );
    const response = await fetch(url, {
        signal: controller.signal,
        cache: "no-store",
    }).finally(() => clearTimeout(timeoutId));
    if (!response.ok) {
        const text = await response.text().catch(() => "");
        throw new Error(`HTTP ${response.status} ${text}`.trim());
    }
    return (await response.json()) as T;
};

const toHHmm = (iso?: string) => {
    if (!iso) return "--:--";
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return "--:--";
    return `${String(date.getHours()).padStart(2, "0")}:${String(
        date.getMinutes()
    ).padStart(2, "0")}`;
};

const toEtaText = (updatedAtIso: string, etaMinutes?: number | null) => {
    const base = new Date(updatedAtIso);
    if (Number.isNaN(base.getTime()) || !etaMinutes || etaMinutes <= 0) {
        return "--";
    }
    const etaAt = new Date(base.getTime() + etaMinutes * 60_000);
    return `${etaAt.getFullYear()}-${String(etaAt.getMonth() + 1).padStart(
        2,
        "0"
    )}-${String(etaAt.getDate()).padStart(2, "0")} ${String(
        etaAt.getHours()
    ).padStart(2, "0")}:${String(etaAt.getMinutes()).padStart(2, "0")}`;
};

const mapStatus = (
    status: string
): { status: WorkspaceTaskItem["status"]; progress: number } => {
    const value = (status || "").toLowerCase();
    if (value === "done" || value === "completed") return { status: "done", progress: 100 };
    if (value === "review") return { status: "review", progress: 85 };
    if (value === "planned" || value === "todo") return { status: "todo", progress: 10 };
    if (value === "running" || value === "in_progress") {
        return { status: "in_progress", progress: 55 };
    }
    return { status: "blocked", progress: 20 };
};

const mapEventType = (event: string): WorkspaceTimelineItem["type"] => {
    const value = event.toLowerCase();
    if (value.includes("created")) return "created";
    if (value.includes("dispatch") || value.includes("execution") || value.includes("assigned")) {
        return "assigned";
    }
    return "artifact";
};

export async function GET(request: NextRequest) {
    const userId = request.nextUrl.searchParams.get("userId");
    const conversationId = request.nextUrl.searchParams.get("conversationId") || "/";
    if (!userId) return badRequest("missing userId");

    try {
        const list = await fetchJson<TeamTaskListResponse>(
            `${BACKEND_BASE_URL}/api/v1/team/tasks?user_id=${encodeURIComponent(
                userId
            )}&limit=30`
        );
        const rawItems = (list.items || []).slice(-20).reverse();

        const tasks: WorkspaceTaskItem[] = rawItems.map((item) => {
            const mapped = mapStatus(item.status);
            return {
                id: item.task_id,
                title: item.title,
                owner: item.owner_role === "CTO" ? "Yoyoo CTO" : item.owner_role || "Yoyoo",
                status: mapped.status,
                priority: item.cto_lane === "ENG" ? "high" : "medium",
                progress: mapped.progress,
                eta: toEtaText(item.updated_at, item.eta_minutes),
                updatedAt: toHHmm(item.updated_at),
                conversationId,
                tags: [item.cto_lane || "ENG", item.execution_mode || "subagent"],
            };
        });

        const timelineResults = await Promise.all(
            rawItems.slice(0, 8).map(async (item) => {
                try {
                    const detail = await fetchJson<TeamTaskDetailResponse>(
                        `${BACKEND_BASE_URL}/api/v1/team/tasks/${encodeURIComponent(item.task_id)}`
                    );
                    return (detail.timeline || []).map((event, index) => ({
                        id: `${item.task_id}-${index}`,
                        type: mapEventType(event.event || ""),
                        time: toHHmm(event.timestamp),
                        actor: event.actor || "Yoyoo",
                        title: event.event || "progress",
                        detail: event.detail || "",
                    }));
                } catch {
                    return [] as WorkspaceTimelineItem[];
                }
            })
        );

        const timeline = timelineResults
            .flat()
            .filter((item) => item.detail.trim().length > 0)
            .slice(-20)
            .reverse();

        return NextResponse.json({
            ok: true,
            tasks,
            timeline,
        });
    } catch (error) {
        return NextResponse.json(
            {
                ok: false,
                error: (error as Error)?.message || "backend_unavailable",
                tasks: [],
                timeline: [],
            },
            { status: 200 }
        );
    }
}
