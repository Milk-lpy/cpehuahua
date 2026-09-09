import type { ColorTheme } from "../live/theme";

export function ThemeToggle({ theme, onChange }: {
  theme: ColorTheme;
  onChange: (theme: ColorTheme) => void;
}) {
  const next = theme === "dark" ? "light" : "dark";
  return (
    <button
      className="theme-toggle"
      type="button"
      aria-label={next === "light" ? "切换到白天模式" : "切换到夜间模式"}
      title={next === "light" ? "白天模式" : "夜间模式"}
      onClick={() => onChange(next)}
    >
      <svg viewBox="0 0 24 24" aria-hidden="true">
        {theme === "dark"
          ? <><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M19.1 4.9l-1.4 1.4M6.3 17.7l-1.4 1.4" /></>
          : <path d="M20 15.2A8 8 0 0 1 8.8 4 8.1 8.1 0 1 0 20 15.2Z" />}
      </svg>
    </button>
  );
}
