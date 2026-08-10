"use client";

import { Mic, MicOff, RotateCcw, Square, X } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type RefObject,
} from "react";

import { Sidebar } from "@/components/shell/sidebar";
import { YoyooOrb } from "@/components/orb/yoyoo-orb";
import {
  browserConversationClient,
  type ClientMessage,
  type ClientRunEvent,
  type ConversationClient,
} from "@/lib/conversation-client";

import rainCityBackdrop from "../../../public/yoyoo-rain-city.png";

import { HomeComposer } from "./home-composer";
import type { HomeState } from "./home-types";

interface HomeExperienceProps {
  conversationClient?: ConversationClient;
  state?: HomeState;
  onRetry?: () => void;
  surface?: "home" | "conversation";
}

export function HomeExperience({
  conversationClient = browserConversationClient,
  state,
  onRetry,
  surface = "home",
}: HomeExperienceProps) {
  const router = useRouter();
  const [draft, setDraft] = useState("");
  const [remoteState, setRemoteState] = useState<HomeState>("loading");
  const [messages, setMessages] = useState<ClientMessage[]>([]);
  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  const [streamingText, setStreamingText] = useState("");
  const [canCancel, setCanCancel] = useState(false);
  const [failedRunId, setFailedRunId] = useState<string | null>(null);
  const [conversationError, setConversationError] = useState<string | null>(null);
  const [presenceLabel, setPresenceLabel] = useState("Yoyoo 在线");
  const [isLive, setIsLive] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const streamTextRef = useRef("");
  const threadRef = useRef<HTMLElement | null>(null);
  const unsubscribeRef = useRef<(() => void) | null>(null);
  const effectiveState = state ?? remoteState;

  const applyRunEvent = useCallback((event: ClientRunEvent) => {
    if (event.type === "status") {
      setPresenceLabel(event.status === "thinking" ? "Yoyoo 正在思考" : "Yoyoo 正在回复");
      return;
    }
    if (event.type === "text_delta") {
      streamTextRef.current += event.delta;
      setStreamingText(streamTextRef.current);
      setPresenceLabel("Yoyoo 正在回复");
      return;
    }
    if (event.type === "delegation" || event.type === "artifact") {
      return;
    }

    const partial = streamTextRef.current;
    const terminalText = event.type === "completed" ? event.text : partial;
    if (terminalText.trim()) {
      setMessages((current) => [
        ...current,
        {
          id: `agent-${event.runId}`,
          conversationId: "current",
          senderType: "agent",
          content: terminalText,
          status: event.type,
        },
      ]);
    }
    setActiveRunId(null);
    setStreamingText("");
    streamTextRef.current = "";
    if (event.type === "failed") {
      setFailedRunId(event.runId);
      setConversationError("回复中断，可以安全重试。" );
      setPresenceLabel("Yoyoo 连接中断");
    } else if (event.type === "stopped") {
      setPresenceLabel("Yoyoo 已停止");
    } else {
      setFailedRunId(null);
      setConversationError(null);
      setPresenceLabel("Yoyoo 在线");
    }
  }, []);

  const followRun = useCallback(
    (runId: string) => {
      unsubscribeRef.current?.();
      setActiveRunId(runId);
      setFailedRunId(null);
      setConversationError(null);
      streamTextRef.current = "";
      setStreamingText("");
      setPresenceLabel("Yoyoo 正在思考");
      unsubscribeRef.current = conversationClient.subscribeToRun(runId, {
        onEvent: applyRunEvent,
        onOpen: () => setConversationError(null),
        onReconnecting: () => {
          setPresenceLabel("Yoyoo 正在重连");
          setConversationError("连接中断，正在恢复事件流。" );
        },
      });
    },
    [applyRunEvent, conversationClient],
  );

  const loadConversation = useCallback(async () => {
    try {
      const snapshot = await conversationClient.getCurrent();
      setMessages(snapshot.messages);
      setCanCancel(snapshot.capabilities.cancellation);
      setRemoteState("ready");
      setConversationError(null);
      if (snapshot.activeRun) followRun(snapshot.activeRun.id);
    } catch {
      setRemoteState("error");
    }
  }, [conversationClient, followRun]);

  function retryLoad() {
    setRemoteState("loading");
    void loadConversation();
  }

  useEffect(() => {
    if (state) return;
    let mounted = true;
    void conversationClient
      .getCurrent()
      .then((snapshot) => {
        if (!mounted) return;
        setMessages(snapshot.messages);
        setCanCancel(snapshot.capabilities.cancellation);
        setRemoteState("ready");
        setConversationError(null);
        if (snapshot.activeRun) followRun(snapshot.activeRun.id);
      })
      .catch(() => {
        if (mounted) setRemoteState("error");
      });
    return () => {
      mounted = false;
      unsubscribeRef.current?.();
    };
  }, [conversationClient, followRun, state]);

  useEffect(() => {
    const thread = threadRef.current;
    if (thread) thread.scrollTop = thread.scrollHeight;
  }, [activeRunId, messages.length, streamingText]);

  async function startConversation() {
    const message = draft.trim();
    if (!message || activeRunId) return;
    const optimisticId = `optimistic-${crypto.randomUUID()}`;
    setMessages((current) => [
      ...current,
      {
        id: optimisticId,
        conversationId: "current",
        senderType: "human",
        content: message,
        status: "pending",
      },
    ]);
    setDraft("");
    setConversationError(null);
    try {
      const submission = await conversationClient.sendMessage(message, crypto.randomUUID());
      setMessages((current) =>
        current.map((item) => (item.id === optimisticId ? submission.message : item)),
      );
      if (surface === "home") {
        router.push("/conversation");
        return;
      }
      followRun(submission.run.id);
    } catch {
      setMessages((current) =>
        current.map((item) =>
          item.id === optimisticId ? { ...item, status: "failed" } : item,
        ),
      );
      setConversationError("消息未能发送，请稍后重试。" );
    }
  }

  async function stopRun() {
    if (!activeRunId) return;
    setPresenceLabel("Yoyoo 正在停止");
    try {
      await conversationClient.cancelRun(activeRunId);
    } catch {
      setConversationError("停止失败，当前回复状态正在重新确认。" );
    }
  }

  async function retryRun() {
    if (!failedRunId) return;
    try {
      const run = await conversationClient.retryRun(failedRunId);
      followRun(run.id);
    } catch {
      setConversationError("重试没有启动，请稍后再试。" );
    }
  }

  function enterLive() {
    setIsMuted(false);
    setIsLive(true);
  }

  function exitLive() {
    setIsMuted(false);
    setIsLive(false);
  }

  return (
    <div
      className="space-shell"
      data-home-state={effectiveState}
      data-live={isLive || undefined}
      data-surface={surface}
    >
      <a className="skip-link" href="#main-content">
        跳到主要内容
      </a>
      <Image
        alt=""
        aria-hidden="true"
        className="space-backdrop"
        fill
        priority
        sizes="100vw"
        src={rainCityBackdrop}
        unoptimized
      />
      <div className="space-scrim" aria-hidden="true" />
      <Sidebar activeItem={surface} />

      <main className="home-stage" id="main-content">
        <header className="home-header">
          <Link className="home-header__brand" href="/" aria-label="Yoyoo Space">
            <strong>Yoyoo</strong>
            <span>Space</span>
          </Link>
        </header>

        {effectiveState === "loading" ? (
          <HomeLoading surface={surface} />
        ) : effectiveState === "error" ? (
          <HomeError onRetry={onRetry ?? retryLoad} surface={surface} />
        ) : isLive ? (
          <LiveConversation
            isMuted={isMuted}
            onExit={exitLive}
            onToggleMute={() => setIsMuted((current) => !current)}
          />
        ) : surface === "conversation" ? (
          <ConversationWorkspace
            activeRunId={activeRunId}
            canCancel={canCancel}
            conversationError={conversationError}
            draft={draft}
            failedRunId={failedRunId}
            messages={messages}
            onChangeDraft={setDraft}
            onRetry={retryRun}
            onStartLive={enterLive}
            onStop={stopRun}
            onSubmit={startConversation}
            presenceLabel={presenceLabel}
            streamingText={streamingText}
            threadRef={threadRef}
          />
        ) : (
          <section className="home-canvas" aria-labelledby="home-greeting">
            <div
              className="home-focus"
              data-layout="centered-conversation"
              data-has-message={messages.length > 0 ? "true" : undefined}
            >
              <HomePresence label={presenceLabel} />

              <div className="greeting">
                <h1 id="home-greeting">晚上好，苏白。</h1>
              </div>

              {conversationError ? (
                <div className="conversation-notice" role="status">
                  <span>{conversationError}</span>
                  {failedRunId ? (
                    <button type="button" onClick={retryRun}>
                      <RotateCcw aria-hidden="true" size={13} />
                      重试
                    </button>
                  ) : null}
                </div>
              ) : null}

              <div className="home-canvas__composer">
                <HomeComposer
                  disabled={Boolean(activeRunId)}
                  onChange={setDraft}
                  onStartLive={enterLive}
                  onSubmit={startConversation}
                  value={draft}
                />
              </div>

              {messages.length > 0 || activeRunId ? (
                <Link
                  aria-label="继续上次对话"
                  className="home-continuation"
                  href="/conversation"
                >
                  <span>{activeRunId ? "Yoyoo 正在处理" : "已有一段对话"}</span>
                  <strong>继续上次对话</strong>
                </Link>
              ) : null}
            </div>
          </section>
        )}
      </main>
    </div>
  );
}

