"use client";

import {
  BadgeCheck,
  Ban,
  Bot,
  Check,
  Copy,
  IdCard,
  KeyRound,
  LogOut,
  RefreshCw,
  RotateCw,
  X,
} from "lucide-react";
import { type FormEvent, useCallback, useEffect, useState } from "react";

import { Sidebar } from "@/components/shell/sidebar";
import { ThemeSelector } from "@/components/theme/theme-selector";
import {
  browserAgentDirectoryClient,
  type AgentDirectoryClient,
  type AgentDirectoryRecord,
  type AgentAdmissionInvitation,
  type AgentAdmissionPermission,
  type AgentAdmissionRoom,
} from "@/lib/agent-directory-client";

type DirectoryState = "loading" | "ready" | "error";
type IdentityState = "loading" | "ready" | "error";
type PendingAction = `rotate:${string}` | `revoke:${string}` | null;
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

export interface CurrentAICardIdentity {
  aiCardId: string;
  loginHandle: string;
  displayName: string;
}

export interface CurrentIdentityClient {
  getCurrentIdentity(): Promise<CurrentAICardIdentity>;
}

const browserCurrentIdentityClient: CurrentIdentityClient = {
  async getCurrentIdentity() {
    const response = await fetch("/api/v1/auth/session", {
      credentials: "same-origin",
    });
    if (!response.ok) throw new Error("current identity request failed");
    const payload = (await response.json()) as {
      authenticated?: boolean;
      identity?: Partial<CurrentAICardIdentity>;
    };
    const identity = payload.identity;
    if (
      !payload.authenticated ||
      !identity ||
      typeof identity.aiCardId !== "string" ||
      typeof identity.loginHandle !== "string" ||
      typeof identity.displayName !== "string"
    ) {
      throw new Error("current identity response is invalid");
    }
    return identity as CurrentAICardIdentity;
  },
};

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
  identityClient = browserCurrentIdentityClient,
  aicardResult,
  onSignedOut,
}: {
  client?: AgentDirectoryClient;
  identityClient?: CurrentIdentityClient;
  aicardResult?: AICardResult;
  onSignedOut?: () => void;
}) {
  const [agents, setAgents] = useState<AgentDirectoryRecord[]>([]);
  const [state, setState] = useState<DirectoryState>("loading");
  const [identityState, setIdentityState] = useState<IdentityState>("loading");
  const [identity, setIdentity] = useState<CurrentAICardIdentity | null>(null);
  const [cardOpen, setCardOpen] = useState(false);
  const [pending, setPending] = useState<PendingAction>(null);
  const [confirming, setConfirming] = useState<PendingAction>(null);
  const [credential, setCredential] = useState<OneTimeCredential | null>(null);
  const [copied, setCopied] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [signingOut, setSigningOut] = useState(false);
  const [admissionOpen, setAdmissionOpen] = useState(false);
  const [admissionLoading, setAdmissionLoading] = useState(false);
  const [admissionSubmitting, setAdmissionSubmitting] = useState(false);
  const [admissionError, setAdmissionError] = useState<string | null>(null);
  const [admissionName, setAdmissionName] = useState("");
  const [admissionRooms, setAdmissionRooms] = useState<AgentAdmissionRoom[]>([]);
  const [selectedRooms, setSelectedRooms] = useState<string[]>([]);
  const [admissionPermissions, setAdmissionPermissions] = useState<AgentAdmissionPermission[]>([
    "message.read",
    "message.write",
  ]);
  const [invitations, setInvitations] = useState<AgentAdmissionInvitation[]>([]);
  const [admissionInstructions, setAdmissionInstructions] = useState<string | null>(null);
  const [instructionsCopied, setInstructionsCopied] = useState(false);
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

  const loadIdentity = useCallback(async () => {
    setIdentityState("loading");
    try {
      setIdentity(await identityClient.getCurrentIdentity());
      setIdentityState("ready");
    } catch {
      setIdentity(null);
      setIdentityState("error");
    }
  }, [identityClient]);

  useEffect(() => {
    const timer = window.setTimeout(() => void loadAgents(), 0);
    return () => window.clearTimeout(timer);
  }, [loadAgents]);

  useEffect(() => {
    const timer = window.setTimeout(() => void loadIdentity(), 0);
    return () => window.clearTimeout(timer);
  }, [loadIdentity]);

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

  async function openAdmission() {
    setAdmissionOpen(true);
    setAdmissionInstructions(null);
    setAdmissionError(null);
    setAdmissionLoading(true);
    try {
      const [rooms, existingInvitations] = await Promise.all([
        client.listRooms(),
        client.listInvitations(),
      ]);
      setAdmissionRooms(rooms.filter((room) => room.status === "active"));
      setInvitations(existingInvitations);
    } catch {
      setAdmissionError("接入信息暂时无法载入，请稍后重试。");
    } finally {
      setAdmissionLoading(false);
    }
  }

  async function refreshAdmissionStatus() {
    setAdmissionError(null);
    try {
      const refreshed = await client.listInvitations();
      setInvitations(refreshed);
      if (refreshed.some((invitation) => invitation.status === "admitted")) {
        await loadAgents();
      }
    } catch {
      setAdmissionError("接入状态暂时无法刷新，请稍后重试。");
    }
  }

  function toggleRoom(roomId: string) {
    setSelectedRooms((current) => current.includes(roomId)
      ? current.filter((candidate) => candidate !== roomId)
      : [...current, roomId]);
  }

  function togglePermission(permission: AgentAdmissionPermission) {
    setAdmissionPermissions((current) => current.includes(permission)
      ? current.filter((candidate) => candidate !== permission)
      : [...current, permission]);
  }

  async function createAdmission(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (admissionSubmitting || !admissionName.trim() || selectedRooms.length === 0) return;
    setAdmissionSubmitting(true);
    setAdmissionError(null);
    try {
      const invitation = await client.createInvitation({
        displayName: admissionName.trim(),
        roomIds: selectedRooms,
        permissions: admissionPermissions,
      });
      setAdmissionInstructions(invitation.instructions);
      setInvitations((current) => [invitation, ...current]);
    } catch {
      setAdmissionError("接入说明未能生成，请检查登录授权后重试。");
    } finally {
      setAdmissionSubmitting(false);
    }
  }

  async function copyAdmissionInstructions() {
    if (!admissionInstructions) return;
    try {
      await navigator.clipboard.writeText(admissionInstructions);
      setInstructionsCopied(true);
      window.setTimeout(() => setInstructionsCopied(false), 1_500);
    } catch {
      setAdmissionError("当前浏览器无法复制，请手动选择完整说明。");
    }
  }

  async function revokeInvitation(invitationId: string) {
    setAdmissionError(null);
    try {
      await client.revokeInvitation(invitationId);
      setInvitations((current) => current.map((invitation) =>
        invitation.invitationId === invitationId
          ? { ...invitation, status: "revoked" }
          : invitation));
    } catch {
      setAdmissionError("邀请未能撤销，可能已经被使用或失效。");
    }
  }

  async function signOut() {
    if (signingOut) return;
    setSigningOut(true);
    setNotice(null);
    try {
      const response = await fetch("/api/v1/auth/session", {
        method: "DELETE",
        credentials: "same-origin",
      });
      if (!response.ok) throw new Error("sign out failed");
      if (onSignedOut) onSignedOut();
      else window.location.replace("/login");
    } catch {
      setNotice("暂时无法退出，请稍后再试。");
      setSigningOut(false);
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
            <button onClick={() => void openAdmission()} type="button">
              <BadgeCheck aria-hidden="true" size={16} strokeWidth={1.7} />
              接入 Agent
            </button>
            <button
              disabled={identityState !== "ready"}
              onClick={() => setCardOpen(true)}
              type="button"
            >
              <IdCard aria-hidden="true" size={16} strokeWidth={1.7} />
              我的 AI Card
            </button>
            <button
              aria-label="退出登录"
              disabled={signingOut}
              onClick={() => void signOut()}
              title="退出登录"
              type="button"
            >
              <LogOut aria-hidden="true" size={16} strokeWidth={1.7} />
              {signingOut ? "正在退出" : "退出"}
            </button>
          </div>
        </header>

        {identityState === "error" ? (
          <div className="identity-load-error" role="alert">
            <span>身份暂时无法载入</span>
            <button
              aria-label="重新载入身份"
              onClick={() => void loadIdentity()}
              type="button"
            >
              <RefreshCw aria-hidden="true" size={14} />
              重试
            </button>
          </div>
        ) : null}

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
                connected: "统一 AI Card 身份已确认。",
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
              <p>由你生成一段完整说明，Agent 会自动领取或复用 AI Card 并加入指定会话。</p>
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
                        <small>
                          {[`@${agent.handle}`, agent.cardId, agent.machineName]
                            .filter(Boolean)
                            .join(" · ")}
                        </small>
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
                      {confirming === rotateAction ? (
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
                      ) : agent.authenticationMode === "aicard"
                        && agent.connectionStatus !== "revoked" ? (
                        <button
                          aria-label={`停用 ${agent.displayName} 的 Yoyoo 接入`}
                          onClick={() => setConfirming(revokeAction)}
                          title="停用 Yoyoo 接入"
                          type="button"
                        >
                          <Ban aria-hidden="true" size={15} strokeWidth={1.6} />
                        </button>
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

        {cardOpen && identity ? (
          <div
            className="aicard-overlay"
            onMouseDown={(event) => {
              if (event.currentTarget === event.target) setCardOpen(false);
            }}
          >
            <section
              aria-labelledby="my-aicard-title"
              aria-modal="true"
              className="aicard-dialog"
              role="dialog"
            >
              <header>
                <div>
                  <span>AI CARD</span>
                  <h2 id="my-aicard-title">我的 AI Card</h2>
                </div>
                <button
                  aria-label="关闭我的 AI Card"
                  onClick={() => setCardOpen(false)}
                  title="关闭"
                  type="button"
                >
                  <X aria-hidden="true" size={17} />
                </button>
              </header>
              <div className="aicard-dialog__identity">
                <span aria-hidden="true">{identity.displayName.slice(0, 1)}</span>
                <div>
                  <strong>{identity.displayName}</strong>
                  <small>@{identity.loginHandle}</small>
                </div>
              </div>
              <dl>
                <div>
                  <dt>永久身份编号</dt>
                  <dd>{identity.aiCardId}</dd>
                </div>
                <div>
                  <dt>Yoyoo 用户名</dt>
                  <dd>@{identity.loginHandle}</dd>
                </div>
              </dl>
              <p>这张 AI Card 是你在 Yoyoo 及未来兼容产品中的统一身份。</p>
            </section>
          </div>
        ) : null}

        {admissionOpen ? (
          <div
            className="aicard-overlay"
            onMouseDown={(event) => {
              if (event.currentTarget === event.target) setAdmissionOpen(false);
            }}
          >
            <section
              aria-labelledby="agent-admission-title"
              aria-modal="true"
              className="agent-admission-dialog"
              role="dialog"
            >
              <header>
                <div>
                  <span>YOYOO AGENT ACCESS</span>
                  <h2 id="agent-admission-title">接入 Agent</h2>
                </div>
                <button
                  aria-label="关闭接入 Agent"
                  onClick={() => setAdmissionOpen(false)}
                  title="关闭"
                  type="button"
                >
                  <X aria-hidden="true" size={17} />
                </button>
              </header>

              {admissionLoading ? (
                <div className="agent-admission-state" role="status">正在读取可授权会话…</div>
              ) : admissionInstructions ? (
                <div className="agent-admission-result">
                  <p>把下面整段内容发送给你的 Agent，它会自动完成身份领取和空间接入。</p>
                  <textarea
                    aria-label="完整 Agent 接入说明"
                    readOnly
                    rows={14}
                    value={admissionInstructions}
                  />
                  <button onClick={() => void copyAdmissionInstructions()} type="button">
                    {instructionsCopied ? <Check size={16} /> : <Copy size={16} />}
                    {instructionsCopied ? "已复制" : "复制完整接入说明"}
                  </button>
                </div>
              ) : (
                <form className="agent-admission-form" onSubmit={(event) => void createAdmission(event)}>
                  <label>
                    <span>Agent 昵称</span>
                    <input
                      aria-label="Agent 昵称"
                      autoComplete="off"
                      maxLength={120}
                      onChange={(event) => setAdmissionName(event.target.value)}
                      placeholder="例如：研究助手"
                      value={admissionName}
                    />
                  </label>

                  <fieldset>
                    <legend>允许进入的会话</legend>
                    {admissionRooms.length ? admissionRooms.map((room) => (
                      <label className="agent-admission-option" key={room.id}>
                        <input
                          checked={selectedRooms.includes(room.id)}
                          onChange={() => toggleRoom(room.id)}
                          type="checkbox"
                        />
                        <span><strong>{room.name}</strong><small>{room.id}</small></span>
                      </label>
                    )) : <p className="agent-admission-empty">暂无可授权的会话。</p>}
                  </fieldset>

                  <fieldset>
                    <legend>最小权限</legend>
                    {([
                      ["message.read", "读取消息"],
                      ["message.write", "发送消息"],
                      ["attachment.read", "读取附件"],
                      ["attachment.write", "发送附件"],
                    ] as Array<[AgentAdmissionPermission, string]>).map(([permission, label]) => (
                      <label className="agent-admission-permission" key={permission}>
                        <input
                          checked={admissionPermissions.includes(permission)}
                          onChange={() => togglePermission(permission)}
                          type="checkbox"
                        />
                        <span>{label}</span>
                      </label>
                    ))}
                  </fieldset>

                  <button
                    className="agent-admission-submit"
                    disabled={
                      admissionSubmitting
                      || !admissionName.trim()
                      || selectedRooms.length === 0
                      || admissionPermissions.length === 0
                    }
                    type="submit"
                  >
                    {admissionSubmitting ? "正在生成" : "生成接入说明"}
                  </button>
                </form>
              )}

              {admissionError ? <p className="agent-admission-error" role="alert">{admissionError}</p> : null}

              {invitations.length ? (
                <div className="agent-admission-history">
                  <header>
                    <h3>最近邀请</h3>
                    <button onClick={() => void refreshAdmissionStatus()} type="button">
                      <RefreshCw aria-hidden="true" size={13} />
                      刷新状态
                    </button>
                  </header>
                  {invitations.slice(0, 5).map((invitation) => (
                    <article key={invitation.invitationId}>
                      <div>
                        <strong>{invitation.displayName}</strong>
                        <small>
                          {[invitation.cardId, invitation.machineName]
                            .filter(Boolean)
                            .join(" · ") || invitation.status}
                        </small>
                      </div>
                      {invitation.status === "pending" ? (
                        <button
                          onClick={() => void revokeInvitation(invitation.invitationId)}
                          type="button"
                        >撤销</button>
                      ) : <span>{invitation.status === "admitted" ? "已接入" : "已结束"}</span>}
                    </article>
                  ))}
                </div>
              ) : null}
            </section>
          </div>
        ) : null}
      </main>
    </div>
  );
}
