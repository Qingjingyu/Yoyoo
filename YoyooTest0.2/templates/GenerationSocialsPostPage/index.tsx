"use client";

import { useState } from "react";
import Layout from "@/components/Layout";
import Chat from "@/components/Chat";
import Message from "@/components/Message";
import Question from "@/components/Question";
import Answer from "@/components/Answer";
import SocialsPost from "@/components/SocialsPost";
import SchedulePost from "@/components/SchedulePost";
import ScheduleResult from "@/components/ScheduleResult";
import { useLocale } from "@/contexts/locale-context";

import { socailsPost } from "@/mocks/socialsPost";

const GenerationSocialsPostPage = () => {
    const [message, setMessage] = useState<string>("");
    const { t } = useLocale();

    return (
        <Layout>
            <Chat title={t("socialsPage.chatTitle")}>
                <Question
                    content={t("socialsPage.q.prompt")}
                    time={t("common.justNow")}
                />
                <Answer loading />
                <Answer time={t("common.justNow")}>
                    <SocialsPost items={socailsPost} />
                </Answer>
                <Answer time={t("common.justNow")}>
                    <SchedulePost />
                </Answer>
                <Answer time={t("common.justNow")}>
                    <ScheduleResult />
                </Answer>
            </Chat>
            <Message
                value={message}
                onChange={(e: any) => setMessage(e.target.value)}
            />
        </Layout>
    );
};

export default GenerationSocialsPostPage;
