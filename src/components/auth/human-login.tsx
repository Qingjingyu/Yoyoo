"use client";

import { ArrowRight, LoaderCircle, ShieldCheck } from "lucide-react";
import { FormEvent, useState, useSyncExternalStore } from "react";

interface HumanLoginProps {
  nextPath?: string;
  authorizationError?: string;
  onAuthenticated?: (path: string) => void;
}
interface LoginErrorPayload {
  error?: { message?: string };
}

function safeNextPath(value: string | undefined): string {
  if (!value?.startsWith("/") || value.startsWith("//")) return "/";
  return value;
}

function subscribeToHydration(): () => void {
  return () => undefined;
}

function useHydrated(): boolean {
  return useSyncExternalStore(
    subscribeToHydration,
    () => true,
    () => false,
  );
}

export function HumanLogin({
  nextPath,
  authorizationError,
  onAuthenticated,
}: HumanLoginProps) {
  const ready = useHydrated();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [authenticated, setAuthenticated] = useState(false);
  const destination = safeNextPath(nextPath);
  const authorizationUrl = `/api/v1/auth/aicard/start?next=${encodeURIComponent(destination)}`;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!ready || pending) return;
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
          <h1 id="human-login-title">使用 AI Card 进入</h1>
          <span>一个统一身份，进入 Yoyoo 以及之后支持 AI Card 的产品。</span>
        </div>

        {authorizationError ? (
          <p className="human-login-message is-error" role="alert">
            {authorizationError}
          </p>
        ) : null}

        <a className="human-login-primary" href={authorizationUrl}>
          <span>使用 AI Card 继续</span>
          <ArrowRight aria-hidden="true" size={17} />
        </a>
        <p className="human-login-onboarding">
          还没有 AI Card？继续后可自动创建永久编号；进入当前空间仍需已有授权。
        </p>

        <details className="human-login-fallback">
          <summary>使用临时本地账号</summary>
          <form
            action="/api/v1/auth/login"
            aria-busy={!ready || pending}
            className="human-login-form"
            method="post"
            onSubmit={submit}
          >
          <label>
            <span>AI Card ID</span>
            <input
              autoCapitalize="characters"
              autoComplete="username"
              autoFocus
              disabled={!ready || pending || authenticated}
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
              disabled={!ready || pending || authenticated}
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

          <button disabled={!ready || pending || authenticated} type="submit">
            {pending ? <LoaderCircle aria-hidden="true" className="human-login-spinner" size={17} /> : null}
            <span>{!ready ? "正在准备" : pending || authenticated ? "正在验证" : "进入 Yoyoo"}</span>
            {ready && !pending && !authenticated ? <ArrowRight aria-hidden="true" size={17} /> : null}
          </button>
          </form>
        </details>

        <p className="human-login-security">
          <ShieldCheck aria-hidden="true" size={14} />
          AI Card 编号由统一身份服务颁发，Yoyoo 不会再次创建第二套身份。
        </p>
      </section>
    </main>
  );
}
