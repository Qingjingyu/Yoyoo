"use client";

import Icon from "@/components/Icon";
import { useLocale } from "@/contexts/locale-context";

export type TimelineEventType =
    | "created"
    | "assigned"
    | "update"
    | "artifact"
    | "risk"
    | "done";

export type TimelineEvent = {
    id: string;
    time: string;
    actor: string;
    title: string;
    detail?: string;
    type: TimelineEventType;
};

type TaskTimelineProps = {
    items: TimelineEvent[];
};

const typeClasses: Record<TimelineEventType, string> = {
    created: "bg-n-4",
    assigned: "bg-accent-3",
    update: "bg-primary-1",
    artifact: "bg-primary-2",
    risk: "bg-accent-1",
    done: "bg-primary-2",
};

const TaskTimeline = ({ items }: TaskTimelineProps) => {
    const { t } = useLocale();

    return (
        <div className="p-5 bg-n-1 border border-n-3 rounded-2xl dark:bg-n-7 dark:border-n-5">
            <div className="flex items-center mb-4">
                <div className="mr-auto h6">{t("timeline.title")}</div>
                <Icon className="fill-n-4" name="dataflow" />
            </div>
            <div className="space-y-4">
                {items.map((item, index) => (
                    <div className="relative pl-7" key={item.id}>
                        {index !== items.length - 1 && (
                            <div className="absolute left-[0.45rem] top-4 bottom-[-1.25rem] w-0.5 bg-n-3 dark:bg-n-5" />
                        )}
                        <div
                            className={`absolute left-0 top-1.5 w-4 h-4 rounded-full border-2 border-n-1 dark:border-n-7 ${typeClasses[item.type]}`}
                        />
                        <div className="flex items-center caption1 text-n-4">
                            <div className="mr-2">{item.time}</div>
                            <div>{t(`timeline.type.${item.type}`)}</div>
                        </div>
                        <div className="mt-1 base1 font-semibold">{item.title}</div>
                        <div className="mt-0.5 caption1 text-n-4">
                            {t("timeline.by")} {item.actor}
                        </div>
                        {item.detail && (
                            <div className="mt-2 base2 text-n-4">{item.detail}</div>
                        )}
                    </div>
                ))}
            </div>
        </div>
    );
};

export default TaskTimeline;
