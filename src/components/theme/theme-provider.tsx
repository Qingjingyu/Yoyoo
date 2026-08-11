"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useSyncExternalStore,
  type ReactNode,
} from "react";

import {
  parseThemePreference,
  resolveTheme,
  THEME_STORAGE_KEY,
  type ResolvedTheme,
  type ThemePreference,
} from "@/theme/theme";

interface ThemeContextValue {
  preference: ThemePreference;
  resolvedTheme: ResolvedTheme;
  setPreference: (preference: ThemePreference) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

interface ThemeSnapshot {
  preference: ThemePreference;
  resolvedTheme: ResolvedTheme;
}

const SERVER_SNAPSHOT: ThemeSnapshot = {
  preference: "system",
  resolvedTheme: "light",
};

let snapshot = SERVER_SNAPSHOT;
let mediaQuery: MediaQueryList | null = null;
let systemChangeHandler: ((event: MediaQueryListEvent) => void) | null = null;
const listeners = new Set<() => void>();

function applyResolvedTheme(theme: ResolvedTheme) {
  const root = document.documentElement;
  root.setAttribute("data-theme", theme);
  root.style.colorScheme = theme;
}

function readStoredPreference(): ThemePreference {
  try {
    return parseThemePreference(window.localStorage.getItem(THEME_STORAGE_KEY));
  } catch {
    return "system";
  }
}

function updateSnapshot(preference: ThemePreference, systemPrefersDark: boolean) {
  const resolvedTheme = resolveTheme(preference, systemPrefersDark);
  if (
    snapshot.preference !== preference ||
    snapshot.resolvedTheme !== resolvedTheme
  ) {
    snapshot = { preference, resolvedTheme };
  }
  applyResolvedTheme(resolvedTheme);
  return snapshot;
}

function ensureMediaQuery() {
  if (!mediaQuery) {
    mediaQuery = typeof window.matchMedia === "function"
      ? window.matchMedia("(prefers-color-scheme: dark)")
      : {
          matches: false,
          media: "(prefers-color-scheme: dark)",
          onchange: null,
          addEventListener: () => undefined,
          removeEventListener: () => undefined,
          addListener: () => undefined,
          removeListener: () => undefined,
          dispatchEvent: () => false,
        };
  }
  return mediaQuery;
}

function getThemeSnapshot() {
  const query = ensureMediaQuery();
  return updateSnapshot(readStoredPreference(), query.matches);
}

function subscribeToTheme(listener: () => void) {
  const query = ensureMediaQuery();
  listeners.add(listener);

  if (listeners.size === 1) {
    systemChangeHandler = (event: MediaQueryListEvent) => {
      if (readStoredPreference() !== "system") return;
      updateSnapshot("system", event.matches);
      listeners.forEach((currentListener) => currentListener());
    };
    query.addEventListener("change", systemChangeHandler);
  }

  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && systemChangeHandler) {
      query.removeEventListener("change", systemChangeHandler);
      systemChangeHandler = null;
      mediaQuery = null;
    }
  };
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const { preference, resolvedTheme } = useSyncExternalStore(
    subscribeToTheme,
    getThemeSnapshot,
    () => SERVER_SNAPSHOT,
  );

  const setPreference = useCallback(
    (nextPreference: ThemePreference) => {
      try {
        window.localStorage.setItem(THEME_STORAGE_KEY, nextPreference);
      } catch {
        // The active theme still works when browser storage is unavailable.
      }
      updateSnapshot(nextPreference, ensureMediaQuery().matches);
      listeners.forEach((listener) => listener());
    },
    [],
  );

  const value = useMemo(
    () => ({ preference, resolvedTheme, setPreference }),
    [preference, resolvedTheme, setPreference],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error("useTheme must be used within ThemeProvider");
  }
  return context;
}