interface ConversationWorkspaceProps {
  activeRunId: string | null;
  canCancel: boolean;
  conversationError: string | null;
  draft: string;
  failedRunId: string | null;
  messages: ClientMessage[];
  onChangeDraft: (value: string) => void;
  onRetry: () => void;
  onStartLive: () => void;
  onStop: () => void;
  onSubmit: () => void;
  presenceLabel: string;
  streamingText: string;
  threadRef: RefObject<HTMLElement | null>;
}

function ConversationWorkspace({
  activeRunId,
  canCancel,
  conversationError,
  draft,
  failedRunId,
  messages,
  onChangeDraft,
  onRetry,
  onStartLive,
  onStop,
  onSubmit,
  presenceLabel,
  streamingText,
  threadRef,
}: ConversationWorkspaceProps) {
  const isEmpty = messages.length === 0 && !activeRunId;

  return (
    <section className="conversation-canvas" aria-label="Yoyoo 对话空间">
      <div
        className="conversation-workspace"
        data-empty={isEmpty || undefined}
        data-layout="full-height-conversation"
      >
        <div className="conversation-workspace__status">
          <HomePresence label={presenceLabel} />
        </div>
        <section
          className="conversation-thread conversation-workspace__thread"
          aria-label="当前对话"
          aria-live="polite"
          ref={threadRef}
        >
          {isEmpty ? (
            <div className="conversation-empty">
              <h1>晚上好，苏白。</h1>
              <p>从一个问题、一项任务，或者一个还没想清楚的念头开始。</p>
            </div>
          ) : null}

          {messages.map((message) => (
            <article
              className={`conversation-message conversation-message--${
                message.senderType === "human" ? "user" : "agent"
              }`}
              data-message-status={message.status}
              key={message.id}
            >
              <span>{message.senderType === "human" ? "你" : "Yoyoo"}</span>
              <p>{message.content}</p>
            </article>
          ))}

          {activeRunId ? (
            <article className="conversation-message conversation-message--agent">
              <span>Yoyoo</span>
              <p>{streamingText || "正在思考…"}</p>
              {canCancel ? (
                <button
                  className="conversation-action"
                  type="button"
                  onClick={onStop}
                  aria-label="停止回复"
                >
                  <Square aria-hidden="true" size={11} fill="currentColor" />
                  停止
                </button>
              ) : null}
            </article>
          ) : null}
        </section>

        <div className="conversation-workspace__footer">
          {conversationError ? (
            <div className="conversation-notice" role="status">
              <span>{conversationError}</span>
              {failedRunId ? (
                <button type="button" onClick={onRetry}>
                  <RotateCcw aria-hidden="true" size={13} />
                  重试
                </button>
              ) : null}
            </div>
          ) : null}
          <div className="conversation-workspace__composer">
            <HomeComposer
              disabled={Boolean(activeRunId)}
              onChange={onChangeDraft}
              onStartLive={onStartLive}
              onSubmit={onSubmit}
              value={draft}
            />
          </div>
          <p className="conversation-workspace__caption">Yoyoo 也可能犯错，请核对重要信息。</p>
        </div>
      </div>
    </section>
  );
}

