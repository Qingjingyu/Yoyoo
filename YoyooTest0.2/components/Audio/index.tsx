import { useState } from "react";
import AudioPlayer from "@/components/AudioPlayer";
import Actions from "@/components/Actions";
import Export from "@/components/Export";
import Select from "@/components/Select";
import Icon from "@/components/Icon";
import { useLocale } from "@/contexts/locale-context";

const languages = [
    {
        id: "0",
        title: "English (United States)",
        titleKey: "video.language.en",
    },
    {
        id: "1",
        title: "French",
        titleKey: "video.language.fr",
    },
    {
        id: "2",
        title: "Ukrainian",
        titleKey: "video.language.uk",
    },
];

const speeds = [
    {
        id: "0",
        title: "Normal",
        titleKey: "audio.speed.normal",
    },
    {
        id: "1",
        title: "1.25x",
        titleKey: "audio.speed.125",
    },
    {
        id: "2",
        title: "1.5x",
        titleKey: "audio.speed.150",
    },
];

const genders = [
    {
        id: "0",
        title: "Female",
        titleKey: "audio.gender.female",
    },
    {
        id: "1",
        title: "Male",
        titleKey: "audio.gender.male",
    },
];

const voices = [
    {
        id: "0",
        title: "Jenny",
        titleKey: "video.voice.jenny",
    },
    {
        id: "1",
        title: "Mark",
        titleKey: "video.voice.mark",
    },
    {
        id: "2",
        title: "Jack",
        titleKey: "video.voice.jack",
    },
];

const smiles = [
    {
        id: "0",
        title: "😀 Friendly",
        titleKey: "audio.mood.friendly",
    },
    {
        id: "1",
        title: "😐 Neutral",
        titleKey: "audio.mood.neutral",
    },
    {
        id: "2",
        title: "😚 Kissing",
        titleKey: "audio.mood.kissing",
    },
];

type AudioProps = {};

const Audio = ({}: AudioProps) => {
    const [edit, setEdit] = useState<boolean>(false);
    const [language, setLanguage] = useState<any>(languages[0]);
    const [speed, setSpeed] = useState<any>(speeds[0]);
    const [gender, setGender] = useState<any>(genders[0]);
    const [voice, setVoice] = useState<any>(voices[0]);
    const [smile, setSmile] = useState<any>(smiles[0]);
    const { t } = useLocale();

    const localizeItems = (items: any[]) =>
        items.map((item) => ({
            ...item,
            title: t(item.titleKey),
        }));
    const localizedLanguages = localizeItems(languages);
    const localizedSpeeds = localizeItems(speeds);
    const localizedGenders = localizeItems(genders);
    const localizedVoices = localizeItems(voices);
    const localizedSmiles = localizeItems(smiles);

    return (
        <div className="">
            <div className="mb-4">
                {t("audio.description")}
            </div>
            <AudioPlayer edit={edit} onSave={() => setEdit(false)} />
            <div className="flex flex-wrap">
                <Actions
                    className="mr-4 mt-4 md:w-[calc(50%-0.5rem)] md:mr-2"
                    title={t("audio.exportingOne")}
                    classButton="btn-dark md:w-full"
                    classTitle="pl-3"
                    buttonInner={
                        <>
                            <span>{t("audio.export")}</span>
                            <Icon name="share" />
                        </>
                    }
                >
                    <Export />
                </Actions>
                <button
                    className="btn-white btn-small mr-4 mt-4 md:w-[calc(50%-0.5rem)] md:mr-0 md:ml-2"
                    onClick={() => setEdit(true)}
                >
                    <span>{t("audio.edit")}</span>
                    <Icon name="edit" />
                </button>
                <Select
                    className="mr-4 mt-4 md:w-full md:mr-0"
                    items={localizedLanguages}
                    value={
                        localizedLanguages.find((item) => item.id === language.id) ??
                        localizedLanguages[0]
                    }
                    onChange={setLanguage}
                    small
                    up
                />
                <Select
                    className="mr-4 mt-4 md:w-full md:mr-0"
                    title={t("audio.speedLabel")}
                    items={localizedSpeeds}
                    value={
                        localizedSpeeds.find((item) => item.id === speed.id) ??
                        localizedSpeeds[0]
                    }
                    onChange={setSpeed}
                    small
                    up
                />
                <div className="flex mr-4 mt-4 rounded-md shadow-[0_0.125rem_0.25rem_rgba(0,0,0,0.15)] bg-n-1 md:w-full md:mr-0 dark:bg-n-6 dark:shadow-[0_0.125rem_0.25rem_rgba(0,0,0,0.15),inset_0_0_0_0.0625rem_rgba(254,254,254,.1)]">
                    <Select
                        classButton="shadow-none bg-transparent ui-open:shadow-none dark:bg-transparent dark:shadow-none"
                        title={t("audio.voiceLabel")}
                        items={localizedGenders}
                        value={
                            localizedGenders.find((item) => item.id === gender.id) ??
                            localizedGenders[0]
                        }
                        onChange={setGender}
                        small
                        up
                    />
                    <div className="self-center w-0.25 h-6 bg-n-3 dark:bg-n-4/50"></div>
                    <Select
                        classButton="shadow-none bg-transparent ui-open:shadow-none dark:bg-transparent dark:shadow-none"
                        icon="volume"
                        className=""
                        items={localizedVoices}
                        value={
                            localizedVoices.find((item) => item.id === voice.id) ??
                            localizedVoices[0]
                        }
                        onChange={setVoice}
                        small
                        up
                    />
                </div>
                <Select
                    className="mr-4 mt-4 md:w-full md:mr-0"
                    items={localizedSmiles}
                    value={
                        localizedSmiles.find((item) => item.id === smile.id) ??
                        localizedSmiles[0]
                    }
                    onChange={setSmile}
                    small
                    up
                />
            </div>
        </div>
    );
};

export default Audio;
