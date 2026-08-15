"use client";

import { RotateCcw } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import { Sidebar } from "@/components/shell/sidebar";
import {
  browserRoomClient,
  type CurrentWorkspace,
  type RoomClient,
} from "@/lib/room-client";

import { HomeComposer } from "./home-composer";
import type { HomeState } from "./home-types";

interface HomeExperienceProps {
  roomClient?: RoomClient;
  state?: HomeState;
  onRetry?: () => void;
}

function greetingFor(displayName: string, hour = new Date().getHours()): string {
  const period = hour < 6
    ? "夜深了"
    : hour < 12
      ? "早上好"
      : hour < 18
        ? "下午好"
        : "晚上好";
  return `${period}，${displayName}。`;
}

export function HomeExperience({
  roomClient = browserRoomClient,
  state,
  onRetry,
}: HomeExperienceProps) {
  const router = useRouter();
  const [draft, setDraft] = useState("");
  const [workspace, setWorkspace] = useState<CurrentWorkspace | null>(null);
  const [remoteState, setRemoteState] = useState<HomeState>("loading");
  const [submitting, setSubmitting] = useState(false);
  const [conversationError, setConversationError] = useState<string | null>(null);
  const effectiveState = state ?? remoteState;
  const targetRoom = workspace?.rooms[0] ?? null;

  const loadWorkspace = useCallback(async () => {
    try {
      const current = await roomClient.getCurrentWorkspace();
      setWorkspace(current);
      setRemoteState("ready");
      setConversationError(null);
    } catch {
      setRemoteState("error");
    }
  }, [roomClient]);

  useEffect(() => {
    if (state) return;
    const timer = window.setTimeout(() => void loadWorkspace(), 0);
    return () => window.clearTimeout(timer);
  }, [loadWorkspace, state]);

  async function startConversation() {
    const content = draft.trim();
    if (!content || submitting) return;
    if (!targetRoom) {
      setConversationError("当前没有可用会话，请先在对话页创建会话。");
      return;
    }

    setSubmitting(true);
    setConversationError(null);
    try {
      await roomClient.sendMessage(targetRoom.id, {
        content,
        mentionedPrincipalIds: [],
        idempotencyKey: crypto.randomUUID(),
      });
      setDraft("");
      router.push(`/conversation?room=${encodeURIComponent(targetRoom.id)}`);
    } catch {
      setConversationError("消息未能发送，请稍后重试。");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      className="space-shell"
      data-home-state={effectiveState}
      data-surface="home"
    >
      <a className="skip-link" href="#main-content">
        跳到主要内容
      </a>
      <Sidebar activeItem="home" />

      <main className="home-stage" id="main-content">
        <header className="home-header">
          <Link className="home-header__brand" href="/" aria-label="Yoyoo Space">
            <strong>Yoyoo</strong>
            <span>Space</span>
          </Link>
        </header>

        {effectiveState === "loading" ? (
          <HomeLoading />
        ) : effectiveState === "error" ? (
          <HomeError onRetry={onRetry ?? (() => void loadWorkspace())} />
        ) : (
          <section className="home-canvas" aria-labelledby="home-greeting">
            <div className="home-focus" data-layout="centered-conversation">
              <HomePresence label="Yoyoo 在线" />

              <div className="greeting">
                <h1 id="home-greeting">
                  {greetingFor(workspace?.principal.displayName ?? "你")}
                </h1>
              </div>

              {conversationError ? (
                <div className="conversation-notice" role="status">
                  <span>{conversationError}</span>
                </div>
              ) : null}

              <div className="home-canvas__composer">
                <HomeComposer
                  disabled={submitting}
                  onChange={setDraft}
                  onSubmit={startConversation}
                  value={draft}
                />
              </div>

              {targetRoom ? (
                <Link
                  aria-label="继续上次对话"
                  className="home-continuation"
                  href={`/conversation?room=${encodeURIComponent(targetRoom.id)}`}
                >
                  <span>{targetRoom.lastMessagePreview ? "已有一段对话" : targetRoom.name}</span>
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

function HomePresence({ label }: { label: string }) {
  return (
    <div className="home-presence" aria-live="polite">
      <span className="home-presence__signal" aria-hidden="true" />
      <span>{label}</span>
    </div>
  );
}

function HomeLoading() {
  return (
    <section className="home-loading" aria-label="正在加载 Yoyoo 首页" aria-busy="true">
      <div className="home-loading__presence" />
      <div className="home-loading__copy">
        <span />
        <strong />
      </div>
      <div className="home-loading__composer" />
    </section>
  );
}

function HomeError({ onRetry }: { onRetry?: () => void }) {
  return (
    <section className="home-error">
      <p>连接中断</p>
      <h1>首页暂时无法载入</h1>
      <span>页面框架仍然可用，可以重新尝试。</span>
      <button type="button" onClick={onRetry}>
        <RotateCcw aria-hidden="true" size={17} strokeWidth={1.8} />
        重新载入
      </button>
    </section>
  );
}
