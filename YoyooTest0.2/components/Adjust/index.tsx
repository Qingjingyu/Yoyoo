import Image from "@/components/Image";
import SliderRange from "@/components/SliderRange";
import { useLocale } from "@/contexts/locale-context";

type AdjustProps = {
    image: string;
};

const Adjust = ({ image }: AdjustProps) => {
    const { t } = useLocale();

    return (
        <div className="">
            <div className="relative h-48">
                <Image
                    className="mb-6 rounded-md object-cover"
                    src={image}
                    fill
                    sizes="(max-width: 768px) 100vw, 25vw"
                    alt=""
                />
            </div>
            <div className="mt-6">
                <SliderRange className="mb-2" title={t("adjust.exposure")} />
                <SliderRange className="mb-2" title={t("adjust.contrast")} />
                <SliderRange className="mb-2" title={t("adjust.highlights")} />
                <SliderRange className="mb-2" title={t("adjust.shadows")} />
                <SliderRange className="mb-2" title={t("adjust.white")} />
                <SliderRange className="" title={t("adjust.blacks")} />
            </div>
            <div className="flex space-x-3 mt-6">
                <button className="btn-blue w-full">{t("adjust.auto")}</button>
                <button className="btn-stroke-light w-full">
                    {t("adjust.reset")}
                </button>
            </div>
        </div>
    );
};

export default Adjust;
