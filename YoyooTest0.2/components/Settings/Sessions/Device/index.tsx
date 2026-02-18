import Image from "@/components/Image";
import { useLocale } from "@/contexts/locale-context";

type DeviceProps = {
    item: any;
};

const Device = ({ item }: DeviceProps) => {
    const { t } = useLocale();

    return (
        <div className="flex items-start py-6 border-t border-n-3 dark:border-n-6">
            <div className="flex justify-center items-center shrink-0 w-12 h-12 mr-4 px-2 bg-n-3 rounded-xl dark:bg-n-5">
                <Image
                    className="w-full"
                    src={item.image}
                    width={32}
                    height={32}
                    alt=""
                />
            </div>
            <div className="grow">
                <div className="mb-1 base1 font-semibold text-n-6 dark:text-n-3">
                    {item.titleKey ? t(item.titleKey) : item.title}
                </div>
                <div className="base2 text-n-4">
                    <p>{item.address}</p>
                    <p>{item.dateKey ? t(item.dateKey) : item.date}</p>
                </div>
            </div>
            <button className="btn-stroke-light shrink-0 ml-4">
                {t("settings.sessions.revoke")}
            </button>
        </div>
    );
};

export default Device;
