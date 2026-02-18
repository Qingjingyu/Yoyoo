import FaqItem from "@/components/FaqItem";
import Image from "@/components/Image";
import { useLocale } from "@/contexts/locale-context";

type FaqItems = {
    id: string;
    title: string;
    content: string;
    defaultOpen: boolean;
};

type FaqProps = {
    items: FaqItems[];
};

const Faq = ({ items }: FaqProps) => {
    const { t } = useLocale();
    const tr = (key: string, fallback: string) => {
        const value = t(key);
        return value === key ? fallback : value;
    };

    return (
        <>
            <div>
                {items.map((x) => (
                    <FaqItem
                        item={{
                            ...x,
                            title: tr(`faqs.item.${x.id}.title`, x.title),
                            content: tr(`faqs.item.${x.id}.content`, x.content),
                        }}
                        key={x.id}
                    />
                ))}
            </div>
            <div className="mt-12 p-20 bg-n-2/50 rounded-[1.25rem] text-center md:py-16 md:px-8 dark:bg-n-7/50">
                <div className="w-28 mx-auto mb-8">
                    <Image
                        src="/images/faq-image.svg"
                        width={112}
                        height={112}
                        alt=""
                    />
                </div>
                <div className="mb-1 h5">{t("updatesFaq.emptyTitle")}</div>
                <div className="mb-8 base1 text-n-4">
                    {t("updatesFaq.emptySubtitle")}
                </div>
                <button className="btn-blue">{t("updatesFaq.askBtn")}</button>
            </div>
        </>
    );
};

export default Faq;
