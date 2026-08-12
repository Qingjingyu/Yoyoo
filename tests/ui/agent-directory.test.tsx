/** @vitest-environment jsdom */

import { render, screen, type RenderOptions } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { vi } from "vitest";

import { AgentDirectory } from "@/components/settings/agent-directory";
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
    createAgent: async (input) => ({
      agent: {
        ...existingAgent,
        principalId: "agent-2",
        handle: input.handle,
        displayName: input.displayName,
        connectionStatus: "never_connected",
        tokenHint: "newtoken",
      },
      token: `yya_${"n".repeat(43)}`,
    }),
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

describe("AgentDirectory", () => {
  it("offers AI Card authorization and renders callback outcomes", async () => {
    const { rerender } = renderWithTheme(
      <AgentDirectory client={createClient()} aicardResult="connected" />,
    );

    expect(screen.getByRole("link", { name: "接入 AI Card" })).toHaveAttribute(
      "href",
      "/api/v1/auth/aicard/start?purpose=agent",
    );
    expect(screen.getByRole("link", { name: "连接我的身份" })).toHaveAttribute(
      "href",
      "/api/v1/auth/aicard/start",
    );
    expect(await screen.findByRole("status")).toHaveTextContent(
      "AI Card 已连接到当前 Yoyoo 身份",
    );

    rerender(<AgentDirectory client={createClient()} aicardResult="invalid_session" />);
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "授权已失效，请重新连接",
    );
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
    renderWithTheme(<AgentDirectory client={createClient({ listAgents: async () => [cardAgent] })} />);

    expect(await screen.findByText("悠悠研究员")).toBeInTheDocument();
    expect(screen.getByText("等待运行节点")).toBeInTheDocument();
    expect(screen.getByText("AI Card")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /轮换 悠悠研究员/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /撤销 悠悠研究员/ })).not.toBeInTheDocument();
  });

  it("renders connected Agents and reveals a new credential only once", async () => {
    const user = userEvent.setup();
    const client = createClient();
    renderWithTheme(<AgentDirectory client={client} />);

    expect(await screen.findByRole("heading", { name: "AI 接入" })).toBeInTheDocument();
    expect(await screen.findByText("Researcher")).toBeInTheDocument();
    expect(screen.getByText("在线")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "设置" })).toHaveAttribute(
      "aria-current",
      "page",
    );

    await user.click(screen.getByRole("button", { name: "兼容接入 AI" }));
    await user.type(screen.getByRole("textbox", { name: "显示名称" }), "Writer");
    await user.type(screen.getByRole("textbox", { name: "Agent 标识" }), "writer");
    await user.click(screen.getByRole("button", { name: "创建接入凭据" }));

    expect(await screen.findByText("凭据仅显示一次")).toBeInTheDocument();
    expect(screen.getByDisplayValue(`yya_${"n".repeat(43)}`)).toBeInTheDocument();
    expect(screen.getAllByText("Writer")).toHaveLength(2);
  });

  it("requires inline confirmation for credential rotation and revocation", async () => {
    const user = userEvent.setup();
    const rotateCredential = vi.fn(createClient().rotateCredential);
    const revokeCredential = vi.fn(createClient().revokeCredential);
    renderWithTheme(
      <AgentDirectory
        client={createClient({ rotateCredential, revokeCredential })}
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
    renderWithTheme(<AgentDirectory client={createClient({ listAgents })} />);

    expect(await screen.findByText("AI 目录暂时无法载入")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "重新载入" }));
    expect(await screen.findByText("尚未接入 AI")).toBeInTheDocument();
  });

  it("revokes the browser session from settings", async () => {
    const user = userEvent.setup();
    const onSignedOut = vi.fn();
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 204 }));
    renderWithTheme(
      <AgentDirectory client={createClient()} onSignedOut={onSignedOut} />,
    );

    await user.click(screen.getByRole("button", { name: "退出登录" }));

    expect(fetch).toHaveBeenCalledWith("/api/v1/auth/session", {
      method: "DELETE",
      credentials: "same-origin",
    });
    expect(onSignedOut).toHaveBeenCalled();
  });
});
