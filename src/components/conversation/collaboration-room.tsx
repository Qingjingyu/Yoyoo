"use client";

import {
  Archive,
  ArrowDown,
  ArrowRight,
  Check,
  ChevronDown,
  ChevronUp,
  Copy,
  FileText,
  Menu,
  MessageCircle,
  MoreHorizontal,
  Pencil,
  Pin,
  PinOff,
  Plus,
  RotateCcw,
  Search as SearchIcon,
  Send,
  Square,
  Trash2,
  Undo2,
  UserPlus,
  Users,
  X,
} from "lucide-react";
import Link from "next/link";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";

import { AttachmentComposer } from "@/components/conversation/attachment-composer";
import { AttachmentView } from "@/components/conversation/attachment-view";
import { ConversationSearch } from "@/components/conversation/conversation-search";
import { RoomFiles } from "@/components/conversation/room-files";
import { Sidebar } from "@/components/shell/sidebar";
import type {
  AttachmentMetadata,
  CollaborationRunRecord,
  RoomMessageRecord,
  RoomMemberStateRecord,
  RoomRecord,
  RoomSummaryRecord,
} from "@/domain/collaboration";
import type { AttachmentClient } from "@/lib/attachment-client";
import type { SearchResult } from "@/lib/search-client";
import {
  browserRoomClient,
  type CurrentWorkspace,
  type RoomClient,
  type RoomMembershipDetails,
  type RoomRunEvent,
  type RoomSnapshot,
} from "@/lib/room-client";

interface CollaborationRoomProps {
  client?: RoomClient;
  attachmentClient?: AttachmentClient;
}

const activeStatuses = new Set(["queued", "running", "waiting"]);
const retryableStatuses = new Set(["failed", "stopped"]);

function operationKey(): string {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
}

function shortAgentName(name: string): string {
  return name.replace(/^Local\s+/i, "");
}

function runLabel(status: CollaborationRunRecord["status"]): string {
  return {
    queued: "准备中",
    running: "执行中",
    waiting: "等待中",
    completed: "已完成",
    stopped: "已停止",
    failed: "执行失败",
  }[status];
}

function requestedRoomId(): string | null {
  if (typeof window === "undefined") return null;
  return new URLSearchParams(window.location.search).get("room");
}

function updateRoomUrl(roomId: string | null, mode: "push" | "replace"): void {
  const url = new URL(window.location.href);
  if (roomId) url.searchParams.set("room", roomId);
  else url.searchParams.delete("room");
  window.history[mode === "push" ? "pushState" : "replaceState"](
    {},
    "",
    `${url.pathname}${url.search}${url.hash}`,
  );
}

export function isTimelineNearBottom(
  timeline: Pick<HTMLElement, "clientHeight" | "scrollHeight" | "scrollTop">,
  threshold = 120,
): boolean {
  return timeline.scrollHeight - timeline.clientHeight - timeline.scrollTop <= threshold;
}

function sortRoomsByActivity(rooms: RoomSummaryRecord[]): RoomSummaryRecord[] {
  const activityTime = (room: RoomSummaryRecord) => {
    const value = room.lastActivityAt ?? room.updatedAt ?? room.createdAt;
    const time = value ? new Date(value).getTime() : 0;
    return Number.isNaN(time) ? 0 : time;
  };
  return [...rooms].sort((left, right) => activityTime(right) - activityTime(left));
}

