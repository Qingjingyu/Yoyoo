import { useState } from "react";
import { useMediaQuery } from "react-responsive";
import Select from "@/components/Select";
import Menu from "./Menu";
import EditProfile from "./EditProfile";
import Password from "./Password";
import Notifications from "./Notifications";
import ChatExport from "./ChatExport";
import Sessions from "./Sessions";
import Applications from "./Applications";
import Team from "./Team";
import Appearance from "./Appearance";
import DeleteAccount from "./DeleteAccount";
import { useLocale } from "@/contexts/locale-context";

type SettingsType = {
    id: string;
    title: string;
    icon: string;
};

type SettingsProps = {
    items: SettingsType[];
    activeItem?: number;
};

const Settings = ({ items, activeItem }: SettingsProps) => {
    const { t } = useLocale();
    const [activeId, setActiveId] = useState<string>(
        items[activeItem || 0]?.id || items[0]?.id
    );
    const localizedItems = items.map((item) => ({
        ...item,
        title: t(`settings.${item.id}`),
    }));
    const active =
        localizedItems.find((item) => item.id === activeId) || localizedItems[0];

    const isMobile = useMediaQuery({
        query: "(max-width: 767px)",
    });

    return (
        <div className="p-12 lg:px-8 md:pt-16 md:px-5 md:pb-8">
            <div className="flex md:block">
                {isMobile ? (
                    <Select
                        className="mb-6"
                        classButton="dark:bg-transparent"
                        classArrow="dark:fill-n-4"
                        items={localizedItems}
                        value={active}
                        onChange={(item: SettingsType) => setActiveId(item.id)}
                    />
                ) : (
                    <div className="shrink-0 w-[13.25rem]">
                        <Menu
                            value={active}
                            setValue={setActiveId}
                            buttons={localizedItems}
                        />
                    </div>
                )}
                <div className="grow pl-12 md:pl-0">
                    {activeId === "edit-profile" && <EditProfile />}
                    {activeId === "password" && <Password />}
                    {activeId === "notifications" && <Notifications />}
                    {activeId === "chat-export" && <ChatExport />}
                    {activeId === "sessions" && <Sessions />}
                    {activeId === "applications" && <Applications />}
                    {activeId === "team" && <Team />}
                    {activeId === "appearance" && <Appearance />}
                    {activeId === "delete-account" && <DeleteAccount />}
                </div>
            </div>
        </div>
    );
};

export default Settings;
