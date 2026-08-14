"use client";

import { ArrowRight, BadgeCheck, LoaderCircle, ShieldCheck, Sparkles } from "lucide-react";
import { type FormEvent, useState, useSyncExternalStore } from "react";

interface HumanLoginProps {
  nextPath?: string;
  authorizationError?: string;
  onAuthenticated?: (callbackUrl: string) => void;
}

interface AuthorizationRequest {
  responseType: string;
  clientId: string;
  redirectUri: string;
  scope: string;
  state: string;
  codeChallenge: string;
  codeChallengeMethod: string;
}

interface AuthorizationTransaction {
  issuer: string;
  request: AuthorizationRequest;
}

interface AuthenticatedCard {
  card: { card_id: string; handle: string; display_name: string };
  csrf_token: string;
}

interface ErrorPayload {
  error?: { message?: string };
}

type LoginMode = "login" | "create";
type LoginPhase = "idle" | "preparing" | "authenticating" | "authorizing" | "complete";

function safeNextPath(value: string | undefined): string {
  if (!value?.startsWith("/") || value.startsWith("//") || value.includes("\\")) return "/";
  return value;
}

function subscribeToHydration(): () => void {
  return () => undefined;
}

function useHydrated(): boolean {
  return useSyncExternalStore(subscribeToHydration, () => true, () => false);
}

async function readJson(response: Response): Promise<unknown> {
  return response.json().catch(() => null);
}

function providerMessage(payload: unknown, fallback: string): string {
  const message = (payload as ErrorPayload | null)?.error?.message;
  return typeof message === "string" && message.trim() ? message : fallback;
}

function parseTransaction(payload: unknown): AuthorizationTransaction {
  const value = payload as Partial<AuthorizationTransaction> | null;
  const request = value?.request as Partial<AuthorizationRequest> | undefined;
  const issuer = typeof value?.issuer === "string" ? new URL(value.issuer) : null;
  const fields = [
    request?.responseType,
    request?.clientId,
    request?.redirectUri,
    request?.scope,
    request?.state,
    request?.codeChallenge,
    request?.codeChallengeMethod,
  ];
  const localIssuer = issuer?.protocol === "http:"
    && (issuer.hostname === "localhost" || issuer.hostname === "127.0.0.1");
  if (
    !issuer
    || (issuer.protocol !== "https:" && !localIssuer)
    || issuer.pathname !== "/"
    || issuer.search !== ""
    || issuer.hash !== ""
    || issuer.username !== ""
    || issuer.password !== ""
    || fields.some((field) => typeof field !== "string" || !field)
  ) {
    throw new Error("身份服务配置无效，请稍后再试。");
  }
  return value as AuthorizationTransaction;
}

function parseAuthenticatedCard(payload: unknown): AuthenticatedCard {
  const value = payload as Partial<AuthenticatedCard> | null;
  if (
    !value?.card
    || !/^AI_[1-9][0-9]{5,}$/.test(value.card.card_id)
    || !value.card.handle
    || !value.card.display_name
    || !/^[A-Za-z0-9_-]{43}$/.test(value.csrf_token ?? "")
  ) {
    throw new Error("身份服务返回了无法验证的结果，请重新尝试。");
  }
  return value as AuthenticatedCard;
}

function validateCallbackUrl(
  value: unknown,
  expectedRedirectUri: string,
  expectedState: string,
): string {
  if (typeof value !== "string") throw new Error("登录回调安全校验失败，请重新尝试。");
  const callback = new URL(value);
  const expected = new URL(expectedRedirectUri);
  if (
    callback.origin !== window.location.origin
    || expected.origin !== window.location.origin
    || callback.pathname !== expected.pathname
    || callback.searchParams.get("state") !== expectedState
  ) {
    throw new Error("登录回调安全校验失败，请重新尝试。");
  }
  return callback.toString();
}

