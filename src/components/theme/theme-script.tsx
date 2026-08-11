import { THEME_STORAGE_KEY } from "@/theme/theme";

function createThemeScript() {
  return `(() => {
    const root = document.documentElement;
    let preference = "system";
    try {
      const stored = localStorage.getItem(${JSON.stringify(THEME_STORAGE_KEY)});
      if (stored === "light" || stored === "dark" || stored === "system") preference = stored;
    } catch {}
    const systemDark = matchMedia("(prefers-color-scheme: dark)").matches;
    const resolved = preference === "system" ? (systemDark ? "dark" : "light") : preference;
    root.setAttribute("data-theme", resolved);
    root.style.colorScheme = resolved;
  })();`;
}

export function ThemeScript() {
  return (
    <script
      dangerouslySetInnerHTML={{ __html: createThemeScript() }}
      suppressHydrationWarning
    />
  );
}
