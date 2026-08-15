import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  CollaborationRoom,
  isTimelineNearBottom,
} from "@/components/conversation/collaboration-room";
import type {
  CurrentWorkspace,
  RoomClient,
  RoomSnapshot,
  RoomSubmission,
} from "@/lib/room-client";
import type { AttachmentClient } from "@/lib/attachment-client";

const createdAt = new Date("2026-08-07T01:00:00.000Z");
const agents = [
  { principalId: "planner", displayName: "Local Planner", adapterId: "planner", capabilities: {} },
  { principalId: "builder", displayName: "Local Builder", adapterId: "builder", capabilities: {} },
  { principalId: "reviewer", displayName: "Local Reviewer", adapterId: "reviewer", capabilities: {} },
];

const workspace = {
  principal: { id: "subai", displayName: "Su Bai", kind: "human" },
  workspace: { id: "workspace", name: "Yoyoo Space" },
  rooms: [{
    id: "room",
    name: "交付协作室",
    purpose: "推进 Yoyoo 交付",
    status: "active",
    lastMessagePreview: "请共同制定发布计划",
    lastMessageAt: createdAt,
    lastActivityAt: createdAt,
    pinnedAt: null,
  }],
  archivedRooms: [],
  agents,
} as unknown as CurrentWorkspace;

const snapshot = {
  room: { id: "room", name: "交付协作室", purpose: "推进 Yoyoo 交付" },
  members: [
    {
      roomId: "room",
      principalId: "subai",
      principalKind: "human",
      displayName: "Su Bai",
      role: "owner",
      listenerPolicy: "always",
      status: "active",
    },
    ...agents.map((agent) => ({
      roomId: "room",
      principalId: agent.principalId,
      principalKind: "agent",
      displayName: agent.displayName,
      role: "member" as const,
      listenerPolicy: "mention_only" as const,
      status: "active" as const,
    })),
  ],
  messages: [
    {
      id: "message-1",
      roomId: "room",
      senderPrincipalId: "subai",
      kind: "message",
      content: "请共同制定发布计划",
      status: "completed",
      idempotencyKey: "message-key-1",
      replyToMessageId: null,
      threadRootMessageId: null,
      mentionedPrincipalIds: ["planner", "reviewer"],
      revisionNumber: 1,
      retractedAt: null,
      retractedByPrincipalId: null,
      createdAt,
      updatedAt: createdAt,
    },
  ],
  runs: [
    {
      id: "run-reviewer",
      roomId: "room",
      triggerMessageId: "message-1",
      targetAgentPrincipalId: "reviewer",
      adapterId: "reviewer",
      status: "running",
      createdAt,
      updatedAt: createdAt,
    },
    {
      id: "run-failed",
      roomId: "room",
      triggerMessageId: "message-1",
      targetAgentPrincipalId: "planner",
      adapterId: "planner",
      status: "failed",
      errorMessage: "Planner 暂时不可用",
      createdAt,
      updatedAt: createdAt,
    },
  ],
  delegations: [
    {
      id: "delegation-1",
      roomId: "room",
      delegatorPrincipalId: "planner",
      delegatePrincipalId: "builder",
      parentRunId: "run-failed",
      childRunId: null,
      objective: "整理最终 Markdown 交付物",
      status: "running",
      createdAt,
      updatedAt: createdAt,
    },
  ],
  memberState: {
    roomId: "room",
    principalId: "subai",
    lastReadMessageId: null,
    readingMessageId: null,
    draftContent: "",
    draftRevision: 0,
    lastReadAt: null,
    readingPositionUpdatedAt: null,
    draftUpdatedAt: null,
    pinnedAt: null,
    hiddenAt: null,
    createdAt,
    updatedAt: createdAt,
  },
  artifacts: [
    {
      id: "artifact-1",
      roomId: "room",
      producerPrincipalId: "builder",
      sourceRunId: "run-builder",
      type: "markdown",
      title: "Yoyoo V0.2 发布方案",
      content: "# 发布方案\n\n多人 + 多 AI 协作。",
      status: "ready",
      createdAt,
      updatedAt: createdAt,
    },
  ],
} as RoomSnapshot;

