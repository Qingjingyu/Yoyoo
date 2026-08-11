"use client";

import { Monitor, Moon, Sun } from "lucide-react";

import { useTheme } from "@/components/theme/theme-provider";
import type { ThemePreference } from "@/theme/theme";

const OPTIONS: Array<{
  value: ThemePreference;
  label: string;
  icon: typeof Monitor;
}> = [
  { value: "system", label: "跟随系统", icon: Monitor },
  { value: "light", label: "浅色", icon: Sun },
  { value: "dark", label: "深色", icon: Moon },
];

export function ThemeSelector() {
  const { preference, setPreference } = useTheme();

  return (
    <div aria-label="界面主题" className="theme-selector" role="group">
      {OPTIONS.map(({ value, label, icon: Icon }) => (
        <button
          aria-pressed={preference === value}
          key={value}
          onClick={() => setPreference(value)}
          type="button"
        >
          <Icon aria-hidden="true" size={14} strokeWidth={1.7} />
          {label}
        </button>
      ))}
    </div>
  );
}