export function CollaborationRoom({
  client = browserRoomClient,
  attachmentClient,
}: CollaborationRoomProps) {
  const [workspace, setWorkspace] = useState<CurrentWorkspace | null>(null);
  const [snapshot, setSnapshot] = useState<RoomSnapshot | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [draft, setDraft] = useState("");
  const [selectedAgentIds, setSelectedAgentIds] = useState<string[]>([]);
  const [streamText, setStreamText] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const [readyAttachments, setReadyAttachments] = useState<AttachmentMetadata[]>([]);
  const [attachmentUploadBusy, setAttachmentUploadBusy] = useState(false);
  const [attachmentComposerKey, setAttachmentComposerKey] = useState(0);
  const [roomTransitioning, setRoomTransitioning] = useState(false);
  const [roomRailOpen, setRoomRailOpen] = useState(false);
  const [creatingRoom, setCreatingRoom] = useState(false);
  const [detailsRoomId, setDetailsRoomId] = useState<string | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [focusedMessageId, setFocusedMessageId] = useState<string | null>(null);
  const [replyToMessageId, setReplyToMessageId] = useState<string | null>(null);
  const [newRoomName, setNewRoomName] = useState("");
  const [roomCreationState, setRoomCreationState] = useState<
    "idle" | "creating" | "error"
  >("idle");
  const subscriptions = useRef(new Map<string, () => void>());
  const timelineRef = useRef<HTMLElement | null>(null);
  const shouldFollowTimelineRef = useRef(true);
  const draftRoomIdRef = useRef<string | null>(null);
  const draftRevisionRef = useRef(0);
  const persistedDraftRef = useRef("");
  const draftSaveQueueRef = useRef<Promise<RoomMemberStateRecord | null>>(
    Promise.resolve(null),
  );
  const [hasUnseenContent, setHasUnseenContent] = useState(false);
  const roomId = snapshot?.room.id;

  const roomAgents = useMemo(() => {
    if (!workspace || !snapshot) return [];
    const activeAgentIds = new Set(
      snapshot.members
        .filter(
          (member) =>
            member.principalKind === "agent" && member.status === "active",
        )
        .map((member) => member.principalId),
    );
    return workspace.agents.filter((agent) => activeAgentIds.has(agent.principalId));
  }, [snapshot, workspace]);

  const closeSubscriptions = useCallback(() => {
    for (const unsubscribe of subscriptions.current.values()) unsubscribe();
    subscriptions.current.clear();
  }, []);

  const applyLoadedRoom = useCallback(
    (current: CurrentWorkspace, roomSnapshot: RoomSnapshot) => {
      shouldFollowTimelineRef.current = true;
      setHasUnseenContent(false);
      setWorkspace(current);
      setSnapshot(roomSnapshot);
      const memberState = roomSnapshot.memberState;
      draftRoomIdRef.current = roomSnapshot.room.id;
      draftRevisionRef.current = memberState?.draftRevision ?? 0;
      persistedDraftRef.current = memberState?.draftContent ?? "";
      setDraft(memberState?.draftContent ?? "");
      setFocusedMessageId(memberState?.readingMessageId ?? null);
      const activeAgentIds = new Set(
        roomSnapshot.members
          .filter(
            (member) =>
              member.principalKind === "agent" && member.status === "active",
          )
          .map((member) => member.principalId),
      );
      const availableAgentIds = current.agents
        .map((agent) => agent.principalId)
        .filter((principalId) => activeAgentIds.has(principalId));
      setSelectedAgentIds((currentSelection) => {
        const retained = currentSelection.filter((principalId) =>
          activeAgentIds.has(principalId),
        );
        return retained.length > 0
          ? retained
          : availableAgentIds[0]
            ? [availableAgentIds[0]]
            : [];
      });
      setNotice(null);
      setReplyToMessageId(null);
      setState("ready");
    },
    [],
  );

  const loadRoom = useCallback(async () => {
    setState("loading");
    try {
      const current = await client.getCurrentWorkspace();
      const requested = requestedRoomId();
      const room = current.rooms.find((candidate) => candidate.id === requested)
        ?? current.rooms[0];
      if (!room) {
        closeSubscriptions();
        setWorkspace(current);
        setSnapshot(null);
        setState("ready");
        updateRoomUrl(null, "replace");
        return;
      }
      const roomSnapshot = await client.getRoom(room.id);
      applyLoadedRoom(current, roomSnapshot);
      updateRoomUrl(room.id, "replace");
    } catch (error) {
      console.error("[Yoyoo] Failed to load collaboration room", error);
      setState("error");
    }
  }, [applyLoadedRoom, client, closeSubscriptions]);

  const selectRoom = useCallback(async (
    room: RoomRecord,
    historyMode: "push" | "replace" = "push",
  ) => {
    if (room.id === snapshot?.room.id) {
      setRoomRailOpen(false);
      return;
    }
    setDetailsRoomId(null);
    setRoomTransitioning(true);
    setNotice(null);
    shouldFollowTimelineRef.current = true;
    setHasUnseenContent(false);
    closeSubscriptions();
    try {
      const roomSnapshot = await client.getRoom(room.id);
      setSnapshot(roomSnapshot);
      const memberState = roomSnapshot.memberState;
      draftRoomIdRef.current = roomSnapshot.room.id;
      draftRevisionRef.current = memberState?.draftRevision ?? 0;
      persistedDraftRef.current = memberState?.draftContent ?? "";
      setDraft(memberState?.draftContent ?? "");
      setFocusedMessageId(memberState?.readingMessageId ?? null);
      const activeAgentIds = new Set(
        roomSnapshot.members
          .filter(
            (member) =>
              member.principalKind === "agent" && member.status === "active",
          )
          .map((member) => member.principalId),
      );
      setSelectedAgentIds((current) =>
        current.filter((principalId) => activeAgentIds.has(principalId)),
      );
      setStreamText({});
      setReplyToMessageId(null);
      setReadyAttachments([]);
      setAttachmentComposerKey((current) => current + 1);
      updateRoomUrl(room.id, historyMode);
      setRoomRailOpen(false);
    } catch {
      setNotice("房间暂时无法载入，请稍后重试。");
    } finally {
      setRoomTransitioning(false);
    }
  }, [client, closeSubscriptions, snapshot?.room.id]);

  const persistDraft = useCallback((targetRoomId: string, content: string) => {
    const save = draftSaveQueueRef.current
      .catch(() => null)
      .then(async () => {
        if (draftRoomIdRef.current !== targetRoomId) return null;
        if (persistedDraftRef.current === content) {
          return null;
        }
        const memberState = await client.saveDraft(
          targetRoomId,
          content,
          draftRevisionRef.current,
        );
        if (draftRoomIdRef.current === targetRoomId) {
          draftRevisionRef.current = memberState.draftRevision;
          persistedDraftRef.current = memberState.draftContent;
          setSnapshot((current) => current?.room.id === targetRoomId
            ? { ...current, memberState }
            : current);
        }
        return memberState;
      });
    draftSaveQueueRef.current = save;
    return save;
  }, [client]);

  useEffect(() => {
    if (!roomId || pendingAction === "send" || draft === persistedDraftRef.current) {
      return;
    }
    const timeout = window.setTimeout(() => {
      void persistDraft(roomId, draft).catch(() => {
        setNotice("草稿暂时未能同步，内容仍保留在当前窗口。");
      });
    }, 650);
    return () => window.clearTimeout(timeout);
  }, [draft, pendingAction, persistDraft, roomId]);

  const refreshSnapshot = useCallback(async () => {
    if (!roomId) return;
    try {
      const [roomSnapshot, current] = await Promise.all([
        client.getRoom(roomId),
        client.getCurrentWorkspace(),
      ]);
      setSnapshot((active) => active?.room.id === roomId ? roomSnapshot : active);
      setWorkspace(current);
      setNotice(null);
    } catch {
      setNotice("房间状态未能同步，正在保留当前内容。" );
    }
  }, [client, roomId]);

  useEffect(() => {
    let mounted = true;
    void client
      .getCurrentWorkspace()
      .then(async (current) => {
        const requested = requestedRoomId();
        const room = current.rooms.find((candidate) => candidate.id === requested)
          ?? current.rooms[0];
        if (!room) return [current, null] as const;
        return Promise.all([Promise.resolve(current), client.getRoom(room.id)] as const);
      })
      .then(([current, roomSnapshot]) => {
        if (mounted) {
          if (roomSnapshot) {
            applyLoadedRoom(current, roomSnapshot);
            updateRoomUrl(roomSnapshot.room.id, "replace");
          } else {
            setWorkspace(current);
            setSnapshot(null);
            setState("ready");
            updateRoomUrl(null, "replace");
          }
        }
      })
      .catch((error) => {
        console.error("[Yoyoo] Failed to initialize collaboration room", error);
        if (mounted) setState("error");
      });
    const activeSubscriptions = subscriptions.current;
    return () => {
      mounted = false;
      for (const unsubscribe of activeSubscriptions.values()) unsubscribe();
      activeSubscriptions.clear();
    };
  }, [applyLoadedRoom, client]);

  useEffect(() => {
    if (!workspace) return;
    const handlePopState = () => {
      const requested = requestedRoomId();
      const room = workspace.rooms.find((candidate) => candidate.id === requested)
        ?? workspace.rooms[0];
      if (room) void selectRoom(room, "replace");
    };
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, [selectRoom, workspace]);

  const applyRunEvent = useCallback(
    (event: RoomRunEvent) => {
      if (event.type === "text_delta" && event.delta) {
        setStreamText((current) => ({
          ...current,
          [event.runId]: `${current[event.runId] ?? ""}${event.delta}`,
        }));
      }
      const status =
        event.type === "failed"
          ? "failed"
          : event.type === "stopped"
            ? "stopped"
            : event.type === "completed"
              ? "completed"
              : event.type === "status"
                ? "running"
                : null;
      if (status) {
        setSnapshot((current) =>
          current
            ? {
                ...current,
                runs: current.runs.map((run) =>
                  run.id === event.runId
                    ? {
                        ...run,
                        status,
                        errorCode: event.error?.code ?? run.errorCode,
                        errorMessage: event.error?.message ?? run.errorMessage,
                      }
                    : run,
                ),
              }
            : current,
        );
      }
      if (["completed", "failed", "stopped"].includes(event.type)) {
        subscriptions.current.get(event.runId)?.();
        subscriptions.current.delete(event.runId);
        void refreshSnapshot();
      }
    },
    [refreshSnapshot],
  );

  useEffect(() => {
    if (!snapshot) return;
    for (const run of snapshot.runs) {
      if (!activeStatuses.has(run.status) || subscriptions.current.has(run.id)) continue;
      const unsubscribe = client.subscribeToRun(snapshot.room.id, run.id, {
        onEvent: applyRunEvent,
        onOpen: () => setNotice(null),
        onReconnecting: () => setNotice("事件连接中断，正在恢复。"),
      });
      subscriptions.current.set(run.id, unsubscribe);
    }
  }, [applyRunEvent, client, snapshot]);

  useEffect(() => {
    const timeline = timelineRef.current;
    if (!timeline) return;
    if (shouldFollowTimelineRef.current) {
      timeline.scrollTop = timeline.scrollHeight;
      setHasUnseenContent(false);
      return;
    }
    setHasUnseenContent(true);
  }, [snapshot?.messages.length, snapshot?.artifacts.length, streamText]);

  useEffect(() => {
    if (!snapshot || !shouldFollowTimelineRef.current) return;
    const latest = [...snapshot.messages]
      .reverse()
      .find((message) => message.status === "completed" && !message.retractedAt);
    if (!latest || snapshot.memberState?.lastReadMessageId === latest.id) return;
    void client.updateReadState(snapshot.room.id, {
      lastReadMessageId: latest.id,
      readingMessageId: latest.id,
    }).then((memberState) => {
      setSnapshot((current) => current?.room.id === memberState.roomId
        ? { ...current, memberState }
        : current);
      setWorkspace((current) => current ? {
        ...current,
        rooms: current.rooms.map((room) => room.id === memberState.roomId
          ? { ...room, unreadCount: 0 }
          : room),
      } : current);
    }).catch(() => {
      setNotice("阅读状态暂时未能同步。");
    });
  }, [client, snapshot]);

  useEffect(() => {
    if (!focusedMessageId || !snapshot?.messages.some((message) => message.id === focusedMessageId)) {
      return;
    }
    const frame = window.requestAnimationFrame(() => {
      const message = document.getElementById(`message-${focusedMessageId}`);
      if (typeof message?.scrollIntoView === "function") {
        message.scrollIntoView({ behavior: "smooth", block: "center" });
      }
    });
    const timeout = window.setTimeout(() => setFocusedMessageId(null), 2_400);
    return () => {
      window.cancelAnimationFrame(frame);
      window.clearTimeout(timeout);
    };
  }, [focusedMessageId, snapshot?.messages]);

  function handleTimelineScroll() {
    const timeline = timelineRef.current;
    if (!timeline) return;
    const nearBottom = isTimelineNearBottom(timeline);
    shouldFollowTimelineRef.current = nearBottom;
    if (nearBottom) setHasUnseenContent(false);
  }

  function returnToLatest() {
    const timeline = timelineRef.current;
    if (!timeline) return;
    shouldFollowTimelineRef.current = true;
    timeline.scrollTop = timeline.scrollHeight;
    setHasUnseenContent(false);
    const latest = snapshot?.messages.at(-1);
    if (snapshot && latest) {
      void client.updateReadState(snapshot.room.id, {
        lastReadMessageId: latest.id,
        readingMessageId: latest.id,
      }).then((memberState) => {
        setSnapshot((current) => current ? { ...current, memberState } : current);
      }).catch(() => setNotice("阅读状态暂时未能同步。"));
    }
  }

  const membersById = useMemo(
    () => new Map(snapshot?.members.map((member) => [member.principalId, member]) ?? []),
    [snapshot?.members],
  );
  const messagesById = useMemo(
    () => new Map(snapshot?.messages.map((message) => [message.id, message]) ?? []),
    [snapshot?.messages],
  );
  const replyTarget = replyToMessageId
    ? messagesById.get(replyToMessageId) ?? null
    : null;
  const cancellableAgentIds = useMemo(
    () => new Set(
      workspace?.agents
        .filter((agent) => agent.capabilities.cancellation !== false)
        .map((agent) => agent.principalId) ?? [],
    ),
    [workspace?.agents],
  );

  function toggleAgent(principalId: string) {
    setSelectedAgentIds((current) =>
      current.includes(principalId)
        ? current.filter((id) => id !== principalId)
        : [...current, principalId],
    );
  }

  function selectAllAgents() {
    setSelectedAgentIds(roomAgents.map((agent) => agent.principalId));
  }

  async function sendMessage() {
    const content = draft.trim();
    if (
      (!content && readyAttachments.length === 0) ||
      attachmentUploadBusy ||
      !snapshot ||
      !workspace ||
      pendingAction === "send"
    ) return;
    const idempotencyKey = operationKey();
    const selectedReply = replyTarget;
    const optimisticId = `optimistic-${idempotencyKey}`;
    const now = new Date();
    const optimistic = {
      id: optimisticId,
      roomId: snapshot.room.id,
      senderPrincipalId: workspace.principal.id,
      kind: "message",
      content,
      status: "pending",
      idempotencyKey,
      replyToMessageId: selectedReply?.id ?? null,
      threadRootMessageId: null,
      mentionedPrincipalIds: selectedAgentIds,
      revisionNumber: 1,
      retractedAt: null,
      retractedByPrincipalId: null,
      createdAt: now,
      updatedAt: now,
    } satisfies RoomMessageRecord;
    setReplyToMessageId(null);
    setNotice(null);
    setPendingAction("send");
    setSnapshot((current) =>
      current ? {
        ...current,
        messages: [...current.messages, optimistic],
        attachments: [
          ...(current.attachments ?? []),
          ...readyAttachments.map((attachment, position) => ({
            ...attachment,
            roomId: snapshot.room.id,
            messageId: optimisticId,
            position,
            linkedAt: now,
          })),
        ],
      } : current,
    );
    try {
      const savedDraft = await persistDraft(snapshot.room.id, draft);
      const submittedDraftRevision = savedDraft?.draftRevision
        ?? draftRevisionRef.current;
      const submission = await client.sendMessage(snapshot.room.id, {
        content,
        mentionedPrincipalIds: roomAgents
          .filter((agent) => selectedAgentIds.includes(agent.principalId))
          .map((agent) => agent.principalId),
        attachmentIds: readyAttachments.map((attachment) => attachment.id),
        idempotencyKey,
        replyToMessageId: selectedReply?.id ?? null,
        draftRevision: submittedDraftRevision,
      });
      const nextMemberState = submission.memberState ?? {
        ...snapshot.memberState,
        draftContent: "",
        draftRevision: submittedDraftRevision + 1,
      };
      draftRevisionRef.current = nextMemberState.draftRevision;
      persistedDraftRef.current = nextMemberState.draftContent;
      setDraft("");
      setSnapshot((current) =>
        current
          ? {
              ...current,
              messages: current.messages.map((message) =>
                message.id === optimisticId ? submission.message : message,
              ),
              attachments: (current.attachments ?? []).map((attachment) =>
                attachment.messageId === optimisticId
                  ? { ...attachment, messageId: submission.message.id }
                  : attachment,
              ),
              runs: [
                ...current.runs,
                ...submission.runs.filter(
                  (run) => !current.runs.some((existing) => existing.id === run.id),
                ),
              ],
              memberState: nextMemberState,
            }
          : current,
      );
      setReadyAttachments([]);
      setAttachmentComposerKey((current) => current + 1);
      void client.getCurrentWorkspace().then(setWorkspace).catch(() => {
        setNotice("消息已发送，房间摘要稍后同步。");
      });
    } catch {
      setReplyToMessageId(selectedReply?.id ?? null);
      setSnapshot((current) =>
        current
          ? {
              ...current,
              messages: current.messages.map((message) =>
                message.id === optimisticId ? { ...message, status: "failed" } : message,
              ),
            }
          : current,
      );
      setNotice("消息未能发送，请保留内容后重试。" );
    } finally {
      setPendingAction(null);
    }
  }

  async function intervene(run: CollaborationRunRecord, agentName: string) {
    if (!snapshot) return;
    setPendingAction(`intervene-${run.id}`);
    try {
      const interventionMessage = await client.intervene(
        snapshot.room.id,
        run.id,
        `苏白已要求 ${agentName} 停止本次执行。`,
        operationKey(),
      );
      setSnapshot((current) =>
        current && !current.messages.some((message) => message.id === interventionMessage.id)
          ? { ...current, messages: [...current.messages, interventionMessage] }
          : current,
      );
      setNotice(`${agentName} 正在停止。`);
    } catch {
      setNotice(`未能停止 ${agentName}，请重新确认运行状态。`);
    } finally {
      setPendingAction(null);
    }
  }

  async function retry(run: CollaborationRunRecord, agentName: string) {
    if (!snapshot) return;
    setPendingAction(`retry-${run.id}`);
    try {
      const result = await client.retryRun(snapshot.room.id, run.id, operationKey());
      setSnapshot((current) =>
        current ? { ...current, runs: [...current.runs, result.run] } : current,
      );
      setNotice(`${agentName} 已重新开始。`);
    } catch {
      setNotice(`${agentName} 暂时无法重试。`);
    } finally {
      setPendingAction(null);
    }
  }

  async function editMessage(message: RoomMessageRecord, content: string) {
    if (!snapshot) return false;
    setPendingAction(`edit-${message.id}`);
    try {
      const edited = await client.editMessage(
        snapshot.room.id,
        message.id,
        content,
        message.revisionNumber,
      );
      setSnapshot((current) => current ? {
        ...current,
        messages: current.messages.map((candidate) =>
          candidate.id === edited.id ? edited : candidate,
        ),
      } : current);
      setNotice("消息已更新。");
      return true;
    } catch {
      setNotice("消息未能更新，可能已在其他窗口发生变化。");
      return false;
    } finally {
      setPendingAction(null);
    }
  }

  async function retractMessage(message: RoomMessageRecord) {
    if (!snapshot) return false;
    setPendingAction(`retract-${message.id}`);
    try {
      const retracted = await client.retractMessage(
        snapshot.room.id,
        message.id,
        message.revisionNumber,
      );
      setSnapshot((current) => current ? {
        ...current,
        messages: current.messages.map((candidate) =>
          candidate.id === retracted.id ? retracted : candidate,
        ),
        attachments: (current.attachments ?? []).filter(
          (attachment) => attachment.messageId !== retracted.id,
        ),
      } : current);
      if (replyToMessageId === message.id) setReplyToMessageId(null);
      setNotice("消息已撤回。");
      return true;
    } catch {
      setNotice("消息未能撤回；执行中的任务需要先停止。");
      return false;
    } finally {
      setPendingAction(null);
    }
  }

  function handleComposerKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void sendMessage();
    }
  }

  async function createRoom() {
    const name = newRoomName.trim();
    if (!workspace || !name || name.length > 80 || roomCreationState === "creating") {
      return;
    }
    setRoomCreationState("creating");
    try {
      const result = await client.createRoom(name, operationKey());
      const [nextWorkspace, roomSnapshot] = await Promise.all([
        client.getCurrentWorkspace(),
        client.getRoom(result.room.id),
      ]);
      closeSubscriptions();
      applyLoadedRoom(nextWorkspace, roomSnapshot);
      setStreamText({});
      setNewRoomName("");
      setCreatingRoom(false);
      setRoomRailOpen(false);
      setRoomCreationState("idle");
      updateRoomUrl(result.room.id, "push");
    } catch {
      setRoomCreationState("error");
    }
  }

  async function renameManagedRoom(room: RoomSummaryRecord, name: string) {
    const renamed = await client.renameRoom(room.id, name);
    setWorkspace((current) => current ? {
      ...current,
      rooms: current.rooms.map((candidate) => candidate.id === room.id
        ? { ...candidate, ...renamed }
        : candidate),
    } : current);
    setSnapshot((current) => current?.room.id === room.id
      ? { ...current, room: { ...current.room, ...renamed } }
      : current);
  }

  async function updateManagedRoomPurpose(
    room: RoomSummaryRecord,
    purpose: string,
  ) {
    const updated = await client.setRoomPurpose(room.id, purpose);
    setWorkspace((current) => current ? {
      ...current,
      rooms: current.rooms.map((candidate) => candidate.id === room.id
        ? { ...candidate, ...updated }
        : candidate),
    } : current);
    setSnapshot((current) => current?.room.id === room.id
      ? { ...current, room: { ...current.room, ...updated } }
      : current);
  }

  async function updateManagedRoomListState(
    room: RoomSummaryRecord,
    action: "pin" | "unpin" | "hide" | "show",
  ) {
    await client.updateRoomListState(room.id, action);
    const nextWorkspace = await client.getCurrentWorkspace();
    setWorkspace(nextWorkspace);
    if (action === "hide" && snapshot?.room.id === room.id) {
      const nextRoom = nextWorkspace.rooms.find((candidate) => candidate.id !== room.id);
      if (nextRoom) await selectRoom(nextRoom, "replace");
    }
  }

  async function archiveManagedRoom(room: RoomSummaryRecord) {
    const archived = await client.setRoomStatus(room.id, "archived");
    const nextRoom = workspace?.rooms.find((candidate) => candidate.id !== room.id) ?? null;
    setWorkspace((current) => {
      if (!current) return current;
      const archivedSummary: RoomSummaryRecord = {
        ...room,
        ...archived,
        name: room.name,
        lastActivityAt: archived.updatedAt ?? room.lastActivityAt,
      };
      return {
        ...current,
        rooms: current.rooms.filter((candidate) => candidate.id !== room.id),
        archivedRooms: sortRoomsByActivity([
          archivedSummary,
          ...current.archivedRooms.filter((candidate) => candidate.id !== room.id),
        ]),
      };
    });
    if (snapshot?.room.id === room.id && nextRoom) {
      await selectRoom(nextRoom, "replace");
    }
    setNotice(`${room.name} 已归档，历史消息仍被保留。`);
  }

  async function restoreManagedRoom(room: RoomSummaryRecord) {
    const restored = await client.setRoomStatus(room.id, "active");
    setWorkspace((current) => {
      if (!current) return current;
      const restoredSummary: RoomSummaryRecord = {
        ...room,
        ...restored,
        name: room.name,
        lastActivityAt: restored.updatedAt ?? room.lastActivityAt,
      };
      return {
        ...current,
        rooms: sortRoomsByActivity([
          restoredSummary,
          ...current.rooms.filter((candidate) => candidate.id !== room.id),
        ]),
        archivedRooms: current.archivedRooms.filter((candidate) => candidate.id !== room.id),
      };
    });
    setNotice(`${room.name} 已恢复。`);
  }

  async function openRoomDetails(room: RoomSummaryRecord) {
    if (room.id !== snapshot?.room.id) await selectRoom(room);
    setRoomRailOpen(false);
    setDetailsRoomId(room.id);
  }

  async function openSourceMessage(result: Pick<SearchResult, "roomId" | "messageId">) {
    const room = workspace?.rooms.find((candidate) => candidate.id === result.roomId)
      ?? workspace?.archivedRooms.find((candidate) => candidate.id === result.roomId);
    if (!room) {
      setNotice("这条内容所在的房间当前不可访问。");
      return;
    }
    await selectRoom(room);
    setFocusedMessageId(result.messageId);
    setSearchOpen(false);
    setDetailsRoomId(null);
  }

  async function refreshMembership() {
    if (!snapshot) return;
    const roomSnapshot = await client.getRoom(snapshot.room.id);
    setSnapshot(roomSnapshot);
    const activeAgentIds = new Set(
      roomSnapshot.members
        .filter(
          (member) =>
            member.principalKind === "agent" && member.status === "active",
        )
        .map((member) => member.principalId),
    );
    setSelectedAgentIds((current) =>
      current.filter((principalId) => activeAgentIds.has(principalId)),
    );
  }

  const detailsRoom = detailsRoomId
    ? workspace?.rooms.find((room) => room.id === detailsRoomId) ?? null
    : null;

  return (
    <div
      className="space-shell room-shell"
      data-has-room-rail={workspace ? true : undefined}
      data-room-details={detailsRoom ? true : undefined}
      data-room-state={state}
    >
      <a className="skip-link" href="#room-main">跳到房间内容</a>
      <Sidebar activeItem="conversation" />

      {workspace ? (
        <RoomRail
          activeRoomId={snapshot?.room.id ?? null}
          creating={creatingRoom}
          creationState={roomCreationState}
          name={newRoomName}
          onCancelCreate={() => {
            setCreatingRoom(false);
            setNewRoomName("");
            setRoomCreationState("idle");
          }}
          onChangeName={(value) => {
            setNewRoomName(value);
            if (roomCreationState === "error") setRoomCreationState("idle");
          }}
          onClose={() => setRoomRailOpen(false)}
          onCreate={() => void createRoom()}
          onArchive={archiveManagedRoom}
          onListState={updateManagedRoomListState}
          onOpenDetails={(room) => void openRoomDetails(room)}
          onRename={renameManagedRoom}
          onRestore={restoreManagedRoom}
          onSelect={(room) => void selectRoom(room)}
          onStartCreate={() => setCreatingRoom(true)}
          open={roomRailOpen}
          archivedRooms={workspace.archivedRooms}
          rooms={workspace.rooms}
        />
      ) : null}

      <main className="room-stage" id="room-main">
        {state === "loading" || roomTransitioning ? (
          <RoomLoading />
        ) : state === "error" || !workspace ? (
          <RoomError onRetry={loadRoom} />
        ) : !snapshot ? (
          <RoomWorkspaceEmpty onCreate={() => {
            setCreatingRoom(true);
            setRoomRailOpen(true);
          }} />
        ) : (
          <>
            <RoomHeader
              onOpenDetails={() => setDetailsRoomId(snapshot.room.id)}
              onOpenRooms={() => setRoomRailOpen(true)}
              onOpenSearch={() => {
                setDetailsRoomId(null);
                setSearchOpen(true);
              }}
              snapshot={snapshot}
              workspace={workspace}
            />
            <section
              aria-label={`${snapshot.room.name}消息`}
              className="room-timeline"
              onScroll={handleTimelineScroll}
              ref={timelineRef}
            >
              <div className="room-timeline__inner">
                {snapshot.messages.length === 0 ? (
                  <RoomEmpty roomName={snapshot.room.name} />
                ) : (
                  snapshot.messages.map((message) => (
                    <MessageEntry
                      attachments={(snapshot.attachments ?? []).filter(
                        (attachment) => attachment.messageId === message.id,
                      )}
                      cancellableAgentIds={cancellableAgentIds}
                      key={message.id}
                      focused={message.id === focusedMessageId}
                      membersById={membersById}
                      message={message}
                      replyTo={message.replyToMessageId
                        ? messagesById.get(message.replyToMessageId) ?? null
                        : null}
                      onEdit={editMessage}
                      onFocusMessage={(messageId) => setFocusedMessageId(messageId)}
                      onIntervene={intervene}
                      onReply={(selected) => {
                        setReplyToMessageId(selected.id);
                        window.requestAnimationFrame(() => {
                          document.querySelector<HTMLTextAreaElement>(
                            ".room-composer textarea",
                          )?.focus();
                        });
                      }}
                      onRetract={retractMessage}
                      onRetry={retry}
                      pendingAction={pendingAction}
                      runs={snapshot.runs.filter(
                        (run) => run.triggerMessageId === message.id,
                      )}
                      streamText={streamText}
                      viewerPrincipalId={workspace.principal.id}
                    />
                  ))
                )}

                {snapshot.delegations.map((delegation) => {
                  const delegator = shortAgentName(
                    membersById.get(delegation.delegatorPrincipalId)?.displayName ?? "Agent",
                  );
                  const delegate = shortAgentName(
                    membersById.get(delegation.delegatePrincipalId)?.displayName ?? "Agent",
                  );
                  return (
                    <div className="delegation-entry" key={delegation.id}>
                      <span className="delegation-entry__route">
                        {delegator} 委托 {delegate}
                      </span>
                      <ArrowRight aria-hidden="true" size={14} strokeWidth={1.6} />
                      <span>{delegation.objective}</span>
                    </div>
                  );
                })}

                {snapshot.artifacts.map((artifact) => (
                  <details className="artifact-entry" key={artifact.id}>
                    <summary>
                      <span className="artifact-entry__icon">
                        <FileText aria-hidden="true" size={17} strokeWidth={1.6} />
                      </span>
                      <span>
                        <small>
                          {shortAgentName(
                            membersById.get(artifact.producerPrincipalId)?.displayName ?? "Agent",
                          )} 生成了交付物
                        </small>
                        <strong>{artifact.title}</strong>
                      </span>
                    </summary>
                    <pre>{artifact.content}</pre>
                  </details>
                ))}
              </div>
              {hasUnseenContent ? (
                <button
                  aria-label="回到最新消息"
                  className="room-timeline__latest"
                  onClick={returnToLatest}
                  type="button"
                >
                  <ArrowDown aria-hidden="true" size={14} strokeWidth={1.8} />
                  回到最新
                </button>
              ) : null}
            </section>

            <footer className="room-footer">
              <div className="room-footer__inner">
                {notice ? <p className="room-notice" role="status">{notice}</p> : null}
                <div className="room-composer">
                  {replyTarget ? (
                    <div className="room-composer__reply" role="status">
                      <Undo2 aria-hidden="true" size={14} strokeWidth={1.6} />
                      <span>
                        <strong>
                          回复 {replyTarget.senderPrincipalId === workspace.principal.id
                            ? "你"
                            : shortAgentName(
                                membersById.get(replyTarget.senderPrincipalId)?.displayName
                                  ?? "成员",
                              )}
                        </strong>
                        <small>
                          {replyTarget.retractedAt
                            ? "消息已撤回"
                            : replyTarget.content || "附件消息"}
                        </small>
                      </span>
                      <button
                        aria-label="取消回复"
                        onClick={() => setReplyToMessageId(null)}
                        type="button"
                      >
                        <X aria-hidden="true" size={14} strokeWidth={1.6} />
                      </button>
                    </div>
                  ) : null}
                  <div className="room-composer__agents" aria-label="参与本条消息的 Agent">
                    <button
                      aria-pressed={
                        roomAgents.length > 0 &&
                        selectedAgentIds.length === roomAgents.length
                      }
                      className="room-composer__all"
                      disabled={roomAgents.length === 0}
                      onClick={selectAllAgents}
                      type="button"
                    >
                      <Users aria-hidden="true" size={14} strokeWidth={1.6} />
                      全员参与
                    </button>
                    {roomAgents.length === 0 ? (
                      <span className="room-composer__no-agents">
                        这个房间暂时没有 AI 成员
                      </span>
                    ) : null}
                    {roomAgents.map((agent) => {
                      const selected = selectedAgentIds.includes(agent.principalId);
                      const label = shortAgentName(agent.displayName);
                      return (
                        <button
                          aria-label={`选择 ${label} 参与协作`}
                          aria-pressed={selected}
                          className="room-composer__agent"
                          data-selected={selected || undefined}
                          key={agent.principalId}
                          onClick={() => toggleAgent(agent.principalId)}
                          type="button"
                        >
                          <span aria-hidden="true" />
                          {label}
                        </button>
                      );
                    })}
                  </div>
                  <AttachmentComposer
                    client={attachmentClient}
                    disabled={pendingAction === "send"}
                    key={attachmentComposerKey}
                    onBusyChange={setAttachmentUploadBusy}
                    onReadyChange={setReadyAttachments}
                  />
                  <div className="room-composer__input">
                    <textarea
                      aria-label={`发送到${snapshot.room.name}`}
                      maxLength={32_000}
                      onChange={(event) => setDraft(event.target.value)}
                      onKeyDown={handleComposerKeyDown}
                      placeholder={`发送到 ${snapshot.room.name}`}
                      rows={1}
                      value={draft}
                    />
                    <button
                      aria-label="发送消息"
                      className="room-composer__send"
                      disabled={
                        (!draft.trim() && readyAttachments.length === 0) ||
                        attachmentUploadBusy ||
                        pendingAction === "send"
                      }
                      onClick={() => void sendMessage()}
                      title="发送消息"
                      type="button"
                    >
                      <Send aria-hidden="true" size={18} strokeWidth={1.7} />
                    </button>
                  </div>
                </div>
              </div>
            </footer>
          </>
        )}
      </main>

      {detailsRoom ? (
        <RoomDetails
          canArchive={(workspace?.rooms.length ?? 0) > 1}
          client={client}
          key={detailsRoom.id}
          onArchive={async (room) => {
            await archiveManagedRoom(room);
            setDetailsRoomId(null);
          }}
          onClose={() => setDetailsRoomId(null)}
          onMembershipChanged={refreshMembership}
          onOpenMessage={(messageId) => void openSourceMessage({
            roomId: detailsRoom.id,
            messageId,
          })}
          onRename={renameManagedRoom}
          onPurpose={updateManagedRoomPurpose}
          room={detailsRoom}
        />
      ) : null}
      {searchOpen && workspace ? (
        <ConversationSearch
          onClose={() => setSearchOpen(false)}
          onOpenResult={(result) => void openSourceMessage(result)}
          rooms={[...workspace.rooms, ...workspace.archivedRooms]}
        />
      ) : null}
    </div>
  );
}

