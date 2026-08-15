"use client";

import { AppStateScreen } from "@/components/shell/app-state-screen";

export default function ErrorPage({ reset }: { reset: () => void }) {
  return <AppStateScreen onRetry={reset} state="error" />;
}
