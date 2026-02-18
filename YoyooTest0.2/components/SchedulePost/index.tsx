import { useEffect, useState } from "react";
import DatePicker from "react-datepicker";
import Icon from "@/components/Icon";
import { useLocale } from "@/contexts/locale-context";
import "react-datepicker/dist/react-datepicker.css";

type SchedulePostProps = {};

const SchedulePost = ({}: SchedulePostProps) => {
    const { t } = useLocale();
    const [hydrated, setHydrated] = useState<boolean>(false);
    const [startDate, setStartDate] = useState<Date | null>(null);
    const [selectedTime, setSelectedTime] = useState<Date | null>(null);

    useEffect(() => {
        const now = new Date();
        setStartDate(now);
        setSelectedTime(now);
        setHydrated(true);
    }, []);

    const isPastDate = (date: any) => {
        const today = new Date();
        return date < today;
    };

    const dayClassName = (date: any) => {
        return isPastDate(date) ? "past" : "";
    };

    if (!hydrated) {
        return (
            <div>
                <div className="mb-5 font-bold">{t("schedulePost.title")}</div>
                <div className="p-5 bg-n-1 rounded-xl dark:bg-n-6">
                    <div className="h-12 rounded-xl bg-n-2 dark:bg-n-5/60"></div>
                </div>
            </div>
        );
    }

    return (
        <div>
            <div className="mb-5 font-bold">{t("schedulePost.title")}</div>
            <div className="p-5 bg-n-1 rounded-xl dark:bg-n-6">
                <div className="flex mb-4 space-x-4 md:block md:space-x-0">
                    <div className="basis-1/2 md:mb-4">
                        <div className="mb-2 base2 font-semibold">{t("schedulePost.chooseDate")}</div>
                        <div className="relative">
                            <DatePicker
                                className="w-full h-12 pl-[2.625rem] border-2 border-n-4/25 bg-transparent rounded-xl font-inter base2 text-n-6 outline-none transition-colors focus:border-primary-1 dark:text-n-3"
                                dateFormat="dd MMMM yyyy"
                                selected={startDate}
                                onChange={(date: any) => setStartDate(date)}
                                formatWeekDay={(nameOfDay) =>
                                    nameOfDay.toString().slice(0, 1)
                                }
                                dayClassName={dayClassName}
                            />
                            <Icon
                                className="absolute top-3 left-3 fill-n-6 pointer-events-none dark:fill-n-3"
                                name="calendar"
                            />
                        </div>
                    </div>
                    <div className="basis-1/2">
                        <div className="mb-2 base2 font-semibold">{t("schedulePost.time")}</div>
                        <div className="relative">
                            <DatePicker
                                className="w-full h-12 pl-[2.625rem] border-2 border-n-4/25 bg-transparent rounded-xl font-inter base2 text-n-6 outline-none transition-colors focus:border-primary-1 dark:text-n-3"
                                selected={selectedTime}
                                onChange={(time: any) => setSelectedTime(time)}
                                showTimeSelect
                                showTimeSelectOnly
                                timeIntervals={30}
                                dateFormat="h:mm aa"
                            />
                            <Icon
                                className="absolute top-3 left-3 fill-n-6 pointer-events-none dark:fill-n-3"
                                name="time"
                            />
                        </div>
                    </div>
                </div>
                <div className="flex items-center mb-4 text-n-4/50 caption1 font-semibold dark:text-n-4">
                    <Icon
                        className="w-4 h-4 mr-3 fill-n-4/50 dark:text-n-4"
                        name="info-circle"
                    />
                    {t("schedulePost.timezoneNote")}
                </div>
                <div className="text-right">
                    <button className="btn-dark md:w-full">{t("schedulePost.schedule")}</button>
                </div>
            </div>
        </div>
    );
};

export default SchedulePost;