function RoomHeader({
  onOpenDetails,
  onOpenRooms,
  onOpenSearch,
  snapshot,
  workspace,
}: {
  onOpenDetails: () => void;
  onOpenRooms: () => void;
  onOpenSearch: () => void;
  snapshot: RoomSnapshot;
  workspace: CurrentWorkspace;
}) {
  const activeMemberCount = snapshot.members.filter(
    (member) => member.status === "active",
  ).length;
  return (
    <header className="room-header">
      <div className="room-header__identity">
        <button
          aria-label="打开房间列表"
          className="room-header__rooms"
          onClick={onOpenRooms}
          type="button"
        >
          <Menu aria-hidden="true" size={17} strokeWidth={1.6} />
        </button>
        <Link href="/">{workspace.workspace.name}</Link>
        <span aria-hidden="true">/</span>
        <div>
          <h1>{snapshot.room.name}</h1>
          <span>{activeMemberCount} 位成员</span>
        </div>
      </div>
      <div className="room-header__actions">
        <button aria-label="搜索消息和文件" className="room-header__search" onClick={onOpenSearch} title="搜索" type="button">
          <SearchIcon aria-hidden="true" size={16} strokeWidth={1.6} />
        </button>
        <button aria-label="打开会话详情" className="room-header__details" onClick={onOpenDetails} title="会话详情" type="button">
          <MoreHorizontal aria-hidden="true" size={17} strokeWidth={1.7} />
        </button>
      </div>
    </header>
  );
}