interface LiveConversationProps {
  isMuted: boolean;
  onExit: () => void;
  onToggleMute: () => void;
}

function LiveConversation({ isMuted, onExit, onToggleMute }: LiveConversationProps) {
  const liveStatus = isMuted ? "麦克风已静音" : "正在聆听";

  return (
    <section
      className="live-canvas"
      aria-labelledby="live-title"
      data-muted={isMuted || undefined}
    >
      <div className="live-focus">
        <h1 id="live-title">Yoyoo Live</h1>
        <div className="live-orb">
          <YoyooOrb
            size="var(--live-orb-size)"
            state={isMuted ? "muted" : "listening"}
          />
        </div>
        <div className="live-status" id="live-status" aria-live="polite">
          <span className="live-status__signal" aria-hidden="true" />
          <span>{liveStatus}</span>
        </div>
      </div>

      <div className="live-controls" aria-label="语音对话控制">
        <button
          type="button"
          className="live-controls__button"
          onClick={onToggleMute}
          aria-label={isMuted ? "取消静音" : "静音"}
          title={isMuted ? "取消静音" : "静音"}
        >
          {isMuted ? (
            <MicOff aria-hidden="true" size={20} strokeWidth={1.7} />
          ) : (
            <Mic aria-hidden="true" size={20} strokeWidth={1.7} />
          )}
        </button>
        <button
          type="button"
          className="live-controls__button live-controls__button--end"
          onClick={onExit}
          aria-label="结束语音对话"
          title="结束语音对话"
        >
          <X aria-hidden="true" size={22} strokeWidth={1.7} />
        </button>
      </div>
    </section>
  );
}

function HomePresence({ label }: { label: string }) {
  return (
    <div className="home-presence" aria-live="polite">
      <span className="home-presence__signal" aria-hidden="true" />
      <span>{label}</span>
    </div>
  );
}

function HomeLoading({ surface }: { surface: "home" | "conversation" }) {
  return (
    <section
      className="home-loading"
      aria-label={surface === "home" ? "正在加载 Yoyoo 首页" : "正在加载 Yoyoo 对话"}
      aria-busy="true"
    >
      <div className="home-loading__presence" />
      <div className="home-loading__copy">
        <span />
        <strong />
      </div>
      <div className="home-loading__composer" />
    </section>
  );
}

function HomeError({
  onRetry,
  surface,
}: {
  onRetry?: () => void;
  surface: "home" | "conversation";
}) {
  return (
    <section className="home-error">
      <p>连接中断</p>
      <h1>{surface === "home" ? "首页暂时无法载入" : "对话暂时无法载入"}</h1>
      <span>页面框架仍然可用，可以重新尝试。</span>
      <button type="button" onClick={onRetry}>
        <RotateCcw aria-hidden="true" size={17} strokeWidth={1.8} />
        重新载入
      </button>
    </section>
  );
}
