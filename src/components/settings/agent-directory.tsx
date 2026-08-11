"use client";

import {
  BadgeCheck,
  Ban,
  Bot,
  Check,
  Copy,
  KeyRound,
  Plus,
  RefreshCw,
  RotateCw,
  X,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { Sidebar } from "@/components/shell/sidebar";
import { ThemeSelector } from "@/components/theme/theme-selector";
import {
  browserAgentDirectoryClient,
  type AgentDirectoryClient,
  type AgentDirectoryRecord,
} from "@/lib/agent-directory-client";

type DirectoryState = "loading" | "ready" | "error";
type PendingAction = `rotate:${string}` | `revoke:${string}` | "create" | null;
export type AICardResult =
  | "connected"
  | "agent_connected"
  | "denied"
  | "failed"
  | "invalid_session"
  | "unavailable";

interface OneTimeCredential {
  displayName: string;
  token: string;
}

function statusLabel(agent: AgentDirectoryRecord): string {
  if (
    agent.authenticationMode === "aicard" &&
    agent.connectionStatus === "never_connected"
  ) {
    return "等待运行节点";
  }
  return {
    connected: "在线",
    never_connected: "等待连接",
    offline: "离线",
    revoked: "已撤销",
  }[agent.connectionStatus];
}

export function AgentDirectory({
  client = browserAgentDirectoryClient,
  aicardResult,
}: {
  client?: AgentDirectoryClient;
  aicardResult?: AICardResult;
}) {
  const [agents, setAgents] = useState<AgentDirectoryRecord[]>([]);
  const [state, setState] = useState<DirectoryState>("loading");
  const [creating, setCreating] = useState(false);
  const [displayName, setDisplayName] = useState("");
  const [handle, setHandle] = useState("");
  const [pending, setPending] = useState<PendingAction>(null);
  const [confirming, setConfirming] = useState<PendingAction>(null);
  const [credential, setCredential] = useState<OneTimeCredential | null>(null);
  const [copied, setCopied] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const authorizationResult = aicardResult ?? null;

  const loadAgents = useCallback(async () => {
    setState("loading");
    try {
      setAgents(await client.listAgents());
      setState("ready");
    } catch {
      setState("error");
    }
  }, [client]);

  useEffect(() => {
    const timer = window.setTimeout(() => void loadAgents(), 0);
    return () => window.clearTimeout(timer);
  }, [loadAgents]);

  async function createAgent() {
    const nextName = displayName.trim();
    const nextHandle = handle.trim();
    if (!nextName || !nextHandle || pending) return;
    setPending("create");
    setNotice(null);
    try {
      const created = await client.createAgent({
        displayName: nextName,
        handle: nextHandle,
      });
      setAgents((current) => [...current, created.agent]);
      setCredential({ displayName: created.agent.displayName, token: created.token });
      setCreating(false);
      setDisplayName("");
      setHandle("");
    } catch {
      setNotice("AI 未能接入。请检查标识是否重复后重试。");
    } finally {
      setPending(null);
    }
  }

  async function rotate(agent: AgentDirectoryRecord) {
    const action: PendingAction = `rotate:${agent.principalId}`;
    if (pending) return;
    setPending(action);
    setNotice(null);
    try {
      const rotated = await client.rotateCredential(agent.principalId);
      setAgents((current) =>
        current.map((candidate) =>
          candidate.principalId === agent.principalId ? rotated.agent : candidate,
        ),
      );
      setCredential({ displayName: agent.displayName, token: rotated.token });
      setConfirming(null);
    } catch {
      setNotice("凭据未能轮换，请稍后重试。");
    } finally {
      setPending(null);
    }
  }

  async function revoke(agent: AgentDirectoryRecord) {
    const action: PendingAction = `revoke:${agent.principalId}`;
    if (pending) return;
    setPending(action);
    setNotice(null);
    try {
      const revoked = await client.revokeCredential(agent.principalId);
      setAgents((current) =>
        current.map((candidate) =>
          candidate.principalId === agent.principalId ? revoked : candidate,
        ),
      );
      setConfirming(null);
    } catch {
      setNotice("凭据未能撤销，请稍后重试。");
    } finally {
      setPending(null);
    }
  }

  async function copyCredential() {
    if (!credential) return;
    try {
      await navigator.clipboard.writeText(credential.token);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1_500);
    } catch {
      setNotice("当前浏览器无法复制，请手动选择凭据。");
    }
  }

  return (
    <div className="space-shell agent-directory-shell">
      <a className="skip-link" href="#agent-directory-main">跳到 AI 接入</a>
      <Sidebar activeItem="settings" />

      <main className="agent-directory-stage" id="agent-directory-main">
        <header className="agent-directory-header">
          <div className="agent-directory-header__title">
            <span>Yoyoo Space</span>
            <h1>AI 接入</h1>
          </div>
          <div className="agent-directory-header__actions">
            <a href="/api/v1/auth/aicard/start?purpose=agent">
              <BadgeCheck aria-hidden="true" size={16} strokeWidth={1.7} />
              接入 AI Card
            </a>
            <a href="/api/v1/auth/aicard/start">
              <BadgeCheck aria-hidden="true" size={16} strokeWidth={1.7} />
              连接我的身份
            </a>
            <button
              aria-label="兼容接入 AI"
              disabled={state !== "ready" || creating}
              onClick={() => setCreating(true)}
              type="button"
            >
              <Plus aria-hidden="true" size={16} strokeWidth={1.7} />
              兼容接入
            </button>
          </div>
        </header>

        <section aria-labelledby="appearance-title" className="appearance-settings">
          <div>
            <span>界面</span>
            <h2 id="appearance-title">空间主题</h2>
          </div>
          <ThemeSelector />
        </section>

        <section aria-label="AI 目录" className="agent-directory-surface">
          {credential ? (
            <div className="agent-credential" role="status">
              <span className="agent-credential__icon" aria-hidden="true">
                <KeyRound size={18} strokeWidth={1.6} />
              </span>
              <div>
                <strong>凭据仅显示一次</strong>
                <small>{credential.displayName}</small>
              </div>
              <input aria-label="Agent 接入凭据" readOnly value={credential.token} />
              <button
                aria-label="复制接入凭据"
                onClick={() => void copyCredential()}
                title="复制接入凭据"
                type="button"
              >
                {copied ? <Check size={16} /> : <Copy size={16} />}
              </button>
              <button
                aria-label="关闭接入凭据"
                onClick={() => setCredential(null)}
                title="关闭"
                type="button"
              >
                <X size={16} />
              </button>
            </div>
          ) : null}

          {creating ? (
            <form
              className="agent-create"
              onSubmit={(event) => {
                event.preventDefault();
                void createAgent();
              }}
            >
              <label>
                <span>显示名称</span>
                <input
                  aria-label="显示名称"
                  autoFocus
                  maxLength={120}
                  onChange={(event) => setDisplayName(event.target.value)}
                  placeholder="例如 Researcher"
                  value={displayName}
                />
              </label>
              <label>
                <span>Agent 标识</span>
                <input
                  aria-label="Agent 标识"
                  maxLength={80}
                  onChange={(event) =>
                    setHandle(event.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""))
                  }
                  placeholder="researcher"
                  value={handle}
                />
              </label>
              <div className="agent-create__actions">
                <button
                  disabled={!displayName.trim() || !handle.trim() || pending === "create"}
                  type="submit"
                >
                  {pending === "create" ? "正在创建" : "创建接入凭据"}
                </button>
                <button
                  onClick={() => {
                    setCreating(false);
                    setDisplayName("");
                    setHandle("");
                  }}
                  type="button"
                >
                  取消
                </button>
              </div>
            </form>
          ) : null}

          {authorizationResult ? (
            <p
              className="agent-directory-notice"
              data-tone={
                authorizationResult === "connected" ||
                authorizationResult === "agent_connected"
                  ? "success"
                  : "error"
              }
              role={
                authorizationResult === "connected" ||
                authorizationResult === "agent_connected"
                  ? "status"
                  : "alert"
              }
            >
              {{
                connected: "AI Card 已连接到当前 Yoyoo 身份。",
                agent_connected: "AI Card 身份已加入当前工作空间，等待运行节点连接。",
                denied: "你已取消 AI Card 授权。",
                failed: "AI Card 身份校验失败，请重新连接。",
                invalid_session: "授权已失效，请重新连接。",
                unavailable: "AI Card 服务暂时不可用，请稍后重试。",
              }[authorizationResult]}
            </p>
          ) : null}

          {notice ? <p className="agent-directory-notice" role="alert">{notice}</p> : null}

          {state === "loading" ? (
            <div aria-label="正在加载 AI 目录" className="agent-directory-loading" role="status">
              <span />
              <span />
              <span />
            </div>
          ) : state === "error" ? (
            <div className="agent-directory-state" role="alert">
              <Bot aria-hidden="true" size={24} strokeWidth={1.4} />
              <h2>AI 目录暂时无法载入</h2>
              <button onClick={() => void loadAgents()} type="button">
                <RefreshCw aria-hidden="true" size={15} />
                重新载入
              </button>
            </div>
          ) : agents.length === 0 ? (
            <div className="agent-directory-state">
              <Bot aria-hidden="true" size={24} strokeWidth={1.4} />
              <h2>尚未接入 AI</h2>
              <button onClick={() => setCreating(true)} type="button">
                <Plus aria-hidden="true" size={15} />
                接入第一个 AI
              </button>
            </div>
          ) : (
            <div className="agent-list">
              <header>
                <span>名称</span>
                <span>连接状态</span>
                <span>身份</span>
                <span className="sr-only">操作</span>
              </header>
              {agents.map((agent) => {
                const rotateAction: PendingAction = `rotate:${agent.principalId}`;
                const revokeAction: PendingAction = `revoke:${agent.principalId}`;
                return (
                  <article className="agent-row" key={agent.principalId}>
                    <div className="agent-row__identity">
                      <span aria-hidden="true"><Bot size={17} strokeWidth={1.5} /></span>
                      <div>
                        <strong>{agent.displayName}</strong>
                        <small>@{agent.handle}</small>
                      </div>
                    </div>
                    <span
                      className="agent-row__status"
                      data-status={agent.connectionStatus}
                    >
                      <i aria-hidden="true" />
                      {statusLabel(agent)}
                    </span>
                    <span className="agent-row__credential">
                      {agent.authenticationMode === "aicard"
                        ? "AI Card"
                        : `····${agent.tokenHint} · v${agent.credentialVersion}`}
                    </span>
                    <div className="agent-row__actions">
                      {agent.authenticationMode === "aicard" ? (
                        <span className="agent-row__revoked">等待运行时</span>
                      ) : confirming === rotateAction ? (
                        <span className="agent-row__confirm">
                          <button
                            disabled={pending === rotateAction}
                            onClick={() => void rotate(agent)}
                            type="button"
                          >确认轮换</button>
                          <button onClick={() => setConfirming(null)} type="button">取消</button>
                        </span>
                      ) : confirming === revokeAction ? (
                        <span className="agent-row__confirm" data-danger>
                          <button
                            disabled={pending === revokeAction}
                            onClick={() => void revoke(agent)}
                            type="button"
                          >确认撤销</button>
                          <button onClick={() => setConfirming(null)} type="button">取消</button>
                        </span>
                      ) : agent.credentialStatus === "active" ? (
                        <>
                          <button
                            aria-label={`轮换 ${agent.displayName} 的凭据`}
                            onClick={() => setConfirming(rotateAction)}
                            title="轮换凭据"
                            type="button"
                          >
                            <RotateCw aria-hidden="true" size={15} strokeWidth={1.6} />
                          </button>
                          <button
                            aria-label={`撤销 ${agent.displayName} 的凭据`}
                            onClick={() => setConfirming(revokeAction)}
                            title="撤销凭据"
                            type="button"
                          >
                            <Ban aria-hidden="true" size={15} strokeWidth={1.6} />
                          </button>
                        </>
                      ) : (
                        <span className="agent-row__revoked">不可连接</span>
                      )}
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
