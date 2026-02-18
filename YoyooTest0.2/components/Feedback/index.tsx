import Details from "./Details";
import Assessment from "./Assessment";
import { useLocale } from "@/contexts/locale-context";

type FeedbackProps = {};

const Feedback = ({}: FeedbackProps) => {
    const { t } = useLocale();

    return (
        <div className="">
            <div className="max-w-[38rem] mb-5 bg-n-1 rounded-2xl xl:max-w-full dark:bg-n-6">
                <Details />
                <Assessment />
            </div>
            <div className="mb-5 body1 md:body1S">
                {t("feedback.suggestionTitle")}
            </div>
            <div className="">
                <p className="mb-4">{t("feedback.tip.readRegularly")}</p>
                <p className="mb-4">{t("feedback.tip.practiceWriting")}</p>
                <p className="mb-4">{t("feedback.tip.listenEnglish")}</p>
                <p className="mb-4">{t("feedback.tip.speakNative")}</p>
                <p>{t("feedback.tip.grammarRules")}</p>
            </div>
        </div>
    );
};

export default Feedback;
