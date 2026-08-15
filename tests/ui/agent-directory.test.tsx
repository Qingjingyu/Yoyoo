/** @vitest-environment jsdom */

import { render, screen, type RenderOptions } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { vi } from "vitest";

import {
  AgentDirectory,
  type CurrentIdentityClient,
} from "@/components/settings/agent-directory";
import { ThemeProvider } from "@/components/theme/theme-provider";
import type { AgentDirectoryClient, AgentDirectoryRecord } from "@/lib/agent-directory-client";

const existingAgent: AgentDirectoryRecord = {
  principalId: "agent-1",
  workspaceId: "workspace-1",
  handle: "researcher",
  displayName: "Researcher",
  authenticationMode: "gateway_token",
  credentialStatus: "active",
  connectionStatus: "connected",
  tokenHint: "abcd1234",
  credentialVersion: 1,
  lastSeenAt: new Date().toISOString(),
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

function renderWithTheme(
  ui: ReactNode,
  options?: Omit<RenderOptions, "wrapper">,
) {
  return render(ui, { ...options, wrapper: ThemeProvider });
}

function createClient(
  overrides: Partial<AgentDirectoryClient> = {},
): AgentDirectoryClient {
  return {
    listAgents: async () => [existingAgent],
    rotateCredential: async () => ({
      agent: { ...existingAgent, credentialVersion: 2 },
      token: `yya_${"r".repeat(43)}`,
    }),
    revokeCredential: async () => ({
      ...existingAgent,
      credentialStatus: "revoked",
      connectionStatus: "revoked",
    }),
    ...overrides,
  };
}

function createIdentityClient(
  overrides: Partial<CurrentIdentityClient> = {},
): CurrentIdentityClient {
  return {
    getCurrentIdentity: async () => ({
      aiCardId: "AI_100001",
      loginHandle: "subai",
      displayName: "苏白",
    }),
    ...overrides,
  };
}

describe("AgentDirectory", () => {
  it("only authorizes AI identities that already own an AI Card", async () => {
    renderWithTheme(
      <AgentDirectory
        client={createClient({ listAgents: async () => [] })}
        identityClient={createIdentityClient()}
      />,
    );

    expect(await screen.findByText("尚未接入 AI")).toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: "授权 AI 接入" })).toHaveLength(1);
    expect(screen.getByRole("link", { name: "授权 AI 接入" })).toHaveAttribute(
      "href",
      "/api/v1/auth/aicard/start?purpose=agent",
    );
    expect(screen.getByText("YOS 或其他 AI 需先拥有 AI Card，再由你授权加入当前空间。")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "兼容接入 AI" })).not.toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: "显示名称" })).not.toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: "Agent 标识" })).not.toBeInTheDocument();
  });

  it("shows the current AI Card inside Yoyoo without navigating away", async () => {
    const user = userEvent.setup();
    renderWithTheme(
      <AgentDirectory
        client={createClient()}
        identityClient={createIdentityClient()}
        aicardResult="connected"
      />,
    );

    expect(screen.getByRole("link", { name: "授权 AI 接入" })).toHaveAttribute(
      "href",
      "/api/v1/auth/aicard/start?purpose=agent",
    );
    const cardButton = await screen.findByRole("button", { name: "我的 AI Card" });
    expect(screen.queryByRole("link", { name: "我的 AI Card" })).not.toBeInTheDocument();
    await user.click(cardButton);
    const card = screen.getByRole("dialog", { name: "我的 AI Card" });
    expect(card).toHaveTextContent("苏白");
    expect(card).toHaveTextContent("AI_100001");
    expect(card).toHaveTextContent("@subai");
    expect(screen.queryByRole("link", { name: "连接我的身份" })).not.toBeInTheDocument();
    expect(await screen.findByRole("status")).toHaveTextContent(
      "统一 AI Card 身份已确认",
    );
  });

  it("keeps identity loading failures visible and retryable", async () => {
    const user = userEvent.setup();
    const getCurrentIdentity = vi
      .fn<CurrentIdentityClient["getCurrentIdentity"]>()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce({
        aiCardId: "AI_100001",
        loginHandle: "subai",
        displayName: "苏白",
      });
    renderWithTheme(
      <AgentDirectory
        client={createClient()}
        identityClient={createIdentityClient({ getCurrentIdentity })}
      />,
    );

    expect(await screen.findByText("身份暂时无法载入")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "重新载入身份" }));
    expect(await screen.findByRole("button", { name: "我的 AI Card" })).toBeEnabled();
  });

  it("renders an AI Card Agent without legacy credential actions", async () => {
    const cardAgent: AgentDirectoryRecord = {
      ...existingAgent,
      principalId: "card-agent-1",
      displayName: "悠悠研究员",
      handle: "yoyoo_researcher",
      authenticationMode: "aicard",
      credentialStatus: null,
      connectionStatus: "never_connected",
      tokenHint: null,
      credentialVersion: null,
      lastSeenAt: null,
    };
    renderWithTheme(
      <AgentDirectory
        client={createClient({ listAgents: async () => [cardAgent] })}
        identityClient={createIdentityClient()}
      />,
    );

    expect(await screen.findByText("悠悠研究员")).toBeInTheDocument();
    expect(screen.getByText("等待运行节点")).toBeInTheDocument();
    expect(screen.getByText("AI Card")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /轮换 悠悠研究员/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /撤销 悠悠研究员/ })).not.toBeInTheDocument();
  });

  it("renders connected legacy Agents without offering local identity creation", async () => {
    const client = createClient();
    renderWithTheme(
      <AgentDirectory client={client} identityClient={createIdentityClient()} />,
    );

    expect(await screen.findByRole("heading", { name: "AI 接入" })).toBeInTheDocument();
    expect(await screen.findByText("Researcher")).toBeInTheDocument();
    expect(screen.getByText("在线")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "设置" })).toHaveAttribute(
      "aria-current",
      "page",
    );

    expect(screen.queryByRole("button", { name: "兼容接入 AI" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "创建接入凭据" })).not.toBeInTheDocument();
  });

  it("requires inline confirmation for credential rotation and revocation", async () => {
    const user = userEvent.setup();
    const rotateCredential = vi.fn(createClient().rotateCredential);
    const revokeCredential = vi.fn(createClient().revokeCredential);
    renderWithTheme(
      <AgentDirectory
        client={createClient({ rotateCredential, revokeCredential })}
        identityClient={createIdentityClient()}
      />,
    );
    await screen.findByText("Researcher");

    await user.click(screen.getByRole("button", { name: "轮换 Researcher 的凭据" }));
    await user.click(screen.getByRole("button", { name: "确认轮换" }));
    expect(rotateCredential).toHaveBeenCalledWith("agent-1");
    expect(await screen.findByDisplayValue(`yya_${"r".repeat(43)}`)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "撤销 Researcher 的凭据" }));
    await user.click(screen.getByRole("button", { name: "确认撤销" }));
    expect(revokeCredential).toHaveBeenCalledWith("agent-1");
    expect(await screen.findByText("已撤销")).toBeInTheDocument();
  });

  it("keeps loading and error states inside the product shell", async () => {
    const user = userEvent.setup();
    const listAgents = vi
      .fn<AgentDirectoryClient["listAgents"]>()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce([]);
    renderWithTheme(
      <AgentDirectory
        client={createClient({ listAgents })}
        identityClient={createIdentityClient()}
      />,
    );

    expect(await screen.findByText("AI 目录暂时无法载入")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "重新载入" }));
    expect(await screen.findByText("尚未接入 AI")).toBeInTheDocument();
  });

  it("revokes the browser session from settings", async () => {
    const user = userEvent.setup();
    const onSignedOut = vi.fn();
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 204 }));
    renderWithTheme(
      <AgentDirectory
        client={createClient()}
        identityClient={createIdentityClient()}
        onSignedOut={onSignedOut}
      />,
    );

    await user.click(screen.getByRole("button", { name: "退出登录" }));

    expect(fetch).toHaveBeenCalledWith("/api/v1/auth/session", {
      method: "DELETE",
      credentials: "same-origin",
    });
    expect(onSignedOut).toHaveBeenCalled();
  });
});
