"use client";

import Icon from "@/components/Icon";
import Image from "@/components/Image";
import WebPreview, { WebPreviewStatus } from "@/components/WebPreview";
import { useLocale } from "@/contexts/locale-context";

export type ArtifactType =
    | "code"
    | "image"
    | "audio"
    | "video"
    | "document"
    | "webpage";

type ArtifactCardProps = {
    type: ArtifactType;
    title: string;
    description?: string;
    version?: string;
    fromTask?: string;
    updatedAt?: string;
    previewUrl?: string;
    sourceUrl?: string;
    codeSnippet?: string;
    webStatus?: WebPreviewStatus;
};

const typeIcon: Record<ArtifactType, string> = {
    code: "codepen",
    image: "image-check",
    audio: "music-note",
    video: "play-circle",
    document: "box",
    webpage: "container",
};

const ArtifactCard = ({
    type,
    title,
    description,
    version,
    fromTask,
    updatedAt,
    previewUrl,
    sourceUrl,
    codeSnippet,
    webStatus = "ready",
}: ArtifactCardProps) => {
    const { t } = useLocale();

    return (
        <div className="p-5 bg-n-1 border border-n-3 rounded-2xl dark:bg-n-7 dark:border-n-5">
            <div className="flex items-center mb-3">
                <div className="mr-auto flex items-center min-w-0">
                    <Icon className="shrink-0 fill-n-4 mr-2" name={typeIcon[type]} />
                    <div className="base1 font-semibold truncate">{title}</div>
                </div>
                <div className="caption1 text-n-4">{t(`artifact.type.${type}`)}</div>
            </div>

            {type === "webpage" && sourceUrl ? (
                <WebPreview
                    title={title}
                    url={sourceUrl}
                    summary={description}
                    screenshot={previewUrl}
                    status={webStatus}
                />
            ) : (
                <>
                    {previewUrl && (
                        <div className="relative mb-3 w-full h-40 rounded-xl overflow-hidden">
                            <Image
                                className="object-cover"
                                src={previewUrl}
                                fill
                                alt={title}
                            />
                        </div>
                    )}
                    {codeSnippet && (
                        <pre className="mb-3 p-3 bg-n-2 rounded-xl overflow-auto caption1 dark:bg-n-6">
                            <code>{codeSnippet}</code>
                        </pre>
                    )}
                    {description && (
                        <div className="mb-3 base2 text-n-4">{description}</div>
                    )}
                </>
            )}

            <div className="flex flex-wrap gap-x-4 gap-y-2 caption1 text-n-4">
                {version && (
                    <div>
                        {t("artifact.version")}: {version}
                    </div>
                )}
                {fromTask && (
                    <div>
                        {t("artifact.fromTask")}: {fromTask}
                    </div>
                )}
                {updatedAt && (
                    <div>
                        {t("artifact.updatedAt")}: {updatedAt}
                    </div>
                )}
            </div>
        </div>
    );
};

export default ArtifactCard;
