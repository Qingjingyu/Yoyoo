import { twMerge } from "tailwind-merge";
import Icon from "@/components/Icon";
import Notifications from "./Notifications";
import Profile from "./Profile";
import { useLocale } from "@/contexts/locale-context";
import { notifications } from "@/mocks/notifications";

type RightSidebarProps = {
    className?: string;
    visible?: boolean;
};

const RightSidebar = ({ className, visible }: RightSidebarProps) => {
    const { t } = useLocale();

    return (
        <div
            className={twMerge(
                `absolute top-0 right-0 bottom-0 flex flex-col w-[22.5rem] pt-[5.5rem] pb-6 bg-n-1 rounded-r-[1.25rem] border-l border-n-3 shadow-[inset_0_1.5rem_3.75rem_rgba(0,0,0,0.1)] 2xl:w-80 lg:rounded-[1.25rem] lg:invisible lg:opacity-0 lg:transition-opacity lg:z-20 lg:border-l-0 lg:shadow-2xl md:fixed md:w-[calc(100%-4rem)] md:border-l md:rounded-none dark:bg-n-6 dark:border-n-5 ${
                    visible && "lg:visible lg:opacity-100"
                } ${className}`
            )}
        >
            <div className="absolute top-0 left-0 right-0 flex justify-end items-center h-18 px-9 border-b border-n-3 lg:pr-18 md:pr-16 dark:border-n-5">
                <Notifications items={notifications} />
                <Profile />
            </div>

            <div className="grow overflow-y-auto scroll-smooth px-6 md:px-3">
                <div className="h-full flex flex-col items-center justify-center text-center px-4">
                    <div className="w-14 h-14 rounded-2xl bg-n-3/60 dark:bg-n-5 flex items-center justify-center">
                        <Icon className="fill-n-4" name="chat-1" />
                    </div>
                    <div className="mt-4 base2 font-semibold text-n-2">
                        {t("rightSidebar.emptyState.title")}
                    </div>
                    <div className="mt-2 caption1 text-n-4 max-w-[16rem]">
                        {t("rightSidebar.emptyState.desc")}
                    </div>
                </div>
            </div>
        </div>
    );
};

export default RightSidebar;
