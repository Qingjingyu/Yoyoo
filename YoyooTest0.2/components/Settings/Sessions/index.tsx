import Device from "./Device";
import { useLocale } from "@/contexts/locale-context";

const devices = [
    {
        id: "0",
        titleKey: "settings.sessions.device.chromeIphone",
        image: "/images/chrome.svg",
        address: "222.225.225.222",
        dateKey: "settings.sessions.dateSignedIn",
    },
    {
        id: "1",
        titleKey: "settings.sessions.device.chromeMacbook",
        image: "/images/chrome.svg",
        address: "222.225.225.222",
        dateKey: "settings.sessions.dateSignedIn",
    },
    {
        id: "2",
        titleKey: "settings.sessions.device.safariMacbook",
        image: "/images/safari.svg",
        address: "222.225.225.222",
        dateKey: "settings.sessions.dateSignedIn",
    },
];

type SessionsProps = {};

const Sessions = ({}: SessionsProps) => {
    const { t } = useLocale();

    return (
        <>
            <div className="mb-8 h4 md:mb-6">{t("settings.sessions.title")}</div>
            <div className="mb-8 base2 text-n-4 md:mb-6">
                {t("settings.sessions.description")}
            </div>
            <div className="py-3 base2 text-n-4">{t("settings.sessions.devices")}</div>
            <div className="mb-6">
                {devices.map((device) => (
                    <Device item={device} key={device.id} />
                ))}
            </div>
            <button className="btn-blue w-full">
                {t("settings.sessions.signOutAll")}
            </button>
        </>
    );
};

export default Sessions;
