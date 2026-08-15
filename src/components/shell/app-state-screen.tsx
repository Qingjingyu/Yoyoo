"use client";

import { RefreshCw } from "lucide-react";

import { Sidebar } from "@/components/shell/sidebar";

export function AppStateScreen({
  onRetry,
  state,
}: {
  onRetry?: () => void;
  state: "loading" | "error";
}) {
  return (
    <div className="space-shell app-state-shell">
      <Sidebar activeItem="none" />
      <main className="app-state-stage">
        {state === "loading" ? (
          <div aria-label="正在载入 Yoyoo" className="app-state-loading" role="status">
            <span aria-hidden="true" />
            <span className="sr-only">正在载入 Yoyoo</span>
          </div>
        ) : (
          <div className="app-state-error" role="alert">
            <strong>当前页面暂时无法载入</strong>
            <span>你的内容没有丢失，请重新载入。</span>
            <button onClick={onRetry} type="button">
              <RefreshCw aria-hidden="true" size={15} />
              重新载入
            </button>
          </div>
        )}
      </main>
    </div>
  );
}
