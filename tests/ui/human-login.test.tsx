/** @vitest-environment jsdom */

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { vi } from "vitest";

import { HumanLogin } from "@/components/auth/human-login";

describe("HumanLogin", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
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

    await user.type(screen.getByLabelText("AI Card ID"), "AI_100001");
    await user.type(screen.getByLabelText("密码"), "wrong-password");
    await user.click(screen.getByRole("button", { name: "进入 Yoyoo" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "AI Card ID 或密码不正确",
    );
    expect(screen.getByRole("button", { name: "进入 Yoyoo" })).toBeEnabled();
  });
});
