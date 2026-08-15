/** @vitest-environment jsdom */

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderToString } from "react-dom/server";
import { vi } from "vitest";

import { HumanLogin } from "@/components/auth/human-login";

const transaction = {
  issuer: "https://id.yoyooai.com",
  request: {
    responseType: "code",
    clientId: "yoyoo_prod",
    redirectUri: "http://localhost:3000/auth/aicard/callback",
    scope: "card.basic card.handle card.id offline_access",
    state: "state_1234567890123456",
    codeChallenge: "x".repeat(43),
    codeChallengeMethod: "S256",
  },
};

const authenticatedCard = {
  card: { card_id: "AI_100001", handle: "subai", display_name: "苏白" },
  csrf_token: "c".repeat(43),
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("HumanLogin", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("fails closed before hydration and does not expose an external identity link", () => {
    const container = document.createElement("div");
    container.innerHTML = renderToString(<HumanLogin />);

    expect(container.querySelector("form button[type=submit]")).toBeDisabled();
    expect(container.querySelector('input[name="identifier"]')).toBeDisabled();
    expect(container.querySelector('input[name="password"]')).toBeDisabled();
    expect(container.querySelector('a[href*="aicard"]')).toBeNull();
    expect(container.textContent).toContain("人和 AI 共用的协作空间");
  });

  it("shows login and create as first-class inline choices", () => {
    render(<HumanLogin />);

    expect(screen.getByRole("tab", { name: "登录 AI Card" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(screen.getByRole("tab", { name: "创建 AI Card" })).toBeEnabled();
    expect(screen.getByLabelText("AI Card ID 或用户名")).toBeInTheDocument();
    expect(screen.queryByText("使用临时本地账号")).not.toBeInTheDocument();
  });

  it("uses the shared eight-character password boundary", async () => {
    const user = userEvent.setup();
    render(<HumanLogin />);

    expect(screen.getByLabelText("密码")).toHaveAttribute("minLength", "8");
    await user.click(screen.getByRole("tab", { name: "创建 AI Card" }));
    expect(screen.getByLabelText("设置密码")).toHaveAttribute("minLength", "8");
    expect(screen.getByLabelText("设置密码")).toHaveAttribute("placeholder", "至少 8 个字符");
    expect(screen.getByLabelText("确认密码")).toHaveAttribute("minLength", "8");
  });

  it("logs in through AI Card without sending the password to Yoyoo", async () => {
    const user = userEvent.setup();
    const onAuthenticated = vi.fn();
    const callbackUrl = `${transaction.request.redirectUri}?state=${transaction.request.state}&code=ac_${"a".repeat(43)}`;
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(json(transaction))
      .mockResolvedValueOnce(json(authenticatedCard))
      .mockResolvedValueOnce(json({ redirect_url: callbackUrl }));
    render(<HumanLogin nextPath="/conversation?room=room-1" onAuthenticated={onAuthenticated} />);

    await user.type(screen.getByLabelText("AI Card ID 或用户名"), "AI_100001");
    await user.type(screen.getByLabelText("密码"), "a-secure-password");
    await user.click(screen.getByRole("button", { name: "进入 Yoyoo" }));

    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "/api/v1/auth/aicard/start?format=json&next=%2Fconversation%3Froom%3Droom-1",
    );
    expect(fetchMock.mock.calls[1]).toEqual([
      "https://id.yoyooai.com/api/v1/auth/password/login",
      expect.objectContaining({
        method: "POST",
        credentials: "include",
        body: JSON.stringify({ identifier: "AI_100001", password: "a-secure-password" }),
      }),
    ]);
    expect(fetchMock.mock.calls[2]?.[0]).toBe("https://id.yoyooai.com/api/v1/authorize");
    expect(String(fetchMock.mock.calls[0]?.[1]?.body ?? "")).not.toContain("a-secure-password");
    expect(String(fetchMock.mock.calls[2]?.[1]?.body ?? "")).not.toContain("a-secure-password");
    expect(onAuthenticated).toHaveBeenCalledWith(callbackUrl);
  });

  it("creates a permanent AI Card inline and shows the issued ID", async () => {
    const user = userEvent.setup();
    const callbackUrl = `${transaction.request.redirectUri}?state=${transaction.request.state}&code=ac_${"a".repeat(43)}`;
    vi.spyOn(globalThis.crypto, "randomUUID").mockReturnValue(
      "12345678-1234-4234-8234-123456789012",
    );
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(json(transaction))
      .mockResolvedValueOnce(json({ ...authenticatedCard, replayed: false }, 201))
      .mockResolvedValueOnce(json({ redirect_url: callbackUrl }));
    render(<HumanLogin onAuthenticated={() => undefined} />);

    await user.click(screen.getByRole("tab", { name: "创建 AI Card" }));
    await user.type(screen.getByLabelText("昵称"), "苏白");
    await user.type(screen.getByLabelText("用户名"), "subai");
    await user.type(screen.getByLabelText("设置密码"), "a-secure-password");
    await user.type(screen.getByLabelText("确认密码"), "a-secure-password");
    await user.click(screen.getByRole("button", { name: "创建并进入 Yoyoo" }));

    expect(fetchMock.mock.calls[1]).toEqual([
      "https://id.yoyooai.com/api/v1/auth/password/register",
      expect.objectContaining({
        method: "POST",
        credentials: "include",
        body: JSON.stringify({
          clientId: "yoyoo_prod",
          displayName: "苏白",
          handle: "subai",
          password: "a-secure-password",
        }),
      }),
    ]);
    expect(await screen.findByRole("status")).toHaveTextContent("AI_100001");
  });

  it("keeps a provider failure visible and allows another attempt", async () => {
    const user = userEvent.setup();
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(json(transaction))
      .mockResolvedValueOnce(json({
        error: { message: "AI Card ID 或密码不正确。" },
      }, 401));
    render(<HumanLogin />);

    await user.type(screen.getByLabelText("AI Card ID 或用户名"), "AI_100001");
    await user.type(screen.getByLabelText("密码"), "wrong-password");
    await user.click(screen.getByRole("button", { name: "进入 Yoyoo" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("AI Card ID 或密码不正确");
    expect(screen.getByRole("button", { name: "进入 Yoyoo" })).toBeEnabled();
  });

  it("turns a provider network failure into a retryable Chinese error", async () => {
    const user = userEvent.setup();
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(json(transaction))
      .mockRejectedValueOnce(new TypeError("Failed to fetch"));
    render(<HumanLogin />);

    await user.type(screen.getByLabelText("AI Card ID 或用户名"), "AI_100001");
    await user.type(screen.getByLabelText("密码"), "a-secure-password");
    await user.click(screen.getByRole("button", { name: "进入 Yoyoo" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("身份服务暂时无法连接");
    expect(screen.getByRole("button", { name: "进入 Yoyoo" })).toBeEnabled();
  });

  it("rejects a callback outside Yoyoo even when the provider response is successful", async () => {
    const user = userEvent.setup();
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(json(transaction))
      .mockResolvedValueOnce(json(authenticatedCard))
      .mockResolvedValueOnce(json({ redirect_url: "https://attacker.example/collect" }));
    render(<HumanLogin />);

    await user.type(screen.getByLabelText("AI Card ID 或用户名"), "AI_100001");
    await user.type(screen.getByLabelText("密码"), "a-secure-password");
    await user.click(screen.getByRole("button", { name: "进入 Yoyoo" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("安全校验失败");
  });

  it("rejects a same-origin callback when the OAuth state was changed", async () => {
    const user = userEvent.setup();
    const changedStateUrl = `${transaction.request.redirectUri}?state=changed_state&code=ac_${"a".repeat(43)}`;
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(json(transaction))
      .mockResolvedValueOnce(json(authenticatedCard))
      .mockResolvedValueOnce(json({ redirect_url: changedStateUrl }));
    render(<HumanLogin />);

    await user.type(screen.getByLabelText("AI Card ID 或用户名"), "AI_100001");
    await user.type(screen.getByLabelText("密码"), "a-secure-password");
    await user.click(screen.getByRole("button", { name: "进入 Yoyoo" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("安全校验失败");
  });
});
