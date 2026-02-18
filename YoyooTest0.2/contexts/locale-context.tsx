"use client";

import { createContext, useContext, useEffect, useMemo, useState } from "react";
import {
    DEFAULT_LOCALE,
    isLocale,
    LOCALE_STORAGE_KEY,
    Locale,
    translate,
} from "@/lib/i18n";

type LocaleContextValue = {
    locale: Locale;
    setLocale: (locale: Locale) => void;
    t: (key: string) => string;
};

const LocaleContext = createContext<LocaleContextValue | undefined>(undefined);

export function LocaleProvider({ children }: { children: React.ReactNode }) {
    const [locale, setLocaleState] = useState<Locale>(DEFAULT_LOCALE);

    useEffect(() => {
        const saved = window.localStorage.getItem(LOCALE_STORAGE_KEY);
        if (saved && isLocale(saved)) {
            setLocaleState(saved);
        }
    }, []);

    const setLocale = (nextLocale: Locale) => {
        setLocaleState(nextLocale);
        window.localStorage.setItem(LOCALE_STORAGE_KEY, nextLocale);
    };

    const value = useMemo<LocaleContextValue>(
        () => ({
            locale,
            setLocale,
            t: (key: string) => translate(locale, key),
        }),
        [locale]
    );

    return (
        <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>
    );
}

export function useLocale() {
    const context = useContext(LocaleContext);
    if (!context) {
        throw new Error("useLocale must be used within LocaleProvider");
    }
    return context;
}
