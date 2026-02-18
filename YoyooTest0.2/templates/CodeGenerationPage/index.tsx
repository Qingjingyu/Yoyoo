"use client";

import { useState } from "react";
import Layout from "@/components/Layout";
import Chat from "@/components/Chat";
import Message from "@/components/Message";
import Question from "@/components/Question";
import Answer from "@/components/Answer";
import Code from "@/components/Code";
import { useLocale } from "@/contexts/locale-context";

import { writeCodeChat } from "@/mocks/writeCodeChat";

const CodeGenerationPage = () => {
    const [message, setMessage] = useState<string>("");
    const { t } = useLocale();

    return (
        <Layout>
            <Chat title={t("codePage.chatTitle")}>
                <Question
                    content={t("codePage.q.prompt")}
                    time={t("common.justNow")}
                />
                <Answer loading />
                <Answer time={t("common.justNow")}>
                    <Code items={writeCodeChat} />
                </Answer>
            </Chat>
            <Message
                value={message}
                onChange={(e: any) => setMessage(e.target.value)}
            />
        </Layout>
    );
};

export default CodeGenerationPage;
