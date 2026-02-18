import { useState } from "react";
import Icon from "@/components/Icon";
import Field from "@/components/Field";
import { useLocale } from "@/contexts/locale-context";

type ForgotPasswordProps = {
    onClick: () => void;
};

const ForgotPassword = ({ onClick }: ForgotPasswordProps) => {
    const [email, setEmail] = useState<string>("");
    const { t } = useLocale();

    return (
        <>
            <button
                className="group flex items-center mb-8 h5"
                onClick={onClick}
            >
                <Icon
                    className="mr-4 transition-transform group-hover:-translate-x-1 dark:fill-n-1"
                    name="arrow-prev"
                />
                {t("signin.forgot.resetTitle")}
            </button>
            <form action="" onSubmit={(event) => event.preventDefault()}>
                <Field
                    className="mb-6"
                    classInput="dark:bg-n-7 dark:border-n-7 dark:focus:bg-transparent"
                    placeholder={t("signin.fields.email")}
                    icon="email"
                    type="email"
                    value={email}
                    onChange={(e: any) => setEmail(e.target.value)}
                    required
                />
                <button
                    className="btn-blue btn-large w-full mb-6"
                    type="submit"
                >
                    {t("signin.forgot.resetButton")}
                </button>
            </form>
        </>
    );
};

export default ForgotPassword;
