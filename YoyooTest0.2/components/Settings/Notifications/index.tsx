import { useState } from "react";
import Switch from "@/components/Switch";
import Checkbox from "@/components/Checkbox";
import { useLocale } from "@/contexts/locale-context";

type NotificationsProps = {};

const Notifications = ({}: NotificationsProps) => {
    const { t } = useLocale();
    const [notifications, setNotifications] = useState<boolean>(true);

    const [checkboxes, setCheckboxes] = useState([
        {
            id: "0",
            titleKey: "settings.notifications.group.platform",
            checkboxs: [
                {
                    id: "0",
                    titleKey: "settings.notifications.item.new",
                    isChecked: true,
                },
                {
                    id: "1",
                    titleKey: "settings.notifications.item.invite",
                    isChecked: true,
                },
                {
                    id: "2",
                    titleKey: "settings.notifications.item.mentioned",
                    isChecked: true,
                },
            ],
        },
        {
            id: "1",
            titleKey: "settings.notifications.group.team",
            checkboxs: [
                {
                    id: "0",
                    titleKey: "settings.notifications.item.new",
                    isChecked: false,
                },
                {
                    id: "1",
                    titleKey: "settings.notifications.item.invite",
                    isChecked: false,
                },
                {
                    id: "2",
                    titleKey: "settings.notifications.item.mentioned",
                    isChecked: true,
                },
            ],
        },
        {
            id: "2",
            titleKey: "settings.notifications.group.app",
            checkboxs: [
                {
                    id: "0",
                    titleKey: "settings.notifications.item.mentioned",
                    isChecked: true,
                },
            ],
        },
    ]);

    const handleCheckboxChange = (groupId: string, checkboxId: string) => {
        const updatedCheckboxes = [...checkboxes];
        const groupIndex = updatedCheckboxes.findIndex(
            (group) => group.id === groupId
        );
        const checkboxIndex = updatedCheckboxes[groupIndex].checkboxs.findIndex(
            (checkbox) => checkbox.id === checkboxId
        );
        updatedCheckboxes[groupIndex].checkboxs[checkboxIndex].isChecked =
            !updatedCheckboxes[groupIndex].checkboxs[checkboxIndex].isChecked;
        setCheckboxes(updatedCheckboxes);
    };

    const handleNotificationsChange = (value: boolean) => {
        setNotifications(value);
        const updatedCheckboxes = [...checkboxes];
        for (let group of updatedCheckboxes) {
            for (let checkbox of group.checkboxs) {
                checkbox.isChecked = value;
            }
        }
        setCheckboxes(updatedCheckboxes);
    };

    return (
        <form className="" action="" onSubmit={(event) => event.preventDefault()}>
            <div className="flex items-center mb-8">
                <div className="mr-auto h4">{t("settings.notifications.title")}</div>
                <Switch
                    value={notifications}
                    setValue={handleNotificationsChange}
                />
            </div>
            <div>
                {checkboxes.map((group) => (
                    <div
                        className="mb-8 border-t border-n-3 py-6 last:mb-0 dark:border-n-6"
                        key={group.id}
                    >
                        <div className="mb-4 h6">{t(group.titleKey)}</div>
                        {group.checkboxs.map((checkbox) => (
                            <Checkbox
                                className="mb-4 last:mb-0"
                                label={t(checkbox.titleKey)}
                                key={checkbox.id}
                                value={checkbox.isChecked}
                                onChange={() =>
                                    handleCheckboxChange(group.id, checkbox.id)
                                }
                                reverse
                            />
                        ))}
                    </div>
                ))}
            </div>
        </form>
    );
};

export default Notifications;
