import Icon from "@/components/Icon";
import { useLocale } from "@/contexts/locale-context";

const details = [
    "checkout.details.item.0",
    "checkout.details.item.1",
    "checkout.details.item.2",
    "checkout.details.item.3",
    "checkout.details.item.4",
];

type DetailsProps = {};

const Details = ({}: DetailsProps) => {
    const { t } = useLocale();

    return (
        <>
            <div className="flex justify-between items-center mb-1">
                <div className="h5 text-[#139843]">
                    {t("checkout.details.enterprise")}
                </div>
                <div className="shrink-0 ml-4 px-3 py-0.5 bg-[#FF97E8] rounded caption1 font-semibold text-n-7">
                    {t("checkout.details.popular")}
                </div>
            </div>
            <div className="base1 font-semibold">
                $399
                <span className="ml-4 text-n-4">
                    {t("checkout.details.monthlyPlan")}
                </span>
            </div>
            <div className="mt-8 pt-8 space-y-5 border-t border-n-4/25 lg:hidden">
                {details.map((x: string, index: number) => (
                    <div className="flex base2" key={index}>
                        <Icon className="mr-3 fill-primary-1" name="check-circle" />
                        {t(x)}
                    </div>
                ))}
            </div>
        </>
    );
};

export default Details;
