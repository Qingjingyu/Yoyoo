"use client";

import Icon from "@/components/Icon";
import { useLocale } from "@/contexts/locale-context";

export type TaskStatus =
    | "todo"
    | "in_progress"
    | "blocked"
    | "review"
    | "done";

export type TaskPriority = "low" | "medium" | "high" | "urgent";

type TaskCardProps = {
    title: string;
    owner: string;
    status: TaskStatus;
    priority: TaskPriority;
    eta: string;
    progress: number;
    tags?: string[];
    dependencies?: number;
    updatedAt?: string;
};

const statusClasses: Record<TaskStatus, string> = {
    todo: "bg-n-3 text-n-5 dark:bg-n-5 dark:text-n-3",
    in_progress: "bg-primary-1/15 text-primary-1",
    blocked: "bg-accent-1/15 text-accent-1",
    review: "bg-accent-3/15 text-accent-3",
    done: "bg-primary-2/15 text-primary-2",
};

const priorityClasses: Record<TaskPriority, string> = {
    low: "text-primary-2",
    medium: "text-accent-5",
    high: "text-accent-1",
    urgent: "text-accent-1",
};

const clampProgress = (value: number) => Math.max(0, Math.min(100, value));

const TaskCard = ({
    title,
    owner,
    status,
    priority,
    eta,
    progress,
    tags = [],
    dependencies = 0,
    updatedAt,
}: TaskCardProps) => {
    const { t } = useLocale();
    const safeProgress = clampProgress(progress);

    return (
        <div className="p-5 bg-n-1 border border-n-3 rounded-2xl dark:bg-n-7 dark:border-n-5">
            <div className="flex items-start">
                <div className="mr-auto pr-4 h6">{title}</div>
                <div
                    className={`px-2.5 py-1 rounded-full caption1 font-semibold ${statusClasses[status]}`}
                >
                    {t(`task.status.${status}`)}
                </div>
            </div>

            <div className="flex flex-wrap items-center mt-4 gap-3 caption1 text-n-4">
                <div className="flex items-center">
                    <Icon className="w-4 h-4 mr-1 fill-n-4" name="user-check" />
                    {owner}
                </div>
                <div className="flex items-center">
                    <Icon className="w-4 h-4 mr-1 fill-n-4" name="clock" />
                    {t("task.eta")}: {eta}
                </div>
                <div className={`font-semibold ${priorityClasses[priority]}`}>
                    {t(`task.priority.${priority}`)}
                </div>
            </div>

            <div className="mt-4">
                <div className="flex items-center mb-2 caption1 text-n-4">
                    <span className="mr-auto">{t("task.progress")}</span>
                    <span>{safeProgress}%</span>
                </div>
                <div className="h-2 bg-n-3 rounded-full overflow-hidden dark:bg-n-5">
                    <div
                        className="h-full bg-primary-1 rounded-full transition-all"
                        style={{ width: `${safeProgress}%` }}
                    />
                </div>
            </div>

            <div className="flex flex-wrap items-center mt-4 gap-2">
                {tags.map((tag) => (
                    <div
                        className="px-2 py-1 rounded-md bg-n-2 caption1 text-n-5 dark:bg-n-6 dark:text-n-3"
                        key={tag}
                    >
                        #{tag}
                    </div>
                ))}
            </div>

            <div className="flex items-center mt-4 caption1 text-n-4">
                <div>
                    {t("task.dependencies")}: {dependencies}
                </div>
                {updatedAt && (
                    <div className="ml-auto">
                        {t("task.updatedAt")}: {updatedAt}
                    </div>
                )}
            </div>
        </div>
    );
};

export default TaskCard;