function formatRoomActivity(value: Date | string | undefined): string {
  if (!value) return "";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const now = new Date();
  const sameDay = date.toDateString() === now.toDateString();
  return sameDay
    ? date.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })
    : date.toLocaleDateString("zh-CN", { month: "numeric", day: "numeric" });
}

function RoomRail({
  activeRoomId,
  archivedRooms,
  creating,
  creationState,
  name,
  onArchive,
  onCancelCreate,
  onChangeName,
  onClose,
  onCreate,
  onListState,
  onOpenDetails,
  onRename,
  onRestore,
  onSelect,
  onStartCreate,
  open,
  rooms,
}: {
  activeRoomId: string | null;
  archivedRooms: RoomSummaryRecord[];
  creating: boolean;
  creationState: "idle" | "creating" | "error";
  name: string;
  onArchive: (room: RoomSummaryRecord) => Promise<void>;
  onCancelCreate: () => void;
  onChangeName: (value: string) => void;
  onClose: () => void;
  onCreate: () => void;
  onListState: (
    room: RoomSummaryRecord,
    action: "pin" | "unpin" | "hide" | "show",
  ) => Promise<void>;
  onOpenDetails: (room: RoomSummaryRecord) => void;
  onRename: (room: RoomSummaryRecord, name: string) => Promise<void>;
  onRestore: (room: RoomSummaryRecord) => Promise<void>;
  onSelect: (room: RoomRecord) => void;
  onStartCreate: () => void;
  open: boolean;
  rooms: RoomSummaryRecord[];
}) {
  const [archivedOpen, setArchivedOpen] = useState(false);
  const [mutationState, setMutationState] = useState<"idle" | "saving">("idle");
  const [mutationError, setMutationError] = useState<string | null>(null);
  const [menuRoomId, setMenuRoomId] = useState<string | null>(null);
  const [editingRoomId, setEditingRoomId] = useState<string | null>(null);
  const [editedName, setEditedName] = useState("");
  const [confirmation, setConfirmation] = useState<{
    roomId: string;
    action: "archive" | "hide";
  } | null>(null);
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressedRoomId = useRef<string | null>(null);

  useEffect(() => () => {
    if (longPressTimer.current) clearTimeout(longPressTimer.current);
  }, []);

  function clearLongPress() {
    if (longPressTimer.current) clearTimeout(longPressTimer.current);
    longPressTimer.current = null;
  }

  async function runMutation(action: () => Promise<void>, message: string) {
    if (mutationState === "saving") return;
    setMutationState("saving");
    setMutationError(null);
    try {
      await action();
      setMenuRoomId(null);
      setConfirmation(null);
      setEditingRoomId(null);
    } catch {
      setMutationError(message);
    } finally {
      setMutationState("idle");
    }
  }

  async function saveRoomName(room: RoomSummaryRecord) {
    const nextName = editedName.trim();
    if (!nextName || nextName.length > 80) return;
    await runMutation(
      () => onRename(room, nextName),
      "会话名称未能保存，请稍后重试。",
    );
  }

  async function restoreRoom(room: RoomSummaryRecord) {
    if (mutationState === "saving") return;
    setMutationState("saving");
    setMutationError(null);
    try {
      await onRestore(room);
    } catch {
      setMutationError("房间未能恢复，请稍后重试。");
    } finally {
      setMutationState("idle");
    }
  }

  return (
    <>
      <button
        aria-label="关闭房间列表"
        className="room-rail__scrim"
        data-open={open || undefined}
        onClick={onClose}
        type="button"
      />
      <aside
        aria-label="协作房间"
        className="room-rail"
        data-open={open || undefined}
      >
        <header className="room-rail__header">
          <div>
            <span>SPACE</span>
            <strong>协作房间</strong>
          </div>
          <button aria-label="新建房间" onClick={onStartCreate} type="button">
            <Plus aria-hidden="true" size={16} strokeWidth={1.6} />
          </button>
        </header>

        {creating ? (
          <div className="room-rail__create" data-state={creationState}>
            <input
              aria-label="房间名称"
              autoFocus
              maxLength={80}
              onChange={(event) => onChangeName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") onCreate();
                if (event.key === "Escape") onCancelCreate();
              }}
              placeholder="房间名称"
              value={name}
            />
            <button
              aria-label="创建房间"
              disabled={!name.trim() || creationState === "creating"}
              onClick={onCreate}
              type="button"
            >
              <Check aria-hidden="true" size={14} strokeWidth={1.8} />
            </button>
            <button aria-label="取消创建" onClick={onCancelCreate} type="button">
              <X aria-hidden="true" size={14} strokeWidth={1.6} />
            </button>
            {creationState === "error" ? (
              <small role="alert">房间未能创建，请重试。</small>
            ) : null}
          </div>
        ) : null}

        {mutationError ? <p className="room-rail__error" role="alert">{mutationError}</p> : null}

        <nav aria-label="会话列表" className="room-rail__list">
          <div className="room-rail__section-label">会话</div>
          {rooms.length === 0 ? (
            <p>暂无会话</p>
          ) : rooms.map((room) => {
            const active = room.id === activeRoomId;
            const menuOpen = menuRoomId === room.id;
            const editing = editingRoomId === room.id;
            const pendingConfirmation = confirmation?.roomId === room.id
              ? confirmation.action
              : null;
            return (
              <div
                className="room-rail__item"
                data-active={active || undefined}
                data-menu-open={menuOpen || undefined}
                key={room.id}
                onContextMenu={(event) => {
                  event.preventDefault();
                  setConfirmation(null);
                  setEditingRoomId(null);
                  setMenuRoomId(room.id);
                }}
              >
                {editing ? (
                  <div className="room-rail__edit">
                    <input
                      aria-label={`重命名${room.name}`}
                      autoFocus
                      maxLength={80}
                      onChange={(event) => setEditedName(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") void saveRoomName(room);
                        if (event.key === "Escape") setEditingRoomId(null);
                      }}
                      value={editedName}
                    />
                    <button aria-label="保存会话名称" onClick={() => void saveRoomName(room)} type="button">
                      <Check aria-hidden="true" size={14} strokeWidth={1.7} />
                    </button>
                    <button aria-label="取消重命名会话" onClick={() => setEditingRoomId(null)} type="button">
                      <X aria-hidden="true" size={14} strokeWidth={1.6} />
                    </button>
                  </div>
                ) : (
                  <>
                    <button
                      aria-current={active ? "page" : undefined}
                      aria-label={`切换到${room.name}`}
                      className="room-rail__room"
                      onClick={() => {
                        if (longPressedRoomId.current === room.id) {
                          longPressedRoomId.current = null;
                          return;
                        }
                        setMenuRoomId(null);
                        onSelect(room);
                      }}
                      onKeyDown={(event) => {
                        if (event.key === "ContextMenu" || (event.shiftKey && event.key === "F10")) {
                          event.preventDefault();
                          setMenuRoomId(room.id);
                        }
                      }}
                      onPointerCancel={clearLongPress}
                      onPointerDown={(event) => {
                        if (event.pointerType !== "touch" && event.pointerType !== "pen") return;
                        clearLongPress();
                        longPressTimer.current = setTimeout(() => {
                          longPressedRoomId.current = room.id;
                          setMenuRoomId(room.id);
                        }, 520);
                      }}
                      onPointerLeave={clearLongPress}
                      onPointerUp={clearLongPress}
                      type="button"
                    >
                      <MessageCircle aria-hidden="true" size={15} strokeWidth={1.5} />
                      <span className="room-rail__summary">
                        <strong>
                          {room.name}
                          {room.pinnedAt ? (
                            <Pin aria-label="已置顶" size={10} strokeWidth={1.7} />
                          ) : null}
                        </strong>
                        <small>{room.lastMessagePreview || "尚无消息"}</small>
                      </span>
                      {room.unreadCount ? (
                        <b className="room-rail__unread" aria-label={`${room.unreadCount}条未读消息`}>
                          {room.unreadCount > 99 ? "99+" : room.unreadCount}
                        </b>
                      ) : null}
                      <time>{formatRoomActivity(room.lastActivityAt)}</time>
                    </button>
                    <button
                      aria-expanded={menuOpen}
                      aria-label={`管理${room.name}`}
                      className="room-rail__manage"
                      onClick={() => {
                        setConfirmation(null);
                        setEditingRoomId(null);
                        setMenuRoomId((current) => current === room.id ? null : room.id);
                      }}
                      type="button"
                    >
                      <MoreHorizontal aria-hidden="true" size={15} strokeWidth={1.7} />
                    </button>
                  </>
                )}
                {menuOpen && !editing && !pendingConfirmation ? (
                  <div aria-label={`${room.name}会话操作`} className="room-rail__menu" role="menu">
                    <button
                      onClick={() => void runMutation(
                        () => onListState(room, room.pinnedAt ? "unpin" : "pin"),
                        room.pinnedAt ? "取消置顶失败，请重试。" : "置顶失败，请重试。",
                      )}
                      role="menuitem"
                      type="button"
                    >
                      {room.pinnedAt
                        ? <PinOff aria-hidden="true" size={14} />
                        : <Pin aria-hidden="true" size={14} />}
                      {room.pinnedAt ? "取消置顶" : "置顶会话"}
                    </button>
                    <button
                      onClick={() => {
                        setMenuRoomId(null);
                        onOpenDetails(room);
                      }}
                      role="menuitem"
                      type="button"
                    >
                      <MoreHorizontal aria-hidden="true" size={14} />
                      会话详情
                    </button>
                    <button
                      onClick={() => {
                        setEditedName(room.name);
                        setEditingRoomId(room.id);
                      }}
                      role="menuitem"
                      type="button"
                    >
                      <Pencil aria-hidden="true" size={14} />
                      重命名
                    </button>
                    <button
                      disabled={rooms.length <= 1}
                      onClick={() => setConfirmation({ roomId: room.id, action: "hide" })}
                      role="menuitem"
                      title={rooms.length <= 1 ? "至少保留一个可见会话" : undefined}
                      type="button"
                    >
                      <Trash2 aria-hidden="true" size={14} />
                      从列表移除
                    </button>
                    <button
                      disabled={rooms.length <= 1}
                      onClick={() => setConfirmation({ roomId: room.id, action: "archive" })}
                      role="menuitem"
                      type="button"
                    >
                      <Archive aria-hidden="true" size={14} />
                      归档会话
                    </button>
                  </div>
                ) : null}
                {pendingConfirmation ? (
                  <div aria-label={pendingConfirmation === "hide" ? "确认移出会话" : "确认归档会话"} className="room-rail__confirm" role="alertdialog">
                    <p>
                      {pendingConfirmation === "hide"
                        ? "仅从你的列表移出；收到新消息时会重新出现。"
                        : "归档后历史消息仍保留，可从已归档中恢复。"}
                    </p>
                    <button
                      aria-label={pendingConfirmation === "hide" ? "确认移出会话" : "确认归档会话"}
                      disabled={mutationState === "saving"}
                      onClick={() => void runMutation(
                        () => pendingConfirmation === "hide"
                          ? onListState(room, "hide")
                          : onArchive(room),
                        pendingConfirmation === "hide"
                          ? "会话未能移出列表，请重试。"
                          : "会话未能归档，请重试。",
                      )}
                      type="button"
                    >
                      确认
                    </button>
                    <button onClick={() => setConfirmation(null)} type="button">取消</button>
                  </div>
                ) : null}
              </div>
            );
          })}

          {archivedRooms.length > 0 ? (
            <div className="room-rail__archived">
              <button
                aria-expanded={archivedOpen}
                aria-label={archivedOpen ? "隐藏已归档房间" : "显示已归档房间"}
                onClick={() => setArchivedOpen((current) => !current)}
                type="button"
              >
                <Archive aria-hidden="true" size={13} strokeWidth={1.5} />
                已归档 · {archivedRooms.length}
                {archivedOpen
                  ? <ChevronUp aria-hidden="true" size={13} />
                  : <ChevronDown aria-hidden="true" size={13} />}
              </button>
              {archivedOpen ? archivedRooms.map((room) => (
                <div className="room-rail__archived-room" key={room.id}>
                  <span>
                    <strong>{room.name}</strong>
                    <small>{room.lastMessagePreview || "尚无消息"}</small>
                  </span>
                  <button
                    aria-label={`恢复${room.name}`}
                    disabled={mutationState === "saving"}
                    onClick={() => void restoreRoom(room)}
                    title={`恢复 ${room.name}`}
                    type="button"
                  >
                    <Undo2 aria-hidden="true" size={14} strokeWidth={1.7} />
                  </button>
                </div>
              )) : null}
            </div>
          ) : null}
        </nav>

        <button aria-label="关闭房间列表" className="room-rail__close" onClick={onClose} type="button">
          <X aria-hidden="true" size={16} strokeWidth={1.6} />
        </button>
      </aside>
    </>
  );
}

