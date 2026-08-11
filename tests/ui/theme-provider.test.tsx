/** @vitest-environment jsdom */

import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterEach, beforeEach, vi } from "vitest";

import {
  ThemeProvider,
  useTheme,
} from "@/components/theme/theme-provider";
import { ThemeScript } from "@/components/theme/theme-script";

type MediaListener = (event: MediaQueryListEvent) => void;

function installColorSchemeMatchMedia(initialDark: boolean) {
  let dark = initialDark;
  const listeners = new Set<MediaListener>();
  const mediaQuery = {
    media: "(prefers-color-scheme: dark)",
    get matches() {
      return dark;
    },
    onchange: null,
    addEventListener: vi.fn((_type: string, listener: MediaListener) => {
      listeners.add(listener);
    }),
    removeEventListener: vi.fn((_type: string, listener: MediaListener) => {
      listeners.delete(listener);
    }),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  } as unknown as MediaQueryList;

  vi.stubGlobal("matchMedia", vi.fn(() => mediaQuery));

  return {
    setDark(nextDark: boolean) {
      dark = nextDark;
      const event = {
        matches: nextDark,
        media: "(prefers-color-scheme: dark)",
      } as MediaQueryListEvent;
      listeners.forEach((listener) => listener(event));
    },
  };
}

function Probe() {
  const { preference, resolvedTheme, setPreference } = useTheme();
  return (
    <div>
      <output aria-label="主题状态">{`${preference}:${resolvedTheme}`}</output>
      <button type="button" onClick={() => setPreference("light")}>
        使用浅色
      </button>
    </div>
  );
}

function renderProvider(children: ReactNode) {
  return render(<ThemeProvider>{children}</ThemeProvider>);
}

beforeEach(() => {
  window.localStorage.clear();
  document.documentElement.removeAttribute("data-theme");
  document.documentElement.style.colorScheme = "";
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("ThemeProvider", () => {
  it("restores an explicit preference and persists a new choice", async () => {
    installColorSchemeMatchMedia(false);
    window.localStorage.setItem("yoyoo-theme", "dark");
    const user = userEvent.setup();

    renderProvider(<Probe />);

    expect(await screen.findByText("dark:dark")).toBeInTheDocument();
    expect(document.documentElement).toHaveAttribute("data-theme", "dark");

    await user.click(screen.getByRole("button", { name: "使用浅色" }));

    expect(await screen.findByText("light:light")).toBeInTheDocument();
    expect(window.localStorage.getItem("yoyoo-theme")).toBe("light");
    expect(document.documentElement).toHaveAttribute("data-theme", "light");
    expect(document.documentElement.style.colorScheme).toBe("light");
  });

  it("tracks live system changes only for the system preference", async () => {
    const colorScheme = installColorSchemeMatchMedia(false);
    window.localStorage.setItem("yoyoo-theme", "system");

    renderProvider(<Probe />);
    expect(await screen.findByText("system:light")).toBeInTheDocument();

    act(() => colorScheme.setDark(true));

    await waitFor(() => {
      expect(screen.getByText("system:dark")).toBeInTheDocument();
    });
    expect(document.documentElement).toHaveAttribute("data-theme", "dark");
  });

  it("keeps manual theme selection available without matchMedia", async () => {
    vi.stubGlobal("matchMedia", undefined);
    const user = userEvent.setup();

    renderProvider(<Probe />);

    expect(await screen.findByText("system:light")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "使用浅色" }));
    expect(await screen.findByText("light:light")).toBeInTheDocument();
  });

  it("renders a pre-hydration script with the shared storage contract", () => {
    const { container } = render(<ThemeScript />);
    const script = container.querySelector("script");

    expect(script?.textContent).toContain("yoyoo-theme");
    expect(script?.textContent).toContain("data-theme");
    expect(script?.textContent).toContain("prefers-color-scheme: dark");
  });
});
