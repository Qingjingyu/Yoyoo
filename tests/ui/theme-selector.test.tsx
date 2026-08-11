/** @vitest-environment jsdom */

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { vi } from "vitest";

import { ThemeProvider } from "@/components/theme/theme-provider";
import { ThemeSelector } from "@/components/theme/theme-selector";

function installMatchMedia() {
  const mediaQuery = {
    matches: false,
    media: "(prefers-color-scheme: dark)",
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  } as unknown as MediaQueryList;
  vi.stubGlobal("matchMedia", vi.fn(() => mediaQuery));
}

describe("ThemeSelector", () => {
  it("exposes system, light, and dark as one labeled preference", async () => {
    installMatchMedia();
    window.localStorage.setItem("yoyoo-theme", "system");
    const user = userEvent.setup();

    render(
      <ThemeProvider>
        <ThemeSelector />
      </ThemeProvider>,
    );

    expect(screen.getByRole("group", { name: "界面主题" })).toBeInTheDocument();
    expect(await screen.findByRole("button", { name: "跟随系统", pressed: true }))
      .toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "浅色" }));

    expect(screen.getByRole("button", { name: "浅色", pressed: true }))
      .toBeInTheDocument();
    expect(window.localStorage.getItem("yoyoo-theme")).toBe("light");
  });
});