export function HumanLogin({
  nextPath,
  authorizationError,
  onAuthenticated,
}: HumanLoginProps) {
  const ready = useHydrated();
  const [mode, setMode] = useState<LoginMode>("login");
  const [phase, setPhase] = useState<LoginPhase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [issuedCard, setIssuedCard] = useState<AuthenticatedCard["card"] | null>(null);
  const destination = safeNextPath(nextPath);
  const pending = phase !== "idle" && phase !== "complete";

  function changeMode(nextMode: LoginMode) {
    if (pending || nextMode === mode) return;
    setMode(nextMode);
    setError(null);
    setIssuedCard(null);
    setPhase("idle");
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!ready || pending) return;
    setPhase("preparing");
    setError(null);
    setIssuedCard(null);

    const data = new FormData(event.currentTarget);
    const password = String(data.get("password") ?? "");
    if (mode === "create" && password !== String(data.get("confirmPassword") ?? "")) {
      setError("两次输入的密码不一致。");
      setPhase("idle");
      return;
    }

    try {
      const startResponse = await fetch(
        `/api/v1/auth/aicard/start?format=json&next=${encodeURIComponent(destination)}`,
        { credentials: "same-origin", cache: "no-store" },
      );
      const startPayload = await readJson(startResponse);
      if (!startResponse.ok) {
        throw new Error(providerMessage(startPayload, "身份服务暂时不可用，请稍后再试。"));
      }
      const transaction = parseTransaction(startPayload);
      setPhase("authenticating");

      const endpoint = new URL(
        mode === "login" ? "/api/v1/auth/password/login" : "/api/v1/auth/password/register",
        transaction.issuer,
      ).toString();
      const identityBody = mode === "login"
        ? {
            identifier: String(data.get("identifier") ?? ""),
            password,
          }
        : {
            clientId: transaction.request.clientId,
            displayName: String(data.get("displayName") ?? ""),
            handle: String(data.get("handle") ?? ""),
            password,
          };
      const identityResponse = await fetch(endpoint, {
        method: "POST",
        credentials: "include",
        headers: {
          "content-type": "application/json",
          ...(mode === "create"
            ? { "idempotency-key": crypto.randomUUID().replaceAll("-", "") }
            : {}),
        },
        body: JSON.stringify(identityBody),
      });
      const identityPayload = await readJson(identityResponse);
      if (!identityResponse.ok) {
        throw new Error(providerMessage(identityPayload, "AI Card ID 或密码不正确。"));
      }
      const identity = parseAuthenticatedCard(identityPayload);
      setIssuedCard(identity.card);
      setPhase("authorizing");

      const authorizationResponse = await fetch(
        new URL("/api/v1/authorize", transaction.issuer).toString(),
        {
          method: "POST",
          credentials: "include",
          headers: {
            "content-type": "application/json",
            "x-csrf-token": identity.csrf_token,
          },
          body: JSON.stringify({ decision: "approve", request: transaction.request }),
        },
      );
      const authorizationPayload = await readJson(authorizationResponse);
      if (!authorizationResponse.ok) {
        throw new Error(providerMessage(authorizationPayload, "当前身份暂时无法进入 Yoyoo。"));
      }
      const callbackUrl = validateCallbackUrl(
        (authorizationPayload as { redirect_url?: unknown } | null)?.redirect_url,
        transaction.request.redirectUri,
        transaction.request.state,
      );
      setPhase("complete");
      if (onAuthenticated) onAuthenticated(callbackUrl);
      else window.location.assign(callbackUrl);
    } catch (caught) {
      setError(
        caught instanceof TypeError
          ? "AI Card 身份服务暂时无法连接，请稍后重试。"
          : caught instanceof Error
            ? caught.message
            : "暂时无法完成身份验证，请稍后再试。",
      );
      setPhase("idle");
    }
  }

  const statusText = phase === "preparing"
    ? "正在建立安全连接"
    : phase === "authenticating"
      ? mode === "login" ? "正在验证 AI Card" : "正在创建永久 AI Card"
      : phase === "authorizing"
        ? "身份已确认，正在进入 Yoyoo"
        : "正在进入 Yoyoo";

  return (
    <main className="human-login-shell">
      <section aria-labelledby="human-login-title" className="human-login-panel">
        <header className="human-login-brand">
          <div aria-hidden="true" className="human-login-mark"><Sparkles size={18} /></div>
          <div><strong>Yoyoo</strong><span>Space</span></div>
        </header>

        <div className="human-login-heading">
          <p>HUMAN + AI WORKSPACE</p>
          <h1 id="human-login-title">一起工作，从同一个身份开始。</h1>
          <span>Yoyoo 是人和 AI 共用的协作空间。AI Card 是你在这里以及未来产品中的永久身份。</span>
        </div>

        <div aria-label="选择进入方式" className="human-login-tabs" role="tablist">
          <button
            aria-selected={mode === "login"}
            disabled={pending}
            onClick={() => changeMode("login")}
            role="tab"
            type="button"
          >登录 AI Card</button>
          <button
            aria-selected={mode === "create"}
            disabled={pending}
            onClick={() => changeMode("create")}
            role="tab"
            type="button"
          >创建 AI Card</button>
        </div>

        <form aria-busy={!ready || pending} className="human-login-form" onSubmit={submit}>
          {mode === "login" ? (
            <label>
              <span>AI Card ID 或用户名</span>
              <input
                autoCapitalize="none"
                autoComplete="username"
                autoFocus
                disabled={!ready || pending}
                maxLength={64}
                name="identifier"
                placeholder="AI_100001"
                required
              />
            </label>
          ) : (
            <div className="human-login-field-grid">
              <label>
                <span>昵称</span>
                <input
                  autoComplete="name"
                  disabled={!ready || pending}
                  maxLength={120}
                  name="displayName"
                  placeholder="你的显示名称"
                  required
                />
              </label>
              <label>
                <span>用户名</span>
                <input
                  autoCapitalize="none"
                  autoComplete="username"
                  disabled={!ready || pending}
                  maxLength={64}
                  minLength={3}
                  name="handle"
                  pattern="[a-z][a-z0-9_]{2,63}"
                  placeholder="例如 subai"
                  required
                />
              </label>
            </div>
          )}

          <label>
            <span>{mode === "login" ? "密码" : "设置密码"}</span>
            <input
              autoComplete={mode === "login" ? "current-password" : "new-password"}
              disabled={!ready || pending}
              maxLength={128}
              minLength={12}
              name="password"
              placeholder="至少 12 个字符"
              required
              type="password"
            />
          </label>
          {mode === "create" ? (
            <label>
              <span>确认密码</span>
              <input
                autoComplete="new-password"
                disabled={!ready || pending}
                maxLength={128}
                minLength={12}
                name="confirmPassword"
                placeholder="再次输入密码"
                required
                type="password"
              />
            </label>
          ) : null}

          {authorizationError && !error ? (
            <p className="human-login-message is-error" role="alert">{authorizationError}</p>
          ) : null}
          {error ? <p className="human-login-message is-error" role="alert">{error}</p> : null}
          {issuedCard ? (
            <p className="human-login-message is-success" role="status">
              <BadgeCheck aria-hidden="true" size={16} />
              <span>{mode === "create" ? `已创建 ${issuedCard.card_id}` : `${issuedCard.card_id} 身份已确认`}</span>
            </p>
          ) : null}

          <button disabled={!ready || pending} type="submit">
            {pending ? <LoaderCircle aria-hidden="true" className="human-login-spinner" size={17} /> : null}
            <span>{!ready ? "正在准备" : pending ? statusText : mode === "login" ? "进入 Yoyoo" : "创建并进入 Yoyoo"}</span>
            {ready && !pending ? <ArrowRight aria-hidden="true" size={17} /> : null}
          </button>
        </form>

        <p className="human-login-security">
          <ShieldCheck aria-hidden="true" size={14} />
          密码只交给 AI Card 身份服务；Yoyoo 不读取、不保存，也不会创建第二套身份。
        </p>
      </section>
    </main>
  );
}
