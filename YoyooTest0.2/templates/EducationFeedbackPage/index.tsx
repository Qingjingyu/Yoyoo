"use client";

import { useState } from "react";
import Layout from "@/components/Layout";
import Chat from "@/components/Chat";
import Message from "@/components/Message";
import Question from "@/components/Question";
import Answer from "@/components/Answer";
import Feedback from "@/components/Feedback";
import { useLocale } from "@/contexts/locale-context";

const EducationFeedbackPage = () => {
    const [message, setMessage] = useState<string>("");
    const { t } = useLocale();

    return (
        <Layout>
            <Chat title={t("educationPage.chatTitle")}>
                <Question
                    document="Student-test.pdf"
                    content={t("educationPage.q.prompt")}
                    time={t("common.justNow")}
                />
                <Answer loading />
                <Answer time={t("common.justNow")}>
                    <Feedback />
                </Answer>
            </Chat>
            <Message
                value={message}
                onChange={(e: any) => setMessage(e.target.value)}
                // document="Student-test.pdf"
            />
        </Layout>
    );
};

export default EducationFeedbackPage;