function RoomDetails({
  canArchive,
  client,
  onArchive,
  onClose,
  onMembershipChanged,
  onOpenMessage,
  onPurpose,
  onRename,
  room,
}: {
  canArchive: boolean;
  client: RoomClient;
  onArchive: (room: RoomSummaryRecord) => Promise<void>;
  onClose: () => void;
  onMembershipChanged: () => Promise<void>;
  onOpenMessage: (messageId: string) => void;
  onPurpose: (room: RoomSummaryRecord, purpose: string) => Promise<void>;
  onRename: (room: RoomSummaryRecord, name: string) => Promise<void>;
  room: RoomSummaryRecord;
}) {
  const [details, setDetails] = useState<RoomMembershipDetails | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [mutation, setMutation] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [removePrincipalId, setRemovePrincipalId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState(false);
  const [name, setName] = useState(room.name);
  const [purpose, setPurpose] = useState(room.purpose ?? "");
  const [archiveConfirmation, setArchiveConfirmation] = useState(false);
  const [copied, setCopied] = useState<"id" | "link" | null>(null);

  const loadDetails = useCallback(async () => {
    setState("loading");
    setError(null);
    try {
      setDetails(await client.getRoomMembers(room.id));
      setState("ready");
    } catch {
      setState("error");
    }
  }, [client, room.id]);

  useEffect(() => {
    let active = true;
    void client
      .getRoomMembers(room.id)
      .then((result) => {
        if (!active) return;
        setDetails(result);
        setState("ready");
      })
      .catch(() => {
        if (active) setState("error");
      });
    return () => {
      active = false;
    };
  }, [client, room.id]);

  async function mutateMembership(
    principalId: string,
    action: "add" | "remove",
  ) {
    if (mutation) return;
    setMutation(`${action}-${principalId}`);
    setError(null);
    try {
      if (action === "add") {
        await client.addRoomMember(room.id, principalId);
      } else {
        await client.removeRoomMember(room.id, principalId);
      }
      setRemovePrincipalId(null);
      await Promise.all([loadDetails(), onMembershipChanged()]);
    } catch {
      setError(
        action === "remove"
          ? "成员暂时无法移除；如果 AI 正在执行，请等待任务结束后重试。"
          : "成员暂时无法加入这个房间，请确认其仍在当前工作空间。",
      );
    } finally {
      setMutation(null);
    }
  }

  async function saveName() {
    const nextName = name.trim();
    if (!nextName || nextName.length > 80 || mutation) return;
    setMutation("rename");
    setError(null);
    try {
      await onRename(room, nextName);
      setEditingName(false);
    } catch {
      setError("房间名称未能保存，请重试。");
    } finally {
      setMutation(null);
    }
  }

  async function savePurpose() {
    const nextPurpose = purpose.trim();
    if (nextPurpose.length > 500 || mutation) return;
    setMutation("purpose");
    setError(null);
    try {
      await onPurpose(room, nextPurpose);
    } catch {
      setError("会话用途未能保存，请重试。");
    } finally {
      setMutation(null);
    }
  }

  async function copyRoomId() {
    try {
      await navigator.clipboard.writeText(room.id);
      setCopied("id");
      window.setTimeout(() => setCopied(null), 1_500);
    } catch {
      setError("当前浏览器无法复制会话 ID。");
    }
  }

  async function copyRoomLink() {
    try {
      const url = new URL(window.location.href);
      url.searchParams.set("room", room.id);
      await navigator.clipboard.writeText(url.toString());
      setCopied("link");
      window.setTimeout(() => setCopied(null), 1_500);
    } catch {
      setError("当前浏览器无法复制链接，请从地址栏复制。");
    }
  }

  async function archiveRoom() {
    if (mutation) return;
    setMutation("archive");
    setError(null);
    try {
      await onArchive(room);
    } catch {
      setError("房间未能归档。请确认没有 AI 正在执行，并至少保留一个活跃房间。");
      setArchiveConfirmation(false);
      setMutation(null);
    }
  }

  return (
    <>
      <button
        aria-label="关闭房间详情"
        className="room-details__scrim"
        onClick={onClose}
        type="button"
      />
      <aside aria-label={`${room.name}详情`} className="room-details">
        <header className="room-details__header">
          <div>
            <span>ROOM</span>
            <h2>房间详情</h2>
          </div>
          <button aria-label="关闭房间详情" onClick={onClose} type="button">
            <X aria-hidden="true" size={16} strokeWidth={1.6} />
          </button>
        </header>

        <div className="room-details__identity">
          <strong>{room.name}</strong>
          <small>{room.purpose || `${details?.members.length ?? 0} 位成员`}</small>
        </div>

        {state === "loading" ? (
          <div className="room-details__loading" role="status">
            <span />
            <span />
            <p>正在读取房间详情…</p>
          </div>
        ) : state === "error" || !details ? (
          <div className="room-details__error" role="alert">
            <strong>房间详情暂时无法载入</strong>
            <p>对话内容不受影响，可以重新尝试。</p>
            <button onClick={() => void loadDetails()} type="button">
              重试房间详情
            </button>
          </div>
        ) : (
          <div className="room-details__content">
            <section className="room-details__section room-details__metadata">
              <header><span>会话身份</span></header>
              <button
                aria-label="复制会话 ID"
                className="room-details__id"
                onClick={() => void copyRoomId()}
                type="button"
              >
                <code>{room.id}</code>
                {copied === "id"
                  ? <Check aria-hidden="true" size={14} />
                  : <Copy aria-hidden="true" size={14} />}
              </button>
              <label className="room-details__purpose">
                <span>用途</span>
                <textarea
                  aria-label="会话用途"
                  disabled={!details.canEditProfile}
                  maxLength={500}
                  onChange={(event) => setPurpose(event.target.value)}
                  placeholder="说明这个会话负责什么"
                  rows={3}
                  value={purpose}
                />
              </label>
              {details.canEditProfile ? (
                <button
                  className="room-details__purpose-save"
                  disabled={mutation === "purpose" || purpose.trim() === (room.purpose ?? "")}
                  onClick={() => void savePurpose()}
                  type="button"
                >
                  {mutation === "purpose" ? "保存中…" : "保存用途"}
                </button>
              ) : null}
            </section>

            <section className="room-details__section">
              <header>
                <span>成员</span>
                <small>{details.members.length}</small>
              </header>
              <div className="room-details__members">
                {details.members.map((member) => {
                  const label = shortAgentName(member.displayName);
                  const confirming = removePrincipalId === member.principalId;
                  return (
                    <div className="room-details__member" key={member.principalId}>
                      <span aria-hidden="true">{label.slice(0, 1)}</span>
                      <div>
                        <strong>{label}</strong>
                        <small>
                          {member.principalKind === "agent" ? "AI" : "人类"}
                          {member.role === "owner" ? " · 所有者" : ""}
                        </small>
                      </div>
                      {details.canManage && member.role !== "owner" ? (
                        confirming ? (
                          <div className="room-details__member-confirm">
                            <button
                              aria-label={`确认移除 ${label}`}
                              disabled={mutation === `remove-${member.principalId}`}
                              onClick={() =>
                                void mutateMembership(member.principalId, "remove")
                              }
                              type="button"
                            >
                              确认
                            </button>
                            <button
                              aria-label={`取消移除 ${label}`}
                              onClick={() => setRemovePrincipalId(null)}
                              type="button"
                            >
                              取消
                            </button>
                          </div>
                        ) : (
                          <button
                            aria-label={`移除 ${label}`}
                            className="room-details__icon-action"
                            onClick={() => setRemovePrincipalId(member.principalId)}
                            title={`移除 ${label}`}
                            type="button"
                          >
                            <Trash2 aria-hidden="true" size={14} strokeWidth={1.6} />
                          </button>
                        )
                      ) : null}
                    </div>
                  );
                })}
              </div>
            </section>

            <section className="room-details__section">
              <header><span>文件</span></header>
              <RoomFiles onOpenMessage={onOpenMessage} roomId={room.id} />
            </section>

            {details.canManage ? (
              <section className="room-details__section">
                <header>
                  <span>添加成员</span>
                  <UserPlus aria-hidden="true" size={14} strokeWidth={1.5} />
                </header>
                {details.candidates.length === 0 ? (
                  <p className="room-details__empty">
                    当前工作空间没有可添加的成员。
                  </p>
                ) : (
                  <div className="room-details__candidates">
                    {details.candidates.map((candidate) => {
                      const label = shortAgentName(candidate.displayName);
                      return (
                        <button
                          aria-label={`添加 ${label}`}
                          disabled={mutation === `add-${candidate.principalId}`}
                          key={candidate.principalId}
                          onClick={() =>
                            void mutateMembership(candidate.principalId, "add")
                          }
                          type="button"
                        >
                          <span aria-hidden="true">{label.slice(0, 1)}</span>
                          <span>
                            <strong>{label}</strong>
                            <small>
                              {candidate.principalKind === "agent" ? "AI" : "人类"}
                            </small>
                          </span>
                          <Plus aria-hidden="true" size={14} strokeWidth={1.6} />
                        </button>
                      );
                    })}
                  </div>
                )}
              </section>
            ) : (
              <p className="room-details__readonly">
                只有房间所有者可以调整成员和房间设置。
              </p>
            )}

            <section className="room-details__section room-details__settings">
              <header><span>房间设置</span></header>
              {editingName ? (
                <div className="room-details__rename">
                  <input
                    aria-label="房间名称"
                    autoFocus
                    maxLength={80}
                    onChange={(event) => setName(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") void saveName();
                      if (event.key === "Escape") setEditingName(false);
                    }}
                    value={name}
                  />
                  <button
                    aria-label="保存房间名称"
                    disabled={!name.trim() || mutation === "rename"}
                    onClick={() => void saveName()}
                    type="button"
                  >
                    <Check aria-hidden="true" size={14} strokeWidth={1.7} />
                  </button>
                  <button
                    aria-label="取消重命名"
                    onClick={() => {
                      setName(room.name);
                      setEditingName(false);
                    }}
                    type="button"
                  >
                    <X aria-hidden="true" size={14} strokeWidth={1.6} />
                  </button>
                </div>
              ) : null}
              <button onClick={() => void copyRoomLink()} type="button">
                <Copy aria-hidden="true" size={14} strokeWidth={1.5} />
                {copied === "link" ? "链接已复制" : "复制房间链接"}
              </button>
              {details.canManage ? (
                <>
                  <button
                    aria-label="重命名房间"
                    onClick={() => setEditingName(true)}
                    type="button"
                  >
                    <Pencil aria-hidden="true" size={14} strokeWidth={1.5} />
                    重命名房间
                  </button>
                  <button
                    aria-label="归档房间"
                    disabled={!canArchive}
                    onClick={() => setArchiveConfirmation(true)}
                    type="button"
                  >
                    <Archive aria-hidden="true" size={14} strokeWidth={1.5} />
                    归档房间
                  </button>
                </>
              ) : null}
              {archiveConfirmation ? (
                <div className="room-details__archive" role="alertdialog" aria-label="确认归档房间">
                  <p>归档后可随时恢复，历史消息不会删除。</p>
                  <button
                    disabled={mutation === "archive"}
                    onClick={() => void archiveRoom()}
                    type="button"
                  >
                    确认归档
                  </button>
                  <button onClick={() => setArchiveConfirmation(false)} type="button">
                    取消
                  </button>
                </div>
              ) : null}
            </section>
          </div>
        )}

        {error ? <p className="room-details__notice" role="alert">{error}</p> : null}
      </aside>
    </>
  );
}

function MessageEntry({
  attachments,
  cancellableAgentIds,
  membersById,
  message,
  replyTo,
  onEdit,
  onFocusMessage,
  onIntervene,
  onReply,
  onRetract,
  onRetry,
  pendingAction,
  runs,
  streamText,
  viewerPrincipalId,
  focused,
}: {
  attachments: RoomSnapshot["attachments"];
  focused: boolean;
  cancellableAgentIds: Set<string>;
  membersById: Map<string, RoomSnapshot["members"][number]>;
  message: RoomMessageRecord;
  replyTo: RoomMessageRecord | null;
  onEdit: (message: RoomMessageRecord, content: string) => Promise<boolean>;
  onFocusMessage: (messageId: string) => void;
  onIntervene: (run: CollaborationRunRecord, name: string) => void;
  onReply: (message: RoomMessageRecord) => void;
  onRetract: (message: RoomMessageRecord) => Promise<boolean>;
  onRetry: (run: CollaborationRunRecord, name: string) => void;
  pendingAction: string | null;
  runs: CollaborationRunRecord[];
  streamText: Record<string, string>;
  viewerPrincipalId: string;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState(message.content);
  const [confirmingRetraction, setConfirmingRetraction] = useState(false);
  const own = message.senderPrincipalId === viewerPrincipalId;
  const sender = membersById.get(message.senderPrincipalId);
  const senderName = own ? "你" : shortAgentName(sender?.displayName ?? "Agent");
  const canMutate = own
    && message.kind === "message"
    && message.status === "completed"
    && !message.retractedAt
    && !runs.some((run) => activeStatuses.has(run.status));
  const busy = pendingAction === `edit-${message.id}`
    || pendingAction === `retract-${message.id}`;

  async function copyMessage() {
    try {
      await navigator.clipboard.writeText(message.content);
    } catch {
      const fallback = document.createElement("textarea");
      fallback.value = message.content;
      fallback.style.position = "fixed";
      fallback.style.opacity = "0";
      document.body.append(fallback);
      fallback.select();
      document.execCommand("copy");
      fallback.remove();
    }
    setMenuOpen(false);
  }

  async function saveEdit() {
    const content = editValue.trim();
    if ((!content && attachments.length === 0) || content === message.content || busy) {
      return;
    }
    if (await onEdit(message, content)) setEditing(false);
  }

  async function confirmRetraction() {
    if (busy) return;
    if (await onRetract(message)) setConfirmingRetraction(false);
  }

  return (
    <article
      className="room-message"
      data-focused={focused || undefined}
      data-kind={message.kind}
      data-own={own || undefined}
      id={`message-${message.id}`}
    >
      <header>
        <span className="room-message__avatar" aria-hidden="true">
          {senderName.slice(0, 1)}
        </span>
        <strong>{senderName}</strong>
        <time>{new Date(message.createdAt).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })}</time>
        {message.revisionNumber > 1 && !message.retractedAt ? (
          <small className="room-message__edited">已编辑</small>
        ) : null}
        {!message.retractedAt && message.status === "completed" ? (
          <div className="room-message__actions">
            <button
              aria-expanded={menuOpen}
              aria-label="消息操作"
              onClick={() => setMenuOpen((open) => !open)}
              type="button"
            >
              <MoreHorizontal aria-hidden="true" size={15} strokeWidth={1.6} />
            </button>
            {menuOpen ? (
              <div className="room-message__menu" role="menu">
                <button
                  onClick={() => {
                    onReply(message);
                    setMenuOpen(false);
                  }}
                  role="menuitem"
                  type="button"
                >
                  <Undo2 aria-hidden="true" size={13} /> 回复
                </button>
                {message.content ? (
                  <button onClick={() => void copyMessage()} role="menuitem" type="button">
                    <Copy aria-hidden="true" size={13} /> 复制
                  </button>
                ) : null}
                {canMutate ? (
                  <>
                    <button
                      onClick={() => {
                        setEditValue(message.content);
                        setEditing(true);
                        setMenuOpen(false);
                      }}
                      role="menuitem"
                      type="button"
                    >
                      <Pencil aria-hidden="true" size={13} /> 编辑
                    </button>
                    <button
                      data-danger
                      onClick={() => {
                        setConfirmingRetraction(true);
                        setMenuOpen(false);
                      }}
                      role="menuitem"
                      type="button"
                    >
                      <Trash2 aria-hidden="true" size={13} /> 撤回
                    </button>
                  </>
                ) : null}
              </div>
            ) : null}
          </div>
        ) : null}
      </header>
      <div className="room-message__content">
        {replyTo ? (
          <button
            className="room-message__quote"
            onClick={() => onFocusMessage(replyTo.id)}
            type="button"
          >
            <strong>
              {replyTo.senderPrincipalId === viewerPrincipalId
                ? "你"
                : shortAgentName(
                    membersById.get(replyTo.senderPrincipalId)?.displayName ?? "成员",
                  )}
            </strong>
            <span>
              {replyTo.retractedAt ? "消息已撤回" : replyTo.content || "附件消息"}
            </span>
          </button>
        ) : null}
        {message.retractedAt ? (
          <p className="room-message__retracted">这条消息已撤回</p>
        ) : editing ? (
          <div className="room-message__editor">
            <textarea
              aria-label="编辑消息"
              autoFocus
              maxLength={32_000}
              onChange={(event) => setEditValue(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Escape") setEditing(false);
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  void saveEdit();
                }
              }}
              rows={3}
              value={editValue}
            />
            <div>
              <button onClick={() => setEditing(false)} type="button">取消</button>
              <button
                disabled={busy || (!editValue.trim() && attachments.length === 0)}
                onClick={() => void saveEdit()}
                type="button"
              >
                保存
              </button>
            </div>
          </div>
        ) : (
          <>
            {message.content ? <p>{message.content}</p> : null}
            <AttachmentView attachments={attachments} />
          </>
        )}
        {message.status === "pending" ? <small data-state="pending">发送中…</small> : null}
        {message.status === "failed" ? <small data-state="failed">发送失败</small> : null}
        {confirmingRetraction ? (
          <div className="room-message__confirm" role="alertdialog" aria-label="确认撤回消息">
            <span>撤回后，成员和 Agent 将无法再读取这条内容。</span>
            <button onClick={() => setConfirmingRetraction(false)} type="button">取消</button>
            <button disabled={busy} onClick={() => void confirmRetraction()} type="button">
              确认撤回
            </button>
          </div>
        ) : null}
      </div>
      {runs.length > 0 && !message.retractedAt ? (
        <div className="run-list" aria-label="Agent 执行状态">
          {runs.map((run) => {
            const name = shortAgentName(
              membersById.get(run.targetAgentPrincipalId)?.displayName ?? "Agent",
            );
            const displayName = run.triggerType === "delegation" ? `${name} · 委托` : name;
            const active = activeStatuses.has(run.status);
            return (
              <div className="run-entry" data-status={run.status} key={run.id}>
                <span className="run-entry__signal" aria-hidden="true" />
                <strong>{displayName}</strong>
                <span>{streamText[run.id] || runLabel(run.status)}</span>
                {active && cancellableAgentIds.has(run.targetAgentPrincipalId) ? (
                  <button
                    aria-label={`停止 ${name}`}
                    disabled={pendingAction === `intervene-${run.id}`}
                    onClick={() => onIntervene(run, name)}
                    title={`停止 ${name}`}
                    type="button"
                  >
                    <Square aria-hidden="true" size={11} fill="currentColor" />
                  </button>
                ) : retryableStatuses.has(run.status) ? (
                  <button
                    aria-label={`重试 ${name}`}
                    disabled={pendingAction === `retry-${run.id}`}
                    onClick={() => onRetry(run, name)}
                    title={`重试 ${name}`}
                    type="button"
                  >
                    <RotateCcw aria-hidden="true" size={13} />
                  </button>
                ) : null}
                {run.errorMessage ? <small>{run.errorMessage}</small> : null}
              </div>
            );
          })}
        </div>
      ) : null}
    </article>
  );
}

