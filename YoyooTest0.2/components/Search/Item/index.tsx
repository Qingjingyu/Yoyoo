import Link from "next/link";
import Image from "@/components/Image";
import { useLocale } from "@/contexts/locale-context";

type ItemProps = {
    item: any;
};

const Item = ({ item }: ItemProps) => {
    const { t } = useLocale();
    const tr = (key: string, fallback: string) => {
        const value = t(key);
        return value === key ? fallback : value;
    };
    const groupBase = `search.group.${item.id}`;

    return (
        <div className="">
            <div className="flex items-center py-3 md:pt-6">
                <div className="h6">{tr(`${groupBase}.title`, item.title)}</div>
                <div className="ml-5 caption1 text-n-4/75">{item.date}</div>
            </div>
            <div className="-mx-5 md:mx-0">
                {item.list.map((x: any) => (
                    <Link
                        className="group relative flex items-center pl-5 py-5 pr-24 rounded-xl transition-colors hover:bg-n-3/50 md:!bg-transparent md:py-0 md:pl-0 md:pr-18 md:mb-6 md:last:mb-0 dark:hover:bg-n-6 dark:md:hover:bg-transparent"
                        key={x.id}
                        href={x.url}
                    >
                        <div className="relative shrink-0 w-12 h-12">
                            <Image
                                className="rounded-full object-cover"
                                src={x.avatar}
                                fill
                                alt="Avatar"
                            />
                            {x.online && (
                                <div className="absolute -right-0.25 -bottom-0.25 w-4.5 h-4.5 bg-primary-2 rounded-full border-4 border-n-1 transition-colors group-hover:border-[#F3F5F7] dark:border-n-7 dark:group-hover:border-n-6"></div>
                            )}
                        </div>
                        <div className="w-[calc(100%-3rem)] pl-5">
                            <div className="mb-1 truncate base1 font-semibold">
                                {tr(`${groupBase}.item.${x.id}.title`, x.title)}
                            </div>
                            <div className="truncate caption1 text-n-4/75">
                                {tr(`${groupBase}.item.${x.id}.content`, x.content)}
                            </div>
                        </div>
                        <div className="absolute top-1/2 right-5 -translate-y-1/2 caption1 text-n-4/50 group-hover:hidden md:right-0">
                            {tr(`${groupBase}.item.${x.id}.time`, x.time)}
                        </div>
                        <div className="absolute top-1/2 right-5 -translate-y-1/2 px-2 rounded bg-n-1 caption1 font-semibold text-n-4 hidden group-hover:block md:right-0 dark:bg-n-5 dark:text-n-3">
                            {t("search.item.jump")}
                        </div>
                        <div className="absolute top-1/2 -translate-y-1/2 left-full flex items-center ml-9 px-3 py-2 bg-n-7 rounded-lg whitespace-nowrap text-n-4 base2 invisible opacity-0 transition-all group-hover:visible group-hover:opacity-100 2xl:hidden dark:bg-n-2">
                            {t("search.item.lastEditedBy")}{" "}
                            <div className="relative shrink-0 w-5 h-5 mx-2">
                                <Image
                                    className="rounded-full object-cover"
                                    src={x.avatar}
                                    fill
                                    alt="Avatar"
                                />
                            </div>
                            <span className="mr-2 font-semibold text-n-1 dark:text-n-7">
                                {x.author}
                            </span>
                            {tr(`${groupBase}.item.${x.id}.time`, x.time)}
                        </div>
                    </Link>
                ))}
            </div>
        </div>
    );
};

export default Item;
