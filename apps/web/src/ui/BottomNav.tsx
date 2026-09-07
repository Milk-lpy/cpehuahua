export type AppView = "overview" | "control" | "cells" | "device" | "messages" | "probe";

interface IconProps { name: AppView }

function Icon({ name }: IconProps) {
  const common = { fill: "none", stroke: "currentColor", strokeLinecap: "round" as const, strokeLinejoin: "round" as const, strokeWidth: 1.8 };
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      {name === "overview" && <><path {...common} d="M4 11.5 12 5l8 6.5" /><path {...common} d="M6.5 10.5V20h11v-9.5M9.5 20v-5h5v5" /></>}
      {name === "control" && <><path {...common} d="M4 7h10M18 7h2M4 17h2M10 17h10" /><circle {...common} cx="16" cy="7" r="2" /><circle {...common} cx="8" cy="17" r="2" /></>}
      {name === "cells" && <><circle {...common} cx="12" cy="12" r="2.2" /><path {...common} d="M8.5 15.5a5 5 0 0 1 0-7M15.5 8.5a5 5 0 0 1 0 7M5.5 18.5a9.2 9.2 0 0 1 0-13M18.5 5.5a9.2 9.2 0 0 1 0 13" /></>}
      {name === "device" && <><rect {...common} x="6" y="3" width="12" height="18" rx="3" /><path {...common} d="M10 6h4M10.5 18h3" /></>}
      {name === "messages" && <><path {...common} d="M4 5.5h16v11H9l-5 3v-14Z" /><path {...common} d="M8 9h8M8 12.5h5" /></>}
      {name === "probe" && <><circle {...common} cx="12" cy="12" r="3" /><path {...common} d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9 7 7M17 17l2.1 2.1M19.1 4.9 17 7M7 17l-2.1 2.1" /></>}
    </svg>
  );
}

const ITEMS: ReadonlyArray<{ id: AppView; label: string }> = [
  { id: "overview", label: "概览" },
  { id: "control", label: "控制" },
  { id: "cells", label: "锁频" },
  { id: "device", label: "设备" },
  { id: "messages", label: "短信" },
  { id: "probe", label: "探针" },
];

export function BottomNav({ active, onNavigate }: { active: AppView; onNavigate: (view: AppView) => void }) {
  return (
    <nav className="bottom-nav" aria-label="主要功能">
      {ITEMS.map((item) => (
        <button
          key={item.id}
          type="button"
          className={active === item.id ? "bottom-nav__item is-active" : "bottom-nav__item"}
          aria-current={active === item.id ? "page" : undefined}
          onClick={() => onNavigate(item.id)}
        >
          <Icon name={item.id} />
          <span>{item.label}</span>
        </button>
      ))}
    </nav>
  );
}
