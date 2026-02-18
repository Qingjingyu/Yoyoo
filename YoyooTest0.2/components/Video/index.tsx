import { useState } from "react";
import Select from "@/components/Select";
import Icon from "@/components/Icon";
import { useLocale } from "@/contexts/locale-context";
import View from "./View";

const languages = [
    {
        id: "0",
        title: "video.language.en",
    },
    {
        id: "1",
        title: "video.language.fr",
    },
    {
        id: "2",
        title: "video.language.uk",
    },
];

const voices = [
    {
        id: "0",
        title: "video.voice.jenny",
    },
    {
        id: "1",
        title: "video.voice.mark",
    },
    {
        id: "2",
        title: "video.voice.jack",
    },
];

type VideoProps = {};

const Video = ({}: VideoProps) => {
    const { t } = useLocale();
    const [language, setLanguage] = useState<any>(languages[0]);
    const [voice, setVoice] = useState<any>(voices[0]);

    return (
        <div className="">
            <View />
            <div className="mt-4">
                {t("video.description")}
            </div>
            <div className="flex flex-wrap">
                <button className="btn-dark btn-small mr-4 mt-4">
                    <span>{t("video.download")}</span>
                    <Icon name="download" />
                </button>
                <Select
                    className="mr-4 mt-4"
                    classOptions="min-w-[12rem]"
                    items={languages.map((x) => ({ ...x, title: t(x.title) }))}
                    value={language}
                    onChange={setLanguage}
                    small
                    up
                />
                <Select
                    title={t("video.voiceLabel")}
                    icon="volume"
                    className="mr-4 mt-4"
                    items={voices.map((x) => ({ ...x, title: t(x.title) }))}
                    value={voice}
                    onChange={setVoice}
                    small
                    up
                />
            </div>
        </div>
    );
};

export default Video;
