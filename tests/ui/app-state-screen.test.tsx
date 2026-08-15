/** @vitest-environment jsdom */

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { vi } from "vitest";

import { AppStateScreen } from "@/components/shell/app-state-screen";

describe("AppStateScreen", () => {
  it("uses a route-neutral loading state", () => {
    render(<AppStateScreen state="loading" />);

    expect(screen.getByRole("status", { name: "正在载入 Yoyoo" })).toBeInTheDocument();
    expect(screen.queryByText(/晚上好|早上好|下午好/)).not.toBeInTheDocument();
  });

  it("keeps route errors visible and retryable without impersonating the homepage", async () => {
    const retry = vi.fn();
    const user = userEvent.setup();
    render(<AppStateScreen onRetry={retry} state="error" />);

    expect(screen.getByRole("alert")).toHaveTextContent("当前页面暂时无法载入");
    await user.click(screen.getByRole("button", { name: "重新载入" }));
    expect(retry).toHaveBeenCalledOnce();
  });
});
