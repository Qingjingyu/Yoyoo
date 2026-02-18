"use client";

import Layout from "@/components/Layout";
import ArtifactCard from "@/components/ArtifactCard";
import TaskCard from "@/components/TaskCard";
import TaskTimeline, { TimelineEvent } from "@/components/TaskTimeline";
import { useLocale } from "@/contexts/locale-context";

const timelineItems: TimelineEvent[] = [
    {
        id: "0",
        type: "created",
        time: "09:00",
        actor: "Yoyoo CEO",
        title: "收到董事长任务：发布品牌宣传页",
        detail: "已创建任务并进入待拆解状态。",
    },
    {
        id: "1",
        type: "assigned",
        time: "09:12",
        actor: "Yoyoo CTO",
        title: "分配子任务到前端与内容组",
        detail: "建立前端、文案、素材三条并行流水线。",
    },
    {
        id: "2",
        type: "artifact",
        time: "10:25",
        actor: "Frontend Agent",
        title: "产出页面首版原型",
        detail: "包含 Hero 区、功能区、CTA 区。",
    },
    {
        id: "3",
        type: "risk",
        time: "10:40",
        actor: "QA Agent",
        title: "发现移动端首屏溢出风险",
        detail: "建议压缩标题字号并缩短首屏文案。",
    },
];

const ModuleLibraryPage = () => {
    const { t } = useLocale();

    return (
        <Layout hideRightSidebar>
            <div className="p-10 md:px-5 md:py-6">
                <div className="mb-2 h3 md:h4">{t("moduleLibrary.title")}</div>
                <div className="mb-8 body1S text-n-4 md:mb-6">
                    {t("moduleLibrary.subtitle")}
                </div>

                <div className="mb-8">
                    <div className="mb-4 h6">{t("moduleLibrary.section.taskCard")}</div>
                    <div className="grid grid-cols-2 gap-4 xl:grid-cols-1">
                        <TaskCard
                            title="企业官网改版"
                            owner="Yoyoo CTO"
                            status="in_progress"
                            priority="high"
                            eta="2026-02-20"
                            progress={56}
                            tags={["website", "brand", "frontend"]}
                            dependencies={2}
                            updatedAt="11:20"
                        />
                        <TaskCard
                            title="短视频矩阵发布"
                            owner="运营组"
                            status="review"
                            priority="medium"
                            eta="2026-02-19"
                            progress={82}
                            tags={["media", "growth"]}
                            dependencies={1}
                            updatedAt="11:38"
                        />
                    </div>
                </div>

                <div className="mb-8">
                    <div className="mb-4 h6">{t("moduleLibrary.section.timeline")}</div>
                    <TaskTimeline items={timelineItems} />
                </div>

                <div>
                    <div className="mb-4 h6">{t("moduleLibrary.section.artifact")}</div>
                    <div className="grid grid-cols-2 gap-4 xl:grid-cols-1">
                        <ArtifactCard
                            type="code"
                            title="Landing Page Hero.tsx"
                            description="首页首屏组件，含主标题、价值点与 CTA。"
                            version="v0.3.2"
                            fromTask="企业官网改版"
                            updatedAt="11:35"
                            codeSnippet={"<Hero title=\"Yoyoo\" cta=\"立即体验\" />"}
                        />
                        <ArtifactCard
                            type="image"
                            title="品牌 KV 主视觉"
                            description="用于首页首屏与投放封面图。"
                            version="v1.1"
                            fromTask="企业官网改版"
                            updatedAt="11:10"
                            previewUrl="/images/history-image.jpg"
                        />
                        <ArtifactCard
                            type="audio"
                            title="宣传旁白（普通话女声）"
                            description="60 秒版本，适配视频平台投放。"
                            version="v0.9"
                            fromTask="短视频矩阵发布"
                            updatedAt="10:56"
                        />
                        <ArtifactCard
                            type="webpage"
                            title="预发布网页预览"
                            description="已完成结构与样式，待联调 CTA 跳转。"
                            version="preview-12"
                            fromTask="企业官网改版"
                            updatedAt="11:40"
                            sourceUrl="https://openclaw.ai"
                            previewUrl="/images/video-pic-1.jpg"
                            webStatus="ready"
                        />
                    </div>
                </div>
            </div>
        </Layout>
    );
};

export default ModuleLibraryPage;
