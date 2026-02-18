import { useState } from "react";
import Field from "@/components/Field";
import { useLocale } from "@/contexts/locale-context";

type DeleteAccountProps = {};

const DeleteAccount = ({}: DeleteAccountProps) => {
    const [password, setPassword] = useState<string>("");
    const { t } = useLocale();

    return (
        <form className="" action="" onSubmit={(event) => event.preventDefault()}>
            <div className="mb-8 h4">{t("settings.delete.title")}</div>
            <div className="mb-6 caption1 text-n-4">
                {t("settings.delete.warning")}
            </div>
            <Field
                className="mb-6"
                label={t("settings.delete.passwordLabel")}
                placeholder={t("settings.delete.passwordPlaceholder")}
                type="password"
                icon="lock"
                value={password}
                onChange={(e: any) => setPassword(e.target.value)}
                required
            />
            <button className="btn-red w-full" disabled>
                {t("settings.delete.deleteButton")}
            </button>
        </form>
    );
};

export default DeleteAccount;
