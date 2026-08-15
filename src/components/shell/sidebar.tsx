import {
  Home,
  MessageCircle,
  Settings,
  Sparkles,
} from "lucide-react";
import Link from "next/link";

const primaryItems = [
  { href: "/", label: "首页", icon: Home, id: "home" },
  { href: "/conversation", label: "对话", icon: MessageCircle, id: "conversation" },
];

export function Sidebar({
  activeItem = "home",
}: {
  activeItem?: "home" | "conversation" | "settings" | "none";
}) {
  return (
    <aside className="sidebar" aria-label="Yoyoo 导航">
      <Link className="sidebar__brand" href="/" aria-label="Yoyoo Space">
        <Sparkles aria-hidden="true" size={18} strokeWidth={1.6} />
      </Link>

      <nav className="sidebar__nav" aria-label="主导航">
        {primaryItems.map(({ href, label, icon: Icon, id }) => (
          <Link
            className="sidebar__link"
            data-active={id === activeItem || undefined}
            href={href}
            key={label}
            title={label}
            aria-current={id === activeItem ? "page" : undefined}
          >
            <Icon aria-hidden="true" size={19} strokeWidth={1.6} />
            <span className="sidebar__label">{label}</span>
          </Link>
        ))}
      </nav>

      <Link
        aria-current={activeItem === "settings" ? "page" : undefined}
        className="sidebar__link sidebar__settings"
        data-active={activeItem === "settings" || undefined}
        href="/settings/agents"
        title="设置"
      >
        <Settings aria-hidden="true" size={19} strokeWidth={1.6} />
        <span className="sidebar__label">设置</span>
      </Link>
    </aside>
  );
}
