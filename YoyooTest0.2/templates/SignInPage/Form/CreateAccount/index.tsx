import { useState } from "react";
import Link from "next/link";
import Field from "@/components/Field";
import { useLocale } from "@/contexts/locale-context";

type CreateAccountProps = {};

const CreateAccount = ({}: CreateAccountProps) => {
    const [email, setEmail] = useState<string>("");
    const [password, setPassword] = useState<string>("");
    const { t } = useLocale();

    return (
        <form action="" onSubmit={(event) => event.preventDefault()}>
            <Field
                className="mb-4"
                classInput="dark:bg-n-7 dark:border-n-7 dark:focus:bg-transparent"
                placeholder={t("signin.fields.email")}
                icon="email"
                type="email"
                value={email}
                onChange={(e: any) => setEmail(e.target.value)}
                required
            />
            <Field
                className="mb-6"
                classInput="dark:bg-n-7 dark:border-n-7 dark:focus:bg-transparent"
                placeholder={t("signin.fields.password")}
                icon="lock"
                type="password"
                value={password}
                onChange={(e: any) => setPassword(e.target.value)}
                required
            />
            <button className="btn-blue btn-large w-full mb-6" type="submit">
                {t("signin.createAccountButton")}
            </button>
            <div className="text-center caption1 text-n-4">
                {t("signin.termsPrefix")}{" "}
                <Link
                    className="text-n-5 transition-colors hover:text-n-7 dark:text-n-3 dark:hover:text-n-1"
                    href="/"
                >
                    {t("signin.termsOfService")}
                </Link>{" "}
                and{" "}
                <Link
                    className="text-n-5 transition-colors hover:text-n-7 dark:text-n-3 dark:hover:text-n-1"
                    href="/"
                >
                    {t("signin.privacyStatement")}
                </Link>
                .
            </div>
        </form>
    );
};

export default CreateAccount;
