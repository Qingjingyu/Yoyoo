import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { OrbPreview } from "@/components/orb/orb-preview";

describe("OrbPreview", () => {
  it("previews the Yoyoo fluid orb across the existing presence states", async () => {
    const user = userEvent.setup();
    render(<OrbPreview />);

    const orb = screen.getByRole("img", { name: "Yoyoo 数字生命，待机中" });
    expect(orb).toHaveAttribute("data-visual", "fluid-orb");
    expect(orb).toHaveAttribute("data-palette", "cyber-spectrum");
    expect(orb).toHaveAttribute("data-state", "idle");

    await user.click(screen.getByRole("button", { name: "预览正在聆听" }));
    expect(orb).toHaveAttribute("data-state", "listening");
    expect(orb).toHaveAccessibleName("Yoyoo 数字生命，正在聆听");

    await user.click(screen.getByRole("button", { name: "预览正在思考" }));
    expect(orb).toHaveAttribute("data-state", "thinking");

    await user.click(screen.getByRole("button", { name: "预览正在说话" }));
    expect(orb).toHaveAttribute("data-state", "speaking");

    await user.click(screen.getByRole("button", { name: "预览麦克风已静音" }));
    expect(orb).toHaveAttribute("data-state", "muted");
  });
});
