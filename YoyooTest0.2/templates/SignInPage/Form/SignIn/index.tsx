import { useState } from "react";
import Field from "@/components/Field";
import { useLocale } from "@/contexts/locale-context";

type SignInProps = {
    onClick: () => void;
};

const SignIn = ({ onClick }: SignInProps) => {
    const [name, setName] = useState<string>("");
    const [password, setPassword] = useState<string>("");
    const { t } = useLocale();

    return (
        <form action="" onSubmit={(event) => event.preventDefault()}>
            <Field
                className="mb-4"
                classInput="dark:bg-n-7 dark:border-n-7 dark:focus:bg-transparent"
                placeholder={t("signin.fields.usernameOrEmail")}
                icon="email"
                value={name}
                onChange={(e: any) => setName(e.target.value)}
                required
            />
            <Field
                className="mb-2"
                classInput="dark:bg-n-7 dark:border-n-7 dark:focus:bg-transparent"
                placeholder={t("signin.fields.password")}
                icon="lock"
                type="password"
                value={password}
                onChange={(e: any) => setPassword(e.target.value)}
                required
            />
            <button
                className="mb-6 base2 text-primary-1 transition-colors hover:text-primary-1/90"
                type="button"
                onClick={onClick}
            >
                {t("signin.forgotPassword")}
            </button>
            <button className="btn-blue btn-large w-full" type="submit">
                {t("signin.signInButton")}
            </button>
        </form>
    );
};

export default SignIn;