function createClient(overrides: Partial<RoomClient> = {}): RoomClient {
  return {
    getCurrentWorkspace: vi.fn(async () => workspace),
    createRoom: vi.fn(async (name) => ({
      duplicate: false,
      room: { ...snapshot.room, id: "room-new", name },
    })),
    createDirectRoom: vi.fn(async () => ({
      duplicate: false,
      room: { ...snapshot.room, id: "room-direct", kind: "direct" as const },
    })),
    renameRoom: vi.fn(async (_roomId, name) => ({ ...snapshot.room, name })),
    setRoomPurpose: vi.fn(async (_roomId, purpose) => ({ ...snapshot.room, purpose })),
    setRoomStatus: vi.fn(async (_roomId, status) => ({ ...snapshot.room, status })),
    updateRoomListState: vi.fn(async (_roomId, action) => ({
      ...snapshot.memberState,
      pinnedAt: action === "pin" ? new Date() : null,
      hiddenAt: action === "hide" ? new Date() : null,
    })),
    getRoom: vi.fn(async () => snapshot),
    getRoomMembers: vi.fn(async () => ({
      canManage: true,
      canEditProfile: true,
      members: snapshot.members,
      candidates: [],
    })),
    addRoomMember: vi.fn(async (_roomId, principalId) => ({
      ...snapshot.members[1],
      principalId,
      status: "active" as const,
    })),
    removeRoomMember: vi.fn(async (_roomId, principalId) => ({
      ...snapshot.members[1],
      principalId,
      status: "removed" as const,
    })),
    sendMessage: vi.fn(async (_roomId, input) => ({
      duplicate: false,
      message: {
        ...snapshot.messages[0],
        id: "message-new",
        content: input.content,
        mentionedPrincipalIds: input.mentionedPrincipalIds,
      },
      runs: [],
    })),
    updateReadState: vi.fn(async () => snapshot.memberState),
    saveDraft: vi.fn(async (_roomId, content, expectedRevision) => ({
      ...snapshot.memberState,
      draftContent: content,
      draftRevision: expectedRevision + 1,
    })),
    editMessage: vi.fn(async (_roomId, _messageId, content, expectedRevisionNumber) => ({
      ...snapshot.messages[0],
      content,
      revisionNumber: expectedRevisionNumber + 1,
    })),
    retractMessage: vi.fn(async (_roomId, _messageId, expectedRevisionNumber) => ({
      ...snapshot.messages[0],
      content: "",
      revisionNumber: expectedRevisionNumber + 1,
      retractedAt: new Date(),
      retractedByPrincipalId: workspace.principal.id,
    })),
    subscribeToRun: vi.fn(() => () => undefined),
    intervene: vi.fn(async () => ({
      ...snapshot.messages[0],
      id: "intervention-default",
      kind: "intervention" as const,
      content: "已停止。",
    })),
    retryRun: vi.fn(async () => ({
      duplicate: false,
      run: { ...snapshot.runs[1], id: "run-retry", status: "queued" as const },
    })),
    ...overrides,
  };
}

