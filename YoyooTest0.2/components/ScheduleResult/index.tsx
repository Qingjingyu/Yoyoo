import { useLocale } from "@/contexts/locale-context";

type ScheduleResultProps = {};

const ScheduleResult = ({}: ScheduleResultProps) => {
    const { t } = useLocale();

    return (
        <div className="">
            <div className="mb-3 font-bold">{t("scheduleResult.done")}</div>
            <div className="mb-5">
                {t("scheduleResult.description")}{" "}
                <a
                    className="text-primary-1"
                    href="https://buffer.com/"
                    target="_blank"
                    rel="noopener noreferrer"
                >
                    Buffer
                </a>
                .
            </div>
            <button className="btn-dark btn-small">
                {t("scheduleResult.viewOnBuffer")}
            </button>
        </div>
    );
};

export default ScheduleResult;
