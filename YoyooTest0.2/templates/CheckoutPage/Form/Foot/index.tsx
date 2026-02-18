import Link from "next/link";
import Icon from "@/components/Icon";
import { useLocale } from "@/contexts/locale-context";

type FootProps = {};

const Foot = ({}: FootProps) => {
    const { t } = useLocale();

    return (
        <div className="">
            <div className="flex items-center mb-6 caption1 text-n-4/50">
                <Icon className="w-4 h-4 mr-2 fill-[#0C923C]" name="lock" />
                {t("checkout.foot.securedForm")}
            </div>
            <div className="text-right">
                <div className="h4">{t("checkout.foot.billedNow")}</div>
                <button
                    className="mb-4 base2 font-semibold text-primary-1 transition-colors hover:text-primary-1/90"
                    type="button"
                >
                    {t("checkout.foot.applyPromo")}
                </button>
                <div className="max-w-[27rem] ml-auto mb-4 caption1 text-n-4/50 dark:text-n-4/75">
                    {t("checkout.foot.agreeText")}
                </div>
                <Link
                    href="/thanks"
                    className="btn-blue md:w-full"
                    type="submit"
                >
                    {t("checkout.foot.startPlan")}
                </Link>
            </div>
        </div>
    );
};

export default Foot;
