"use client";

import { ChakraProvider, ColorModeScript } from "@chakra-ui/react";
import { Toaster, resolveValue } from "react-hot-toast";
import theme from "./theme";
import { LocaleProvider } from "@/contexts/locale-context";

export function Providers({ children }: { children: React.ReactNode }) {
    return (
        <>
            <ColorModeScript initialColorMode={theme.config.initialColorMode} />
            <LocaleProvider>
                <ChakraProvider>{children}</ChakraProvider>
            </LocaleProvider>
            <Toaster
                containerStyle={{
                    bottom: 40,
                    left: 20,
                    right: 20,
                }}
                position="bottom-center"
                gutter={10}
                toastOptions={{
                    duration: 2000,
                }}
            >
                {(t) => (
                    <div
                        style={{
                            opacity: t.visible ? 1 : 0,
                            transform: t.visible
                                ? "translatey(0)"
                                : "translatey(0.75rem)",
                            transition: "all .2s",
                        }}
                    >
                        {resolveValue(t.message, t)}
                    </div>
                )}
            </Toaster>
        </>
    );
}
