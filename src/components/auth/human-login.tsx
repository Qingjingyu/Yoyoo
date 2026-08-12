"use client";

import { ArrowRight, LoaderCircle, ShieldCheck } from "lucide-react";
import { FormEvent, useState } from "react";

interface HumanLoginProps {
  nextPath?: string;
  onAuthenticated?: (path: string) => void;
}
interface LoginErrorPayload {
  error?: { message?: string };
}

function safeNextPath(value: string | undefined): string {
  if (!value?.startsWith("/") || value.startsWith("//")) return "/";
  return value;
}

export function HumanLogin({ nextPath, onAuthenticated }: HumanLoginProps) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [authenticated, setAuthenticated] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    setPending(true);
    setError(null);

    const data = new FormData(event.currentTarget);
    try {
      const response = await fetch("/api/v1/auth/login", {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          loginHandle: data.get("loginHandle"),
          password: data.get("password"),
        }),
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => null) as LoginErrorPayload | null;
        throw new Error(payload?.error?.message || "暂时无法登录，请稍后再试。");
      }

      const destination = safeNextPath(nextPath);
      setAuthenticated(true);
      if (onAuthenticated) onAuthenticated(destination);
      else window.location.assign(destination);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "暂时无法登录，请稍后再试。");
      setPending(false);
    }
  }

  return (
    <main className="human-login-shell">
      <section aria-labelledby="human-login-title" className="human-login-panel">
        <div aria-hidden="true" className="human-login-mark">
          <span>Y</span>
        </div>
        <div className="human-login-heading">
          <p>YOYOO SPACE</p>
          <h1 id="human-login-title">欢迎回来</h1>
          <span>使用你的 AI Card 身份进入私人协作空间。</span>
        </div>

        <form className="human-login-form" onSubmit={submit}>
          <label>
            <span>AI Card ID</span>
            <input
              autoCapitalize="characters"
              autoComplete="username"
              autoFocus
              inputMode="text"
              maxLength={64}
              name="loginHandle"
              placeholder="AI_100001"
              required
            />
          </label>
          <label>
            <span>密码</span>
            <input
              autoComplete="current-password"
              maxLength={128}
              minLength={12}
              name="password"
              placeholder="输入密码"
              required
              type="password"
            />
          </label>

          {error ? <p className="human-login-message is-error" role="alert">{error}</p> : null}
          {authenticated ? (
            <p className="human-login-message" role="status">身份验证成功，正在进入空间。</p>
          ) : null}

          <button disabled={pending || authenticated} type="submit">
            {pending ? <LoaderCircle aria-hidden="true" className="human-login-spinner" size={17} /> : null}
            <span>{pending || authenticated ? "正在验证" : "进入 Yoyoo"}</span>
            {!pending && !authenticated ? <ArrowRight aria-hidden="true" size={17} /> : null}
          </button>
        </form>

        <p className="human-login-security">
          <ShieldCheck aria-hidden="true" size={14} />
          密码只用于验证，不会在页面或日志中显示。
        </p>
      </section>
    </main>
  );
}
