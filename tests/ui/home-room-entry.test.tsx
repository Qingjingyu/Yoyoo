import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { vi } from "vitest";

import { HomeExperience } from "@/components/home/home-experience";
import type { CurrentWorkspace, RoomClient } from "@/lib/room-client";

const push = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
}));

const createdAt = new Date("2026-08-15T08:00:00.000Z");
const workspace = {
  principal: {
    id: "human-1",
    kind: "human",
    externalKey: "aicard:subject-1",
    handle: "linlan",
    displayName: "林岚",
    status: "active",
    metadata: {},
    createdAt,
    updatedAt: createdAt,
  },
  workspace: {
    id: "workspace-1",
    slug: "yoyoo-space",
    name: "Yoyoo Space",
    status: "active",
    createdAt,
    updatedAt: createdAt,
  },
  rooms: [
    {
      id: "room-42",
      workspaceId: "workspace-1",
      legacyConversationId: null,
      name: "协作室",
      purpose: "共同工作",
      kind: "group",
      directHumanPrincipalId: null,
      directAgentPrincipalId: null,
      status: "active",
      createdByPrincipalId: "human-1",
      createdAt,
      updatedAt: createdAt,
      lastMessagePreview: null,
      lastMessageAt: null,
      lastActivityAt: createdAt,
      unreadCount: 0,
      pinnedAt: null,
    },
  ],
  archivedRooms: [],
  agents: [],
} satisfies CurrentWorkspace;

function createRoomClient(currentWorkspace: CurrentWorkspace = workspace): RoomClient {
  return {
    getCurrentWorkspace: vi.fn(async () => currentWorkspace),
    sendMessage: vi.fn(async (_roomId, input) => ({
      duplicate: false,
      message: {
        id: "message-1",
        roomId: "room-42",
        senderPrincipalId: "human-1",
        kind: "message",
        content: input.content,
        status: "completed",
        idempotencyKey: input.idempotencyKey,
        replyToMessageId: null,
        threadRootMessageId: null,
        mentionedPrincipalIds: [],
        revisionNumber: 1,
        retractedAt: null,
        retractedByPrincipalId: null,
        createdAt,
        updatedAt: createdAt,
      },
      runs: [],
    })),
  } as unknown as RoomClient;
}

describe("home room entry", () => {
  it("sends the first homepage message to an exact room id", async () => {
    const user = userEvent.setup();
    const client = createRoomClient();

    render(<HomeExperience roomClient={client} />);

    const input = await screen.findByRole("textbox", { name: "给 Yoyoo 发消息" });
    await user.type(input, "帮我整理今天的任务");
    await user.click(screen.getByRole("button", { name: "发送消息" }));

    expect(client.sendMessage).toHaveBeenCalledWith(
      "room-42",
      expect.objectContaining({
        content: "帮我整理今天的任务",
        mentionedPrincipalIds: [],
      }),
    );
    expect(push).toHaveBeenCalledWith("/conversation?room=room-42");
  });

  it("greets the authenticated principal instead of a hard-coded owner", async () => {
    render(<HomeExperience roomClient={createRoomClient()} />);

    expect(await screen.findByRole("heading", { name: /林岚/ })).toBeInTheDocument();
    expect(screen.queryByText(/苏白/)).not.toBeInTheDocument();
  });

  it("does not expose a simulated microphone control as a working feature", async () => {
    render(<HomeExperience roomClient={createRoomClient()} />);

    expect(await screen.findByRole("textbox", { name: "给 Yoyoo 发消息" }))
      .toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "开始语音对话" }))
      .not.toBeInTheDocument();
    expect(screen.queryByText("正在聆听")).not.toBeInTheDocument();
  });
});
