"use client";

import { useState } from "react";
import Layout from "@/components/Layout";
import Chat from "@/components/Chat";
import Message from "@/components/Message";
import Question from "@/components/Question";
import Answer from "@/components/Answer";
import Services from "@/components/Services";
import Audio from "@/components/Audio";
import { useLocale } from "@/contexts/locale-context";

const AudioGenerationPage = () => {
    const [message, setMessage] = useState<string>("");
    const { t } = useLocale();

    return (
        <Layout>
            <Chat title={t("audioPage.chatTitle")}>
                <Question content={t("audioPage.q.hello")} time={t("common.justNow")} />
                <Answer>{t("audioPage.a.greeting")}</Answer>
                <Question content={t("audioPage.q.showCapabilities")} time={t("common.justNow")} />
                <Answer loading />
                <Answer time={t("common.justNow")}>
                    <Services />
                </Answer>
                <Question
                    content={
                        <>
                            <p>{t("audioPage.q.ttsTitle")}</p>
                            <p>{t("audioPage.q.ttsPrompt")}</p>
                        </>
                    }
                    time={t("common.justNow")}
                />
                <Answer time={t("common.justNow")}>
                    <Audio />
                </Answer>
            </Chat>
            <Message
                value={message}
                onChange={(e: any) => setMessage(e.target.value)}
            />
        </Layout>
    );
};

export default AudioGenerationPage;
