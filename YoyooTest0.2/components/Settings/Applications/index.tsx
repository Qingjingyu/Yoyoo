import Link from "next/link";
import Application from "./Application";
import { useLocale } from "@/contexts/locale-context";

import { applications } from "@/mocks/applications";

type ApplicationsProps = {};

const Applications = ({}: ApplicationsProps) => {
    const { t } = useLocale();

    return (
        <>
            <div className="flex items-center mb-8">
                <div className="mr-auto h4">{t("settings.applications.title")}</div>
                <Link className="btn-blue" href="/applications">
                    {t("settings.applications.addApps")}
                </Link>
            </div>
            <div className="py-3 base2 text-n-4">
                {t("settings.applications.authorizedApps")}
            </div>
            <div className="mb-6">
                {applications
                    .filter((x: any) => x.installed === true)
                    .map((application) => (
                        <Application item={application} key={application.id} />
                    ))}
            </div>
        </>
    );
};

export default Applications;