function RoomEmpty({ roomName }: { roomName: string }) {
  return (
    <div className="room-empty">
      <Users aria-hidden="true" size={22} strokeWidth={1.5} />
      <h2>{roomName}</h2>
      <p>等待第一条协作消息。</p>
    </div>
  );
}

function RoomWorkspaceEmpty({ onCreate }: { onCreate: () => void }) {
  return (
    <section className="room-error room-workspace-empty">
      <MessageCircle aria-hidden="true" size={22} strokeWidth={1.5} />
      <h1>还没有会话</h1>
      <p>创建第一个会话后，就可以邀请人或 AI 一起协作。</p>
      <button aria-label="新建第一个会话" onClick={onCreate} type="button">
        <Plus aria-hidden="true" size={16} strokeWidth={1.7} />
        新建会话
      </button>
    </section>
  );
}

function RoomLoading() {
  return (
    <section aria-busy="true" aria-label="正在加载协作房间" className="room-loading">
      <div className="room-loading__header" />
      <div className="room-loading__line" />
      <div className="room-loading__line room-loading__line--short" />
      <div className="room-loading__composer" />
    </section>
  );
}

function RoomError({ onRetry }: { onRetry: () => Promise<void> }) {
  return (
    <section className="room-error">
      <span>连接中断</span>
      <h1>协作房间暂时无法载入</h1>
      <p>现有内容不会被修改，可以重新连接。</p>
      <button onClick={() => void onRetry()} type="button">
        <RotateCcw aria-hidden="true" size={16} strokeWidth={1.7} />
        重新载入
      </button>
    </section>
  );
}
