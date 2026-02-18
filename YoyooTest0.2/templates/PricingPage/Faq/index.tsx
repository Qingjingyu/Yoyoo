import FaqItem from "@/components/FaqItem";
import { useLocale } from "@/contexts/locale-context";

import { faqPricing } from "@/mocks/faq";

type FaqProps = {};

const Faq = ({}: FaqProps) => {
    const { t } = useLocale();
    const tr = (key: string, fallback: string) => {
        const value = t(key);
        return value === key ? fallback : value;
    };

    return (
        <div className="py-32 px-15 2xl:py-20 2xl:px-10 xl:px-8 dark:bg-n-7/25">
            <div className="max-w-[47.75rem] mx-auto">
                <div className="mb-12 text-center h3 lg:h4">
                    {t("pricing.faq.title")}
                </div>
                <div>
                    {faqPricing.map((x) => (
                        <FaqItem
                            item={{
                                ...x,
                                title: tr(`pricingFaq.item.${x.id}.title`, x.title),
                                content: tr(
                                    `pricingFaq.item.${x.id}.content`,
                                    x.content
                                ),
                            }}
                            key={x.id}
                        />
                    ))}
                </div>
            </div>
        </div>
    );
};

export default Faq;
