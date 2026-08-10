import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { vi } from "vitest";

import { HomeExperience } from "@/components/home/home-experience";
import { YoyooOrb } from "@/components/orb/yoyoo-orb";
import type { ConversationClient } from "@/lib/conversation-client";

const push = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
}));

function createConversationClient(
  overrides: Partial<ConversationClient> = {},
): ConversationClient {
  return {
    getCurrent: async () => ({
      conversation: { id: "conversation-1" },
      messages: [],
      activeRun: null,
      capabilities: { cancellation: true },
    }),
    sendMessage: async (content) => ({
      duplicate: false,
      message: {
        id: "message-user-1",
        conversationId: "conversation-1",
        senderType: "human",
        content,
        status: "completed",
      },
      run: { id: "run-1", status: "queued" },
    }),
    subscribeToRun: (_runId, handlers) => {
      queueMicrotask(() => {
        handlers.onEvent({ runId: "run-1", sequence: 1, type: "status", status: "running" });
        handlers.onEvent({ runId: "run-1", sequence: 2, type: "text_delta", delta: "已经收到。" });
        handlers.onEvent({
          runId: "run-1",
          sequence: 3,
          type: "completed",
          text: "已经收到。",
        });
      });
      return () => undefined;
    },
    cancelRun: async () => undefined,
    retryRun: async () => ({ id: "run-retry", status: "queued" }),
    ...overrides,
  };
}