describe("CollaborationRoom", () => {
  beforeEach(() => {
    window.history.replaceState({}, "", "/conversation");
  });

  it("renders a shared room with three independent Agent participants", async () => {
    render(<CollaborationRoom client={createClient()} />);

    expect(await screen.findByRole("heading", { name: "交付协作室" })).toBeInTheDocument();
    expect(screen.getAllByText("请共同制定发布计划")).toHaveLength(2);
    expect(screen.getAllByRole("button", { name: /选择 .* 参与协作/ })).toHaveLength(3);
    expect(screen.getByText("Planner 委托 Builder")).toBeInTheDocument();
    expect(screen.getByText("Yoyoo V0.2 发布方案")).toBeInTheDocument();
  });

  it("keeps an empty workspace recoverable instead of showing a connection error", async () => {
    const emptyWorkspace = {
      ...workspace,
      rooms: [],
      archivedRooms: [],
    } as CurrentWorkspace;
    const client = createClient({
      getCurrentWorkspace: vi.fn(async () => emptyWorkspace),
    });

    render(<CollaborationRoom client={client} />);

    expect(await screen.findByRole("heading", { name: "还没有会话" })).toBeInTheDocument();
    expect(screen.queryByText("协作房间暂时无法载入")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "新建第一个会话" }));
    expect(screen.getByRole("complementary", { name: "协作房间" })).toHaveAttribute(
      "data-open",
      "true",
    );
    expect(screen.getByRole("textbox", { name: "房间名称" })).toBeInTheDocument();
    expect(client.getRoom).not.toHaveBeenCalled();
  });

  it("sends one room message to all selected Agents", async () => {
    const client = createClient();
    const user = userEvent.setup();
    render(<CollaborationRoom client={client} />);
    await screen.findByRole("heading", { name: "交付协作室" });

    await user.click(screen.getByRole("button", { name: "全员参与" }));
    await user.type(screen.getByRole("textbox", { name: "发送到交付协作室" }), "一起完成上线方案");
    await user.click(screen.getByRole("button", { name: "发送消息" }));

    expect(client.sendMessage).toHaveBeenCalledWith(
      "room",
      expect.objectContaining({
        content: "一起完成上线方案",
        mentionedPrincipalIds: ["planner", "builder", "reviewer"],
      }),
    );
    expect(client.saveDraft).toHaveBeenCalledWith("room", "一起完成上线方案", 0);
    expect(client.sendMessage).toHaveBeenCalledWith(
      "room",
      expect.objectContaining({ draftRevision: 1 }),
    );
    expect(screen.getByRole("textbox", { name: "发送到交付协作室" })).toHaveValue("");
  });

  it("restores a persisted room draft before the user continues writing", async () => {
    const draftSnapshot = {
      ...snapshot,
      memberState: {
        ...snapshot.memberState,
        lastReadMessageId: "message-1",
        readingMessageId: "message-1",
        draftContent: "上次没有发完的内容",
        draftRevision: 7,
      },
    } as RoomSnapshot;
    render(<CollaborationRoom client={createClient({
      getRoom: vi.fn(async () => draftSnapshot),
    })} />);

    expect(await screen.findByRole("textbox", { name: "发送到交付协作室" }))
      .toHaveValue("上次没有发完的内容");
  });

  it("shows only real conversations and opens an existing direct room from the rail", async () => {
    const directRoom = {
      ...snapshot.room,
      id: "direct-planner",
      name: "Local Planner",
      kind: "direct" as const,
      directHumanPrincipalId: "subai",
      directAgentPrincipalId: "planner",
    };
    const directSnapshot = {
      ...snapshot,
      room: directRoom,
      members: snapshot.members.filter((member) =>
        ["subai", "planner"].includes(member.principalId)),
      memberState: { ...snapshot.memberState, roomId: directRoom.id },
    } as RoomSnapshot;
    const unreadWorkspace = {
      ...workspace,
      rooms: [{ ...workspace.rooms[0], unreadCount: 4 }, {
        ...workspace.rooms[0],
        ...directRoom,
        lastMessagePreview: "已有私聊",
        unreadCount: 0,
      }],
    } as CurrentWorkspace;
    const unreadSnapshot = {
      ...snapshot,
      memberState: {
        ...snapshot.memberState,
        lastReadMessageId: "message-1",
        readingMessageId: "message-1",
      },
    } as RoomSnapshot;
    const client = createClient({
      getCurrentWorkspace: vi.fn(async () => unreadWorkspace),
      getRoom: vi.fn(async (roomId) =>
        roomId === directRoom.id ? directSnapshot : unreadSnapshot),
    });
    const user = userEvent.setup();
    render(<CollaborationRoom client={client} />);
    await screen.findByRole("heading", { name: "交付协作室" });

    expect(screen.getByLabelText("4条未读消息")).toBeInTheDocument();
    expect(screen.queryByLabelText("房间 Agent 状态")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "切换到Local Planner" }));
    expect(client.createDirectRoom).not.toHaveBeenCalled();
    expect(await screen.findByRole("heading", { name: "Local Planner" })).toBeInTheDocument();
  });

  it("pins and removes a conversation from the row context menu", async () => {
    const secondRoom = {
      ...workspace.rooms[0],
      id: "room-2",
      name: "设计评审室",
      lastMessagePreview: "检查交互",
    };
    const multiRoomWorkspace = {
      ...workspace,
      rooms: [workspace.rooms[0], secondRoom],
    } as CurrentWorkspace;
    const refreshed = {
      ...multiRoomWorkspace,
      rooms: [{ ...workspace.rooms[0], pinnedAt: new Date() }, secondRoom],
    } as CurrentWorkspace;
    const client = createClient({
      getCurrentWorkspace: vi
        .fn()
        .mockResolvedValueOnce(multiRoomWorkspace)
        .mockResolvedValue(refreshed),
    });
    const user = userEvent.setup();
    render(<CollaborationRoom client={client} />);
    const row = await screen.findByRole("button", { name: "切换到交付协作室" });

    fireEvent.contextMenu(row);
    await user.click(screen.getByRole("menuitem", { name: "置顶会话" }));
    expect(client.updateRoomListState).toHaveBeenCalledWith("room", "pin");

    fireEvent.contextMenu(row);
    await user.click(screen.getByRole("menuitem", { name: "从列表移除" }));
    await user.click(screen.getByRole("button", { name: "确认移出会话" }));
    expect(client.updateRoomListState).toHaveBeenCalledWith("room", "hide");
  });

  it("opens conversation actions from the keyboard menu key", async () => {
    render(<CollaborationRoom client={createClient()} />);
    const row = await screen.findByRole("button", { name: "切换到交付协作室" });

    fireEvent.keyDown(row, { key: "F10", shiftKey: true });

    expect(screen.getByRole("menuitem", { name: "置顶会话" })).toBeInTheDocument();
  });

  it("opens conversation actions after a touch long-press", async () => {
    render(<CollaborationRoom client={createClient()} />);
    const row = await screen.findByRole("button", { name: "切换到交付协作室" });

    vi.useFakeTimers();
    try {
      fireEvent.pointerDown(row, { pointerType: "touch" });
      act(() => vi.advanceTimersByTime(520));
      fireEvent.pointerUp(row, { pointerType: "touch" });
    } finally {
      vi.useRealTimers();
    }

    expect(screen.getByRole("menuitem", { name: "置顶会话" })).toBeInTheDocument();
  });

  it("replies with an explicit quoted message reference", async () => {
    const client = createClient();
    const user = userEvent.setup();
    render(<CollaborationRoom client={client} />);
    await screen.findByRole("heading", { name: "交付协作室" });

    await user.click(screen.getByRole("button", { name: "消息操作" }));
    await user.click(screen.getByRole("menuitem", { name: "回复" }));
    expect(screen.getByText("回复 你")).toBeInTheDocument();
    await user.type(screen.getByRole("textbox", { name: "发送到交付协作室" }), "收到，继续推进");
    await user.click(screen.getByRole("button", { name: "发送消息" }));

    expect(client.sendMessage).toHaveBeenCalledWith(
      "room",
      expect.objectContaining({
        content: "收到，继续推进",
        replyToMessageId: "message-1",
      }),
    );
  });

  it("shows a reply quote and navigates back to its source message", async () => {
    const replySnapshot = {
      ...snapshot,
      runs: [],
      messages: [
        snapshot.messages[0],
        {
          ...snapshot.messages[0],
          id: "message-2",
          senderPrincipalId: "planner",
          content: "我会按计划推进",
          replyToMessageId: "message-1",
          mentionedPrincipalIds: [],
        },
      ],
    } as RoomSnapshot;
    const user = userEvent.setup();
    render(<CollaborationRoom client={createClient({
      getRoom: vi.fn(async () => replySnapshot),
    })} />);
    await screen.findByText("我会按计划推进");

    await user.click(screen.getByRole("button", { name: /请共同制定发布计划/ }));
    await waitFor(() => expect(document.getElementById("message-message-1"))
      .toHaveAttribute("data-focused", "true"));
  });

  it("edits and retracts an owned completed message with confirmation", async () => {
    const editableSnapshot = { ...snapshot, runs: [] } as RoomSnapshot;
    const client = createClient({
      getRoom: vi.fn(async () => editableSnapshot),
      editMessage: vi.fn(async (_roomId, _messageId, content) => ({
        ...editableSnapshot.messages[0],
        content,
        revisionNumber: 2,
      })),
      retractMessage: vi.fn(async () => ({
        ...editableSnapshot.messages[0],
        content: "",
        revisionNumber: 3,
        retractedAt: new Date(),
        retractedByPrincipalId: "subai",
      })),
    });
    const user = userEvent.setup();
    render(<CollaborationRoom client={client} />);
    await screen.findByRole("heading", { name: "交付协作室" });

    await user.click(screen.getByRole("button", { name: "消息操作" }));
    await user.click(screen.getByRole("menuitem", { name: "编辑" }));
    const editor = screen.getByRole("textbox", { name: "编辑消息" });
    await user.clear(editor);
    await user.type(editor, "发布计划已经更新");
    await user.click(screen.getByRole("button", { name: "保存" }));
    await waitFor(() => expect(client.editMessage).toHaveBeenCalledWith(
      "room",
      "message-1",
      "发布计划已经更新",
      1,
    ));
    expect(await screen.findByText("已编辑")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "消息操作" }));
    await user.click(screen.getByRole("menuitem", { name: "撤回" }));
    expect(screen.getByRole("alertdialog", { name: "确认撤回消息" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "确认撤回" }));
    await waitFor(() => expect(client.retractMessage).toHaveBeenCalledWith(
      "room",
      "message-1",
      2,
    ));
    expect(await screen.findByText("这条消息已撤回")).toBeInTheDocument();
  });

  it("sends a ready attachment without requiring message text", async () => {
    const client = createClient();
    const attachment = {
      id: "attachment-only",
      workspaceId: "workspace",
      uploaderPrincipalId: "subai",
      originalName: "产品计划.txt",
      declaredMediaType: "text/plain",
      detectedMediaType: "text/plain",
      sizeBytes: 4,
      sha256: "a".repeat(64),
      status: "ready" as const,
      provenance: "human_upload" as const,
      sourceRunId: null,
      errorCode: null,
      expiresAt: null,
      createdAt,
      updatedAt: createdAt,
    };
    const attachmentClient: AttachmentClient = {
      begin: vi.fn(async () => ({
        duplicate: false,
        attachment: { ...attachment, status: "pending" as const, detectedMediaType: null, sizeBytes: null, sha256: null },
      })),
      upload: vi.fn(async (_id, _file, onProgress) => {
        onProgress(100);
        return attachment;
      }),
    };
    const user = userEvent.setup();
    render(<CollaborationRoom attachmentClient={attachmentClient} client={client} />);
    await screen.findByRole("heading", { name: "交付协作室" });

    await user.upload(
      screen.getByLabelText("添加附件"),
      new File(["plan"], "产品计划.txt", { type: "text/plain" }),
    );
    await waitFor(() => expect(screen.getByText("已就绪")).toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: "发送消息" }));

    expect(client.sendMessage).toHaveBeenCalledWith(
      "room",
      expect.objectContaining({ content: "", attachmentIds: ["attachment-only"] }),
    );
  });

  it("exposes human intervention and retry as visible run actions", async () => {
    const intervention = {
      ...snapshot.messages[0],
      id: "intervention-1",
      kind: "intervention" as const,
      content: "苏白已要求 Reviewer 停止本次执行。",
    };
    const client = createClient({
      intervene: vi.fn(async () => intervention) as unknown as RoomClient["intervene"],
    });
    const user = userEvent.setup();
    render(<CollaborationRoom client={client} />);
    await screen.findByRole("heading", { name: "交付协作室" });

    await user.click(screen.getByRole("button", { name: "停止 Reviewer" }));
    await user.click(screen.getByRole("button", { name: "重试 Planner" }));

    await waitFor(() => {
      expect(client.intervene).toHaveBeenCalledWith(
        "room",
        "run-reviewer",
        "Su Bai已要求 Reviewer 停止本次执行。",
        expect.any(String),
      );
      expect(client.retryRun).toHaveBeenCalledWith(
        "room",
        "run-failed",
        expect.any(String),
      );
    });
    expect(screen.getByText(intervention.content)).toBeInTheDocument();
  });

  it("does not offer a fake stop action for a non-cancellable Agent", async () => {
    const yosWorkspace = {
      ...workspace,
      agents: workspace.agents.map((agent) => agent.principalId === "reviewer"
        ? { ...agent, displayName: "YOS", capabilities: { cancellation: false } }
        : agent),
    } as CurrentWorkspace;
    const client = createClient({
      getCurrentWorkspace: vi.fn(async () => yosWorkspace),
    });

    render(<CollaborationRoom client={client} />);
    await screen.findByRole("heading", { name: "交付协作室" });

    expect(screen.getAllByText("执行中").length).toBeGreaterThan(0);
    expect(screen.queryByRole("button", { name: "停止 YOS" })).not.toBeInTheDocument();
  });

  it("restores the selected room from the URL and switches rooms without a reload", async () => {
    const secondSnapshot = {
      ...snapshot,
      room: { ...snapshot.room, id: "room-2", name: "设计评审室" },
      messages: [],
      runs: [],
      delegations: [],
      artifacts: [],
    } as RoomSnapshot;
    const multiRoomWorkspace = {
      ...workspace,
      rooms: [workspace.rooms[0], secondSnapshot.room],
    } as CurrentWorkspace;
    const client = createClient({
      getCurrentWorkspace: vi.fn(async () => multiRoomWorkspace),
      getRoom: vi.fn(async (roomId) => roomId === "room-2" ? secondSnapshot : snapshot),
    });
    const user = userEvent.setup();
    window.history.replaceState({}, "", "/conversation?room=room-2");

    render(<CollaborationRoom client={client} />);

    expect(await screen.findByRole("heading", { level: 1, name: "设计评审室" })).toBeInTheDocument();
    expect(client.getRoom).toHaveBeenCalledWith("room-2");
    await user.click(screen.getByRole("button", { name: "切换到交付协作室" }));
    expect(await screen.findByRole("heading", { level: 1, name: "交付协作室" })).toBeInTheDocument();
    expect(window.location.search).toBe("?room=room");
  });

  it("ignores a stale run refresh after the user switches rooms", async () => {
    const secondSnapshot = {
      ...snapshot,
      room: { ...snapshot.room, id: "room-2", name: "设计评审室" },
      messages: [],
      runs: [],
      delegations: [],
      artifacts: [],
    } as RoomSnapshot;
    const multiRoomWorkspace = {
      ...workspace,
      rooms: [workspace.rooms[0], secondSnapshot.room],
    } as CurrentWorkspace;
    let staleHandlers: Parameters<RoomClient["subscribeToRun"]>[2] | undefined;
    const client = createClient({
      getCurrentWorkspace: vi.fn(async () => multiRoomWorkspace),
      getRoom: vi.fn(async (roomId) => roomId === "room-2" ? secondSnapshot : snapshot),
      subscribeToRun: vi.fn((_roomId, runId, handlers) => {
        if (runId === "run-reviewer") staleHandlers = handlers;
        return () => undefined;
      }),
    });
    const user = userEvent.setup();
    render(<CollaborationRoom client={client} />);
    await screen.findByRole("heading", { level: 1, name: "交付协作室" });
    await waitFor(() => expect(staleHandlers).toBeDefined());

    await user.click(screen.getByRole("button", { name: "切换到设计评审室" }));
    expect(await screen.findByRole("heading", { level: 1, name: "设计评审室" })).toBeInTheDocument();

    staleHandlers?.onEvent({
      runId: "run-reviewer",
      sequence: 3,
      type: "completed",
      text: "旧房间任务已完成",
    });

    await waitFor(() => expect(client.getRoom).toHaveBeenCalledWith("room"));
    expect(screen.getByRole("heading", { level: 1, name: "设计评审室" })).toBeInTheDocument();
  });

  it("creates a room from the room rail and enters its empty state", async () => {
    const createdRoom = { ...snapshot.room, id: "room-new", name: "架构讨论室" };
    const createdSnapshot = {
      ...snapshot,
      room: createdRoom,
      messages: [],
      runs: [],
      delegations: [],
      artifacts: [],
    } as RoomSnapshot;
    const client = createClient({
      createRoom: vi.fn(async () => ({ duplicate: false, room: createdRoom })),
      getRoom: vi.fn(async (roomId) => roomId === "room-new" ? createdSnapshot : snapshot),
    });
    const user = userEvent.setup();
    render(<CollaborationRoom client={client} />);
    await screen.findByRole("heading", { name: "交付协作室" });

    await user.click(screen.getByRole("button", { name: "新建房间" }));
    await user.type(screen.getByRole("textbox", { name: "房间名称" }), "架构讨论室");
    await user.click(screen.getByRole("button", { name: "创建房间" }));

    expect(client.createRoom).toHaveBeenCalledWith("架构讨论室", expect.any(String));
    expect(await screen.findByRole("heading", { level: 1, name: "架构讨论室" })).toBeInTheDocument();
    expect(screen.getByText("等待第一条协作消息。")).toBeInTheDocument();
    expect(window.location.search).toBe("?room=room-new");
  });

  it("renames and archives from details, then restores from the secondary rail", async () => {
    const secondRoom = {
      ...workspace.rooms[0],
      id: "room-2",
      name: "设计评审室",
      lastMessagePreview: "确认最终视觉规范",
    };
    const secondSnapshot = {
      ...snapshot,
      room: { ...snapshot.room, id: secondRoom.id, name: secondRoom.name },
      messages: [],
      runs: [],
      delegations: [],
      artifacts: [],
    } as RoomSnapshot;
    const multiRoomWorkspace = {
      ...workspace,
      rooms: [workspace.rooms[0], secondRoom],
    } as CurrentWorkspace;
    const client = createClient({
      getCurrentWorkspace: vi.fn(async () => multiRoomWorkspace),
      getRoom: vi.fn(async (roomId) => roomId === "room-2" ? secondSnapshot : snapshot),
      renameRoom: vi.fn(async () => ({ ...snapshot.room, name: "发布协作室" })),
      setRoomStatus: vi.fn(async (roomId, status) => ({
        ...(roomId === "room-2" ? secondSnapshot.room : snapshot.room),
        status,
      })),
    });
    const user = userEvent.setup();
    render(<CollaborationRoom client={client} />);
    await screen.findByRole("heading", { name: "交付协作室" });

    expect(screen.getAllByText("请共同制定发布计划")).toHaveLength(2);
    await user.click(screen.getByRole("button", { name: "打开会话详情" }));
    expect(await screen.findByRole("complementary", { name: "交付协作室详情" })).toBeInTheDocument();
    expect(screen.getByText("room")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "重命名房间" }));
    await user.clear(screen.getByRole("textbox", { name: "房间名称" }));
    await user.type(screen.getByRole("textbox", { name: "房间名称" }), "发布协作室");
    await user.click(screen.getByRole("button", { name: "保存房间名称" }));
    expect(client.renameRoom).toHaveBeenCalledWith("room", "发布协作室");
    expect(await screen.findByRole("heading", { level: 1, name: "发布协作室" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "归档房间" }));
    await user.click(screen.getByRole("button", { name: "确认归档" }));
    expect(client.setRoomStatus).toHaveBeenCalledWith("room", "archived");
    expect(await screen.findByRole("heading", { level: 1, name: "设计评审室" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "显示已归档房间" }));
    await user.click(screen.getByRole("button", { name: "恢复发布协作室" }));
    expect(client.setRoomStatus).toHaveBeenCalledWith("room", "active");
    expect(screen.getByRole("button", { name: "切换到发布协作室" })).toBeInTheDocument();
  });

  it("manages human and Agent members from the room details pane", async () => {
    const candidate = {
      principalId: "candidate",
      principalKind: "agent" as const,
      displayName: "Local Candidate",
      workspaceRole: "member" as const,
    };
    const client = createClient({
      getRoomMembers: vi.fn(async () => ({
        canManage: true,
        canEditProfile: true,
        members: snapshot.members,
        candidates: [candidate],
      })),
    });
    const user = userEvent.setup();
    render(<CollaborationRoom client={client} />);
    await screen.findByRole("heading", { name: "交付协作室" });

    await user.click(screen.getByRole("button", { name: "打开会话详情" }));
    const removePlanner = await screen.findByRole("button", { name: "移除 Planner" });
    await user.click(removePlanner);
    await user.click(screen.getByRole("button", { name: "确认移除 Planner" }));
    expect(client.removeRoomMember).toHaveBeenCalledWith("room", "planner");

    await user.click(screen.getByRole("button", { name: "添加 Candidate" }));
    expect(client.addRoomMember).toHaveBeenCalledWith("room", "candidate");
  });

  it("shows a recoverable room-details error state", async () => {
    const client = createClient({
      getRoomMembers: vi.fn(async () => {
        throw new Error("offline");
      }),
    });
    const user = userEvent.setup();
    render(<CollaborationRoom client={client} />);
    await screen.findByRole("heading", { name: "交付协作室" });

    await user.click(screen.getByRole("button", { name: "打开会话详情" }));
    expect(await screen.findByText("房间详情暂时无法载入")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "重试房间详情" }));
    expect(client.getRoomMembers).toHaveBeenCalledTimes(2);
  });

  it("keeps older reading position and offers a return-to-latest action", async () => {
    const deferred: { resolve?: (value: RoomSubmission) => void } = {};
    const client = createClient({
      sendMessage: vi.fn(() => new Promise<RoomSubmission>((resolve) => {
        deferred.resolve = resolve;
      })),
    });
    const user = userEvent.setup();
    render(<CollaborationRoom client={client} />);
    await screen.findByRole("heading", { name: "交付协作室" });
    const timeline = screen.getByRole("region", { name: "交付协作室消息" });
    Object.defineProperties(timeline, {
      clientHeight: { configurable: true, value: 400 },
      scrollHeight: { configurable: true, value: 1200 },
      scrollTop: { configurable: true, value: 200, writable: true },
    });
    fireEvent.scroll(timeline);

    await user.type(screen.getByRole("textbox", { name: "发送到交付协作室" }), "补充一个新结论");
    await user.click(screen.getByRole("button", { name: "发送消息" }));
    expect(screen.getByText("发送中…")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "回到最新消息" })).toBeInTheDocument();
    expect(timeline.scrollTop).toBe(200);

    fireEvent.click(screen.getByRole("button", { name: "回到最新消息" }));
    expect(timeline.scrollTop).toBe(1200);
    deferred.resolve?.({
      duplicate: false,
      message: { ...snapshot.messages[0], id: "sent", content: "补充一个新结论" },
      runs: [],
    });
  });

  it("keeps an actionable error state inside the product shell", async () => {
    const client = createClient({
      getCurrentWorkspace: vi.fn(async () => {
        throw new Error("offline");
      }),
    });
    const user = userEvent.setup();
    render(<CollaborationRoom client={client} />);

    expect(await screen.findByText("协作房间暂时无法载入")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "重新载入" }));
    expect(client.getCurrentWorkspace).toHaveBeenCalledTimes(2);
  });
});

describe("timeline following", () => {
  it("follows only when the viewport is near the latest content", () => {
    expect(isTimelineNearBottom({ scrollTop: 700, scrollHeight: 1200, clientHeight: 400 })).toBe(true);
    expect(isTimelineNearBottom({ scrollTop: 200, scrollHeight: 1200, clientHeight: 400 })).toBe(false);
  });
});
