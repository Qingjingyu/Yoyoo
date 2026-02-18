"use client";

import { useState } from "react";
import Layout from "@/components/Layout";
import Chat from "@/components/Chat";
import Message from "@/components/Message";
import Question from "@/components/Question";
import Answer from "@/components/Answer";
import Photo from "@/components/Photo";
import { useLocale } from "@/contexts/locale-context";

const PhotoEditingPage = () => {
    const [message, setMessage] = useState<string>("");
    const { t } = useLocale();

    return (
        <Layout>
            <Chat title={t("photoPage.chatTitle")}>
                <Question
                    content={t("photoPage.q.retouch")}
                    time={t("common.justNow")}
                    image="/images/photo.jpg"
                />
                <Answer loading />
                <Answer time={t("common.justNow")}>
                    <Photo
                        image="/images/photo-1.jpg"
                        content={t("photoPage.a.retouchDone")}
                    />
                </Answer>
                <Question
                    content={t("photoPage.q.removeTextBlue")}
                    time={t("common.justNow")}
                />
                <Answer time={t("common.justNow")}>
                    <Photo
                        image="/images/photo-2.jpg"
                        content={t("photoPage.a.adjustColor")}
                        colorPicker
                    />
                </Answer>
                <Answer time={t("common.justNow")}>
                    <Photo
                        image="/images/photo-3.jpg"
                        content={t("photoPage.a.variationOne")}
                    />
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

export default PhotoEditingPage;
