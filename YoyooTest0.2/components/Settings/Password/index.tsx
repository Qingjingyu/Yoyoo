import { useState } from "react";
import Field from "@/components/Field";
import { useLocale } from "@/contexts/locale-context";

type PasswordProps = {};

const Password = ({}: PasswordProps) => {
    const [oldPassword, setOldPassword] = useState<string>("");
    const [newPassword, setNewPassword] = useState<string>("");
    const [confirmPassword, setConfirmPassword] = useState<string>("");
    const { t } = useLocale();

    return (
        <form className="" action="" onSubmit={(event) => event.preventDefault()}>
            <div className="mb-8 h4 md:mb-6">{t("settings.password.title")}</div>
            <Field
                className="mb-6"
                label={t("settings.password.currentLabel")}
                placeholder={t("settings.password.currentPlaceholder")}
                type="password"
                icon="lock"
                value={oldPassword}
                onChange={(e: any) => setOldPassword(e.target.value)}
                required
            />
            <Field
                className="mb-6"
                label={t("settings.password.newLabel")}
                placeholder={t("settings.password.newPlaceholder")}
                note={t("settings.password.minLength")}
                type="password"
                icon="lock"
                value={newPassword}
                onChange={(e: any) => setNewPassword(e.target.value)}
                required
            />
            <Field
                className="mb-6"
                label={t("settings.password.confirmLabel")}
                placeholder={t("settings.password.confirmPlaceholder")}
                note={t("settings.password.minLength")}
                type="password"
                icon="lock"
                value={confirmPassword}
                onChange={(e: any) => setConfirmPassword(e.target.value)}
                required
            />
            <button className="btn-blue w-full">
                {t("settings.password.changeButton")}
            </button>
        </form>
    );
};

export default Password;
