import { render, screen } from "@testing-library/react";
import { vi } from "vitest";

import { HomeExperience } from "@/components/home/home-experience";
import { YoyooOrb } from "@/components/orb/yoyoo-orb";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

describe("HomeExperience", () => {
  it("maps digital-life states to accessible status text", () => {
    const { rerender } = render(<YoyooOrb state="thinking" />);
    expect(screen.getByLabelText("Yoyoo 数字生命，正在思考")).toBeInTheDocument();

    rerender(<YoyooOrb state="speaking" />);
    expect(screen.getByLabelText("Yoyoo 数字生命，正在说话")).toBeInTheDocument();
  });

  it("shows homepage loading without replacing the product shell", () => {
    render(<HomeExperience state="loading" />);

    expect(screen.getByLabelText("正在加载 Yoyoo 首页")).toBeInTheDocument();
    expect(screen.getByRole("navigation", { name: "主导航" })).toBeInTheDocument();
  });

  it("shows a retryable homepage error without pretending another route failed", () => {
    render(<HomeExperience state="error" onRetry={() => undefined} />);

    expect(screen.getByText("首页暂时无法载入")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "重新载入" })).toBeInTheDocument();
  });
});
