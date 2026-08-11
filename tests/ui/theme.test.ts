import {
  parseThemePreference,
  resolveTheme,
  THEME_STORAGE_KEY,
} from "@/theme/theme";

describe("theme preference", () => {
  it("accepts only the supported persisted preferences", () => {
    expect(parseThemePreference("light")).toBe("light");
    expect(parseThemePreference("dark")).toBe("dark");
    expect(parseThemePreference("system")).toBe("system");
    expect(parseThemePreference("sepia")).toBe("system");
    expect(parseThemePreference(null)).toBe("system");
    expect(THEME_STORAGE_KEY).toBe("yoyoo-theme");
  });

  it("resolves system preference without overriding explicit choices", () => {
    expect(resolveTheme("system", true)).toBe("dark");
    expect(resolveTheme("system", false)).toBe("light");
    expect(resolveTheme("light", true)).toBe("light");
    expect(resolveTheme("dark", false)).toBe("dark");
  });
});