describe("HomeExperience", () => {
  it("renders one centered conversation surface over the owned city backdrop", async () => {
    const { container } = render(
      <HomeExperience conversationClient={createConversationClient()} />,
    );

    expect(
      await screen.findByRole("heading", { name: "晚上好，苏白。" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Yoyoo 在线")).toBeInTheDocument();
    expect(container.querySelector(".space-backdrop")).toBeInTheDocument();
    expect(container.querySelector(".home-focus")).toHaveAttribute(
      "data-layout",
      "centered-conversation",
    );
    expect(container.querySelector(".presence-scene")).not.toBeInTheDocument();
    expect(screen.queryByRole("img", { name: /Yoyoo 数字生命/ })).not.toBeInTheDocument();
    expect(screen.getByRole("navigation", { name: "主导航" })).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "给 Yoyoo 发消息" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "开始语音对话" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "最近对话" })).not.toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: /首页|对话|设置/ })).toHaveLength(3);
  });

  it("keeps whitespace disabled and streams a real persisted Agent response", async () => {
    const user = userEvent.setup();
    render(
      <HomeExperience
        conversationClient={createConversationClient()}
        surface="conversation"
      />,
    );

    const input = await screen.findByRole("textbox", { name: "给 Yoyoo 发消息" });
    const submit = screen.getByRole("button", { name: "发送消息" });

    await user.type(input, "   ");
    expect(submit).toBeDisabled();

    await user.clear(input);
    await user.type(input, "帮我梳理今天最重要的三件事");
    expect(submit).toBeEnabled();
    await user.click(submit);

    expect(input).toHaveValue("");
    expect(screen.getByLabelText("当前对话")).toBeInTheDocument();
    expect(screen.getByText("帮我梳理今天最重要的三件事")).toBeInTheDocument();
    expect(await screen.findByText("已经收到。")).toBeInTheDocument();
    expect(screen.queryByText("Agent 尚未连接，这条消息仅保存在当前页面。"))
      .not.toBeInTheDocument();
    expect(screen.queryByRole("img", { name: /Yoyoo 数字生命/ })).not.toBeInTheDocument();
    expect(submit).toBeDisabled();
  });

  it("restores persisted messages and can stop a cancellable active run", async () => {
    const cancelRun = vi.fn(async () => undefined);
    const client = createConversationClient({
      getCurrent: async () => ({
        conversation: { id: "conversation-1" },
        messages: [
          {
            id: "persisted-user",
            conversationId: "conversation-1",
            senderType: "human",
            content: "刷新后仍然存在",
            status: "completed",
          },
        ],
        activeRun: { id: "active-run", status: "running" },
        capabilities: { cancellation: true },
      }),
      subscribeToRun: () => () => undefined,
      cancelRun,
    });
    const user = userEvent.setup();
    render(<HomeExperience conversationClient={client} surface="conversation" />);

    expect(await screen.findByText("刷新后仍然存在")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "停止回复" }));
    expect(cancelRun).toHaveBeenCalledWith("active-run");
  });

  it("enters, mutes, and exits the live conversation mode", async () => {
    const user = userEvent.setup();
    const { container } = render(
      <HomeExperience conversationClient={createConversationClient()} />,
    );

    await screen.findByRole("button", { name: "开始语音对话" });

    await user.click(screen.getByRole("button", { name: "开始语音对话" }));

    expect(screen.getByRole("heading", { name: "Yoyoo Live" })).toBeInTheDocument();
    expect(screen.getByText("正在聆听")).toBeInTheDocument();
    expect(container.querySelector(".presence-scene")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Yoyoo 数字生命，正在聆听")).toHaveAttribute(
      "data-palette",
      "cyber-spectrum",
    );
    expect(screen.queryByRole("textbox", { name: "给 Yoyoo 发消息" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "静音" }));
    expect(screen.getByText("麦克风已静音")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "取消静音" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "结束语音对话" }));
    expect(screen.queryByRole("heading", { name: "Yoyoo Live" })).not.toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "给 Yoyoo 发消息" })).toBeInTheDocument();
    expect(container.querySelector(".presence-scene")).not.toBeInTheDocument();
  });

  it("maps every future live state to an explicit accessible status", () => {
    const { rerender } = render(<YoyooOrb state="thinking" />);
    expect(screen.getByLabelText("Yoyoo 数字生命，正在思考")).toBeInTheDocument();

    rerender(<YoyooOrb state="speaking" />);
    expect(screen.getByLabelText("Yoyoo 数字生命，正在说话")).toBeInTheDocument();
  });

  it("shows loading and error states without replacing the product shell", () => {
    const client = createConversationClient();
    const { rerender } = render(
      <HomeExperience conversationClient={client} state="loading" />,
    );

    expect(screen.getByLabelText("正在加载 Yoyoo 首页")).toBeInTheDocument();
    expect(screen.getByRole("navigation", { name: "主导航" })).toBeInTheDocument();

    rerender(
      <HomeExperience
        conversationClient={client}
        state="error"
        onRetry={() => undefined}
      />,
    );
    expect(screen.getByText("首页暂时无法载入")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "重新载入" })).toBeInTheDocument();
  });

  it("keeps persisted messages out of the homepage and offers one continuation entry", async () => {
    const client = createConversationClient({
      getCurrent: async () => ({
        conversation: { id: "conversation-1" },
        messages: [
          {
            id: "persisted-user",
            conversationId: "conversation-1",
            senderType: "human",
            content: "这条历史消息只应出现在对话页",
            status: "completed",
          },
        ],
        activeRun: null,
        capabilities: { cancellation: true },
      }),
    });

    render(<HomeExperience conversationClient={client} surface="home" />);

    expect(await screen.findByRole("heading", { name: "晚上好，苏白。" }))
      .toBeInTheDocument();
    expect(screen.queryByLabelText("当前对话")).not.toBeInTheDocument();
    expect(screen.queryByText("这条历史消息只应出现在对话页"))
      .not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "继续上次对话" }))
      .toHaveAttribute("href", "/conversation");
  });

  it("renders the dedicated conversation surface with history and a bottom composer", async () => {
    const client = createConversationClient({
      getCurrent: async () => ({
        conversation: { id: "conversation-1" },
        messages: [
          {
            id: "persisted-agent",
            conversationId: "conversation-1",
            senderType: "agent",
            content: "对话页会使用完整的纵向空间。",
            status: "completed",
          },
        ],
        activeRun: null,
        capabilities: { cancellation: true },
      }),
    });

    const { container } = render(
      <HomeExperience conversationClient={client} surface="conversation" />,
    );

    expect(await screen.findByLabelText("当前对话")).toBeInTheDocument();
    expect(screen.getByText("对话页会使用完整的纵向空间。")).toBeInTheDocument();
    expect(container.querySelector(".conversation-workspace")).toHaveAttribute(
      "data-layout",
      "full-height-conversation",
    );
    expect(container.querySelector(".conversation-workspace__composer"))
      .toContainElement(screen.getByRole("textbox", { name: "给 Yoyoo 发消息" }));
  });
});
