"use client";

import Link from "next/link";
import { useLocale } from "@/contexts/locale-context";

const items = [
    {
        key: "pagelist.home",
        url: "/",
    },
    {
        key: "pagelist.codeGeneration",
        url: "/code-generation",
    },
    {
        key: "pagelist.photoEditing",
        url: "/photo-editing",
    },
    {
        key: "pagelist.videoGeneration",
        url: "/video-generation",
    },
    {
        key: "pagelist.audioGeneration",
        url: "/audio-generation",
    },
    {
        key: "pagelist.generationSocialsPost",
        url: "/generation-socials-post",
    },
    {
        key: "pagelist.educationFeedback",
        url: "/education-feedback",
    },
    {
        key: "pagelist.pricing",
        url: "/pricing",
    },
    {
        key: "pagelist.checkout",
        url: "/checkout",
    },
    {
        key: "pagelist.thankYou",
        url: "/thanks",
    },
    {
        key: "pagelist.signIn",
        url: "/sign-in",
    },
    {
        key: "pagelist.updatesFaq",
        url: "/updates-and-faq",
    },
    {
        key: "pagelist.applications",
        url: "/applications",
    },
    {
        key: "pagelist.moduleLibrary",
        url: "/module-library",
    },
];

const PageListPage = () => {
    const { t } = useLocale();

    return (
        <div className="flex flex-col items-start px-12 py-8 text-xl">
            {items.map((item, index) => (
                <Link
                    className="text-n-1 transition-colors hover:text-primary-1 md:text-n-7 dark:text-n-1"
                    href={item.url}
                    key={index}
                >
                    {t(item.key)}
                </Link>
            ))}
        </div>
    );
};

export default PageListPage;
