import Icon from "@/components/Icon";
import { useLocale } from "@/contexts/locale-context";

type FeaturesProps = {
    items: any;
};

const Features = ({ items }: FeaturesProps) => {
    const { t } = useLocale();

    return (
        <div className="lg:hidden">
            <div className="flex mb-8 h4">
                <div className="w-[14.875rem] h4">{t("pricing.coreFeatures")}</div>
                <div className="hidden flex-1 px-8 2xl:block">
                    {t("pricing.feature.free")}
                </div>
                <div className="hidden flex-1 px-8 text-[#0F9F43] 2xl:block">
                    {t("pricing.feature.pro")}
                </div>
                <div className="hidden flex-1 px-8 text-[#3E90F0] 2xl:block">
                    {t("pricing.feature.enterprise")}
                </div>
            </div>
            <div className="">
                {items.map((item: any) => (
                    <div
                        className="flex items-center py-5 border-t border-n-4/15"
                        key={item.id}
                    >
                        <div className="w-[14.875rem] base2 font-semibold">
                            {t(`pricing.features.${item.id}`)}
                        </div>
                        <div className="flex items-center flex-1 px-8">
                            <Icon
                                className={`${
                                    item.free ? "fill-primary-1" : "fill-n-4"
                                }`}
                                name={item.free ? "check-thin" : "close"}
                            />
                        </div>
                        <div className="flex items-center flex-1 px-8">
                            <Icon
                                className={`${
                                    item.pro ? "fill-primary-1" : "fill-n-4"
                                }`}
                                name={item.pro ? "check-thin" : "close"}
                            />
                            {item.id === "4" && (
                                <div className="ml-3 base2">
                                    {t("pricing.feature.viaEmail")}
                                </div>
                            )}
                        </div>
                        <div className="flex items-center flex-1 px-8">
                            <Icon
                                className={`${
                                    item.enterprise ? "fill-primary-1" : "fill-n-4"
                                }`}
                                name={item.enterprise ? "check-thin" : "close"}
                            />
                            {item.id === "4" && (
                                <div className="ml-3 base2">
                                    {t("pricing.feature.chat247")}
                                </div>
                            )}
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
};

export default Features;
