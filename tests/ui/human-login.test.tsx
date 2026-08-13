/** @vitest-environment jsdom */

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderToString } from "react-dom/server";
import { vi } from "vitest";

import { HumanLogin } from "@/components/auth/human-login";

describe("HumanLogin", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("fails closed before the login page has hydrated", () => {
    const container = document.createElement("div");
    container.innerHTML = renderToString(<HumanLogin />);

    const form = container.querySelector("form");
    expect(form).toHaveAttribute("method", "post");
    expect(form).toHaveAttribute("action", "/api/v1/auth/login");
    expect(container.querySelector('input[name="loginHandle"]')).toBeDisabled();
    expect(container.querySelector('input[name="password"]')).toBeDisabled();
    expect(container.querySelector("button")).toBeDisabled();
    expect(container.querySelector('.human-login-primary')).toHaveAttribute(
      "href",
      "/api/v1/auth/aicard/start?next=%2F",
    );
  });

  it("uses AI Card as the primary path and preserves a safe local return path", () => {
    render(<HumanLogin nextPath="/conversation?room=room-1" />);

    expect(screen.getByRole("link", { name: "使用 AI Card 继续" })).toHaveAttribute(
      "href",
      "/api/v1/auth/aicard/start?next=%2Fconversation%3Froom%3Droom-1",
    );
    expect(screen.getByText(/进入当前空间仍需已有授权/)).toBeInTheDocument();
  });

  it("signs in with a public AI Card ID and returns to a safe local path", async () => {
    const user = userEvent.setup();
    const onAuthenticated = vi.fn();
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ authenticated: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    render(
      <HumanLogin
        nextPath="/conversation?room=room-1"
        onAuthenticated={onAuthenticated}
      />,
    );

    await user.click(screen.getByText("使用临时本地账号"));
    await user.type(screen.getByLabelText("AI Card ID"), "AI_100001");
    await user.type(screen.getByLabelText("密码"), "a-secure-password");
    await user.click(screen.getByRole("button", { name: "进入 Yoyoo" }));

    expect(fetch).toHaveBeenCalledWith("/api/v1/auth/login", expect.objectContaining({
      method: "POST",
      body: JSON.stringify({
        loginHandle: "AI_100001",
        password: "a-secure-password",
      }),
    }));
    expect(await screen.findByRole("status")).toHaveTextContent("身份验证成功");
    expect(onAuthenticated).toHaveBeenCalledWith("/conversation?room=room-1");
  });

  it("does not redirect to another origin through the next parameter", async () => {
    const user = userEvent.setup();
    const onAuthenticated = vi.fn();
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ authenticated: true }), { status: 200 }),
    );
    render(
      <HumanLogin
        nextPath="https://attacker.example/collect"
        onAuthenticated={onAuthenticated}
      />,
    );

    expect(screen.getByRole("link", { name: "使用 AI Card 继续" })).toHaveAttribute(
      "href",
      "/api/v1/auth/aicard/start?next=%2F",
    );
    await user.click(screen.getByText("使用临时本地账号"));
    await user.type(screen.getByLabelText("AI Card ID"), "AI_100001");
    await user.type(screen.getByLabelText("密码"), "a-secure-password");
    await user.click(screen.getByRole("button", { name: "进入 Yoyoo" }));

    expect(onAuthenticated).toHaveBeenCalledWith("/");
  });

  it("keeps a failed login visible and allows another attempt", async () => {
    const user = userEvent.setup();
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify({
        error: { code: "INVALID_CREDENTIALS", message: "AI Card ID 或密码不正确。" },
      }), { status: 401, headers: { "content-type": "application/json" } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ authenticated: true }), {
        status: 200,
      }));
    render(<HumanLogin onAuthenticated={() => undefined} />);

    await user.click(screen.getByText("使用临时本地账号"));
    await user.type(screen.getByLabelText("AI Card ID"), "AI_100001");
    await user.type(screen.getByLabelText("密码"), "wrong-password");
    await user.click(screen.getByRole("button", { name: "进入 Yoyoo" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "AI Card ID 或密码不正确",
    );
    expect(screen.getByRole("button", { name: "进入 Yoyoo" })).toBeEnabled();
  });
});
