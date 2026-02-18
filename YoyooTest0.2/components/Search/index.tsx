import { useMemo, useState } from "react";
import Icon from "@/components/Icon";
import Select from "@/components/Select";
import Item from "./Item";
import { useLocale } from "@/contexts/locale-context";

type ItemsType = {
    id: string;
    author: string;
    title: string;
    content: string;
    time: string;
    avatar: string;
    online: boolean;
    url: string;
};

type SearchType = {
    id: string;
    title: string;
    date?: string;
    list: ItemsType[];
};

type SearchProps = {
    items: SearchType[];
};

const Search = ({ items }: SearchProps) => {
    const { t } = useLocale();
    const createdOptions = useMemo(
        () => [
            {
                id: "0",
                title: t("search.created.video"),
            },
            {
                id: "1",
                title: t("search.created.audio"),
            },
            {
                id: "2",
                title: t("search.created.code"),
            },
        ],
        [t]
    );

    const dates = useMemo(
        () => [
            {
                id: "0",
                title: t("search.date.today"),
            },
            {
                id: "1",
                title: t("search.date.lastWeek"),
            },
            {
                id: "2",
                title: t("search.date.last30Days"),
            },
        ],
        [t]
    );

    const [search, setSearch] = useState<string>("");
    const [searchTitle, setSearchTitle] = useState<string>("");
    const [createdBy, setCreatedBy] = useState<any>();
    const [date, setDate] = useState<any>();

    return (
        <form className="" action="" onSubmit={(event) => event.preventDefault()}>
            <div className="relative border-b border-n-3 dark:border-n-6">
                <button
                    className="group absolute top-7 left-10 outline-none md:hidden"
                    type="submit"
                >
                    <Icon
                        className="w-8 h-8 fill-n-4/50 transition-colors group-hover:fill-n-7 dark:group-hover:fill-n-3"
                        name="search-1"
                    />
                </button>
                <input
                    className="w-full h-22 pl-24 pr-5 bg-transparent border-none outline-none h5 text-n-7 placeholder:text-n-4/50 md:h-18 md:pl-18 dark:text-n-1"
                    type="text"
                    name="search"
                    placeholder={t("search.placeholderMain")}
                    value={search}
                    onChange={(e: any) => setSearch(e.target.value)}
                />
            </div>
            <div className="pt-5 px-10 pb-6 md:px-6">
                <div className="flex mb-5 md:block md:space-y-4 md:mb-0">
                    <div className="relative w-[10.31rem] mr-3 md:w-full md:mr-0">
                        <button
                            className="group absolute top-3 left-4 text-0"
                            type="submit"
                        >
                            <Icon
                                className="w-5 h-5 fill-n-7 transition-colors group-hover:fill-primary-1 dark:fill-n-1"
                                name="search-1"
                            />
                        </button>
                        <input
                            className="w-full h-11 pl-11 pr-4 bg-transparent shadow-[inset_0_0_0_0.0625rem_#DADBDC] rounded-full outline-none caption1 text-n-7 transition-shadow focus:shadow-[inset_0_0_0_0.125rem_#0084FF] placeholder:text-n-4 dark:shadow-[inset_0_0_0_0.0625rem_#2A2E2F] dark:text-n-1 dark:focus:shadow-[inset_0_0_0_0.125rem_#0084FF]"
                            type="text"
                            name="search"
                            placeholder={t("search.placeholderKeyword")}
                            value={searchTitle}
                            onChange={(e: any) =>
                                setSearchTitle(e.target.value)
                            }
                        />
                    </div>
                    <Select
                        className="w-[10.31rem] mr-3 md:w-full md:mr-0"
                        classButton="h-11 rounded-full shadow-[inset_0_0_0_0.0625rem_#DADBDC] caption1 dark:shadow-[inset_0_0_0_0.0625rem_#2A2E2F] dark:bg-transparent"
                        classOptions="min-w-full"
                        classIcon="w-5 h-5 fill-n-4/50"
                        classArrow="dark:fill-n-4"
                        icon="user-check"
                        placeholder={t("search.createdBy")}
                        items={createdOptions}
                        value={createdBy}
                        onChange={setCreatedBy}
                    />
                    <Select
                        className="w-[10.31rem] md:w-full md:mr-0"
                        classButton="h-11 rounded-full shadow-[inset_0_0_0_0.0625rem_#DADBDC] caption1 dark:shadow-[inset_0_0_0_0.0625rem_#2A2E2F] dark:bg-transparent"
                        classOptions="min-w-full"
                        classIcon="w-5 h-5 fill-n-4/50"
                        classArrow="dark:fill-n-4"
                        icon="clock"
                        placeholder={t("search.date")}
                        items={dates}
                        value={date}
                        onChange={setDate}
                    />
                </div>
                <div>
                    {items.map((x) => (
                        <Item item={x} key={x.id} />
                    ))}
                </div>
            </div>
        </form>
    );
};

export default Search;
