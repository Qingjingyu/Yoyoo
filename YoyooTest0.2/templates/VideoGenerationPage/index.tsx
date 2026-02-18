"use client";

import { useState } from "react";
import Layout from "@/components/Layout";
import Chat from "@/components/Chat";
import Message from "@/components/Message";
import Question from "@/components/Question";
import Answer from "@/components/Answer";
import Video from "@/components/Video";
import { useLocale } from "@/contexts/locale-context";

const VideoGenerationPage = () => {
    const [message, setMessage] = useState<string>("");
    const { t } = useLocale();

    return (
        <Layout>
            <Chat title={t("videoPage.chatTitle")}>
                <Question
                    content={
                        <>
                            <p>{t("videoPage.q.title")}</p>
                            <br></br>
                            <p>{t("videoPage.q.prompt")}</p>
                        </>
                    }
                    time={t("common.justNow")}
                    image="/images/video-pic.jpg"
                />
                <Answer loading />
                <Answer time={t("common.justNow")}>
                    <Video />
                </Answer>
            </Chat>
            <Message
                value={message}
                onChange={(e: any) => setMessage(e.target.value)}
                // image="/images/photo.jpg"
            />
        </Layout>
    );
};

export default VideoGenerationPage;
