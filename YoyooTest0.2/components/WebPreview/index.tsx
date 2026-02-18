"use client";

import Icon from "@/components/Icon";
import Image from "@/components/Image";
import { useLocale } from "@/contexts/locale-context";

export type WebPreviewStatus = "ready" | "loading" | "failed";

type WebPreviewProps = {
    title: string;
    url: string;
    summary?: string;
    screenshot?: string;
    status?: WebPreviewStatus;
};

const statusClasses: Record<WebPreviewStatus, string> = {
    ready: "bg-primary-2/15 text-primary-2",
    loading: "bg-accent-5/15 text-accent-5",
    failed: "bg-accent-1/15 text-accent-1",
};

const WebPreview = ({
    title,
    url,
    summary,
    screenshot,
    status = "ready",
}: WebPreviewProps) => {
    const { t } = useLocale();

    return (
        <div className="p-4 bg-n-1 border border-n-3 rounded-xl dark:bg-n-6 dark:border-n-5">
            <div className="flex items-center mb-3">
                <div className="mr-auto base1 font-semibold truncate pr-3">
                    {title}
                </div>
                <div
                    className={`px-2 py-1 rounded-full caption1 font-semibold ${statusClasses[status]}`}
                >
                    {t(`webPreview.status.${status}`)}
                </div>
            </div>

            {screenshot && (
                <div className="relative mb-3 w-full h-40 rounded-lg overflow-hidden">
                    <Image className="object-cover" src={screenshot} fill alt={title} />
                </div>
            )}

            {summary && <div className="mb-3 base2 text-n-4">{summary}</div>}

            <a
                className="inline-flex items-center base2 font-semibold text-primary-1 hover:opacity-80"
                href={url}
                target="_blank"
                rel="noopener noreferrer"
            >
                {t("webPreview.openLink")}
                <Icon className="w-4 h-4 ml-2 fill-primary-1" name="external-link" />
            </a>
        </div>
    );
};

export default WebPreview;
