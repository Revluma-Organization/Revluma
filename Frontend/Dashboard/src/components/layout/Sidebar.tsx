import { useEffect, useRef, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import {
  ChevronDown, ChevronLeft, ChevronRight, CreditCard, HelpCircle, LogOut,
  Moon, Settings, Sun, Users as UsersIcon, X,
} from "lucide-react";
import { useUI } from "@/store/ui";
import { useThemeStore } from "@/store";
import { MVP_NAV, type NavItem } from "@/data/nav";
import { cn } from "@/lib/utils";
import { useAuth } from "@/context/AuthContext";
import revlumaIcon from "@/assets/brand/revluma-icon.png";
import { RevOrbVideo } from "@/components/rev/RevOrb";
import { isSettingsPath, rememberAppRoute } from "@/data/settingsNav";
import { side } from "./sidebarTokens";
import { SettingsNav } from "./SettingsNav";


function initials(name: string | null | undefined) {
  return name?.split(" ").filter(Boolean).map(part => part[0]).join("").slice(0, 2).toUpperCase() || "--";
}

/** `?section=` view owned by an overview deep-link nav item, if any. */
function overviewSectionOf(target: string): string | null {
  const query = target.split("?")[1];
  if (!query) return null;
  return new URLSearchParams(query).get("section");
}

// Sections owned by sidebar deep-link items, derived from nav so future
// overview views work without touching this component.
const OWNED_OVERVIEW_SECTIONS = new Set(
  MVP_NAV.map((item) => overviewSectionOf(item.to)).filter((section): section is string => section !== null),
);

/**
 * Search-aware active state. React Router matches NavLinks on pathname only,
 * which would light up Command Center + Priorities + Signals together (all
 * three share `/dashboard/overview`) and triple `aria-current`. Plain Links
 * with this manual match keep exactly one current page:
 * - a deep-link item is active on its exact `?section=`;
 * - `?finding=` deep-links land on the priority finding, so Priorities owns them;
 * - non-nav sections (briefing/activity/evidence/health) keep Command Center lit.
 */
function isNavItemActive(
  item: NavItem,
  pathname: string,
  overviewSection: string | null,
  findingDeepLink: boolean,
): boolean {
  const [itemPath] = item.to.split("?");
  const itemSection = overviewSectionOf(item.to);
  if (itemSection !== null) {
    if (pathname !== itemPath) return false;
    if (itemSection === "priority") return overviewSection === "priority" || findingDeepLink;
    return overviewSection === itemSection && !findingDeepLink;
  }
  if (itemPath === "/dashboard/overview") {
    return (
      pathname === itemPath &&
      !findingDeepLink &&
      (overviewSection === null || !OWNED_OVERVIEW_SECTIONS.has(overviewSection))
    );
  }
  return pathname === itemPath || pathname.startsWith(`${itemPath}/`);
}

export function Sidebar() {
  const { sidebarCollapsed: collapsedPreference, setSidebarCollapsed, mobileSidebarOpen, setMobileSidebarOpen } = useUI();
  const theme = useThemeStore(state => state.theme);
  const toggleTheme = useThemeStore(state => state.toggleTheme);
  const { user, logout } = useAuth();
  const { pathname, search } = useLocation();
  // Settings mode swaps the workspace links for the settings menu in this same
  // rail (one sidebar, never two). The rail is always expanded there: icon-only
  // settings links would be unreadable.
  const settingsMode = isSettingsPath(pathname);
  const sidebarCollapsed = collapsedPreference && !settingsMode;
  const overviewParams = pathname === "/dashboard/overview" ? new URLSearchParams(search) : null;
  const overviewSection = overviewParams?.get("section") ?? null;
  const findingDeepLink = overviewParams !== null && overviewParams.has("finding");
  const navigate = useNavigate();
  const [userOpen, setUserOpen] = useState(false);
  const asideRef = useRef<HTMLElement | null>(null);
  const userMenuRef = useRef<HTMLDivElement | null>(null);
  const isMobileDrawer = mobileSidebarOpen;

  useEffect(() => { setMobileSidebarOpen(false); setUserOpen(false); }, [pathname, setMobileSidebarOpen]);
  useEffect(() => { if (!settingsMode) rememberAppRoute(`${pathname}${search}`); }, [settingsMode, pathname, search]);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") { setMobileSidebarOpen(false); setUserOpen(false); }
    };
    const onResize = () => {
      if (window.innerWidth < 768) setSidebarCollapsed(false);
      else setMobileSidebarOpen(false);
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("resize", onResize);
    onResize();
    return () => { window.removeEventListener("keydown", onKey); window.removeEventListener("resize", onResize); };
  }, [setMobileSidebarOpen, setSidebarCollapsed]);

  useEffect(() => {
    if (!isMobileDrawer) return;
    const aside = asideRef.current;
    const previousFocus = document.activeElement as HTMLElement | null;
    const focusables = () => Array.from(aside?.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])') || []).filter(element => element.offsetParent !== null || element === document.activeElement);
    focusables()[0]?.focus();
    document.documentElement.classList.add("cc-drawer-open");
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Tab" || !aside) return;
      const list = focusables();
      if (!list.length) return;
      const first = list[0];
      const last = list[list.length - 1];
      const active = document.activeElement;
      if (event.shiftKey && (active === first || !aside.contains(active))) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && (active === last || !aside.contains(active))) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("keydown", onKeyDown, true);
      document.documentElement.classList.remove("cc-drawer-open");
      previousFocus?.focus();
    };
  }, [isMobileDrawer]);

  useEffect(() => {
    if (!userOpen) return;
    const onPointerDown = (event: MouseEvent) => {
      if (userMenuRef.current && !userMenuRef.current.contains(event.target as Node)) setUserOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [userOpen]);

  const groups = MVP_NAV.reduce<Record<string, typeof MVP_NAV>>((result, item) => {
    (result[item.group] ||= []).push(item);
    return result;
  }, {});
  const displayName = user?.full_name || "Account";
  const displayEmail = user?.email || "No email available";

  return <>
    <div
      aria-hidden
      className={cn("fixed inset-0 z-40 bg-black/50 backdrop-blur-[3px] md:hidden", mobileSidebarOpen ? "block" : "hidden")}
      onClick={() => setMobileSidebarOpen(false)}
    />
    <aside
      ref={asideRef}
      id="sidebar-drawer"
      data-tour="sidebar"
      role={isMobileDrawer ? "dialog" : undefined}
      aria-modal={isMobileDrawer ? true : undefined}
      aria-label={isMobileDrawer ? "Navigation" : "Primary navigation"}
      className={cn(
        "fixed inset-y-0 left-0 z-50 flex shrink-0 flex-col overflow-hidden border-r transition-[width,transform] duration-200 motion-reduce:transition-none md:relative md:translate-x-0",
        side.surface,
        sidebarCollapsed ? "md:w-[var(--sidebar-w-collapsed)]" : "md:w-[var(--sidebar-w)]",
        "w-[min(84vw,280px)]",
        mobileSidebarOpen ? "translate-x-0 max-md:visible" : "-translate-x-full max-md:invisible",
      )}
    >
      {/* Brand: the Revluma mark and wordmark sit directly on the sidebar
          canvas, with no pill behind them. Collapsed, only the mark remains. */}
      <div className={cn("flex h-[72px] shrink-0 items-center justify-between gap-2 px-4", sidebarCollapsed && "md:justify-center md:px-2")}>
        <div className="flex min-w-0 items-center gap-2.5">
          <img src={revlumaIcon} alt="" className="h-7 w-7 shrink-0 object-contain" />
          <span className={cn("truncate text-[17px] font-bold tracking-[-0.02em]", side.text, sidebarCollapsed && "md:hidden")}>Revluma</span>
        </div>
        <button
          type="button"
          onClick={() => setMobileSidebarOpen(false)}
          className={cn(side.iconButton, "h-10 w-10 md:hidden", side.focus)}
          aria-label="Close sidebar"
        ><X className="h-[18px] w-[18px]" /></button>
        <button
          type="button"
          onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
          className={cn(side.iconButton, "hidden h-8 w-8 md:flex", (sidebarCollapsed || settingsMode) && "md:hidden", side.focus)}
          aria-label="Collapse sidebar"
        ><ChevronLeft className="h-4 w-4" /></button>
      </div>

      {settingsMode ? <SettingsNav key="settings" pathname={pathname} role={user?.role} onNavigate={() => setMobileSidebarOpen(false)} /> : <nav className={cn("flex-1 overflow-y-auto px-3 pb-4 pt-2", sidebarCollapsed && "md:px-2")} aria-label="Workspace">
        {Object.entries(groups).map(([group, items]) => <div key={group} className="rv-side-rise">
          {!sidebarCollapsed && <p className={cn("mb-2 px-3.5 text-[11px] font-semibold uppercase tracking-[0.14em]", side.faint)}>{group}</p>}
          <ul className="space-y-1">{items.map(item => {
            const Icon = item.icon;
            const active = isNavItemActive(item, pathname, overviewSection, findingDeepLink);
            return <li key={item.to}><Link
              to={item.to}
              title={sidebarCollapsed ? item.label : undefined}
              aria-current={active ? "page" : undefined}
              onClick={() => setMobileSidebarOpen(false)}
              className={cn(
                "group flex min-h-11 items-center gap-3 rounded-full px-3.5 text-[14px] font-medium tracking-[-0.005em] transition-[background-color,color,box-shadow] duration-200 motion-reduce:transition-none",
                side.focus,
                sidebarCollapsed && "md:justify-center md:px-0",
                active ? side.active : side.item,
              )}
            >
              {item.useCustomIcon
                ? (
                  // The orb video blends with "screen", so it sits on its own
                  // ink disc to stay visible on light canvases and the blue pill.
                  <span aria-hidden="true" className="grid h-[22px] w-[22px] shrink-0 place-items-center overflow-hidden rounded-full bg-black">
                    <RevOrbVideo size={22} className="shrink-0" />
                  </span>
                )
                : <Icon aria-hidden="true" className={cn("h-[18px] w-[18px] shrink-0", active ? "text-current" : side.icon)} strokeWidth={1.8} />}
              {!sidebarCollapsed && <><span className="min-w-0 flex-1 truncate">{item.label}</span>{item.badge && <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.06em]", active ? side.badgeActive : side.badge)}>{item.badge.text}</span>}</>}
            </Link></li>;
          })}</ul>
        </div>)}
      </nav>}

      <div className={cn("shrink-0 p-3", sidebarCollapsed && "md:px-2")}>
        {sidebarCollapsed && <button
          type="button"
          onClick={() => setSidebarCollapsed(false)}
          className={cn(side.iconButton, "mx-auto mb-2 hidden h-9 w-9 md:flex", side.focus)}
          aria-label="Expand sidebar"
        ><ChevronRight className="h-4 w-4" /></button>}
        <div className={cn("relative rounded-[20px] border p-1.5", side.card, sidebarCollapsed && "md:border-transparent md:bg-transparent md:p-0 md:shadow-none")} ref={userMenuRef}>
          {userOpen && !sidebarCollapsed && <div id="sidebar-user-menu" role="menu" className={cn("rv-side-pop absolute bottom-[calc(100%+8px)] left-0 right-0 z-20 overflow-hidden rounded-[18px] border p-1.5", side.pop)}>
            <AccountAction icon={Settings} label="Account settings" onClick={() => navigate("/dashboard/settings/profile")} />
            <AccountAction icon={CreditCard} label="Billing & plans" onClick={() => navigate("/dashboard/settings/billing")} />
            <AccountAction icon={UsersIcon} label="Team members" onClick={() => navigate("/dashboard/settings/team")} />
            <AccountAction icon={HelpCircle} label="Help & support" onClick={() => setUserOpen(false)} />
            <div className={cn("mx-2 my-1 border-t", side.divider)} />
            <AccountAction icon={LogOut} label="Log out" onClick={() => void logout()} />
          </div>}
          <button
            type="button"
            aria-label="Open account menu"
            aria-haspopup="menu"
            aria-controls="sidebar-user-menu"
            aria-expanded={userOpen}
            onClick={() => setUserOpen(open => !open)}
            className={cn("flex min-h-12 w-full items-center gap-3 rounded-[14px] p-1.5 text-left transition-colors duration-200", side.rowHover, side.focus, sidebarCollapsed && "md:justify-center")}
          >
            <span className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-full bg-[#2B13CF] text-[11px] font-semibold text-white">
              {user?.profile_picture_url ? <img src={user.profile_picture_url} alt="" className="h-full w-full object-cover" /> : initials(user?.full_name)}
            </span>
            {!sidebarCollapsed && <><span className="min-w-0 flex-1"><span className={cn("block truncate text-[13px] font-semibold", side.text)}>{displayName}</span><span className={cn("mt-0.5 block truncate text-[11.5px]", side.muted)}>{displayEmail}</span></span><ChevronDown className={cn("h-4 w-4 shrink-0 transition-transform duration-200 motion-reduce:transition-none", side.muted, userOpen && "rotate-180")} /></>}
          </button>
          {!sidebarCollapsed && <button type="button" role="switch" aria-checked={theme === "dark"} onClick={toggleTheme}
            className={cn("mt-1 flex min-h-10 w-full items-center gap-2.5 rounded-[14px] px-2.5 text-[12.5px] font-medium transition-colors duration-200", side.muted, side.rowHover, side.focus)}
            aria-label={`Use ${theme === "light" ? "dark" : "light"} workspace theme`}>
            {theme === "light" ? <Moon className="h-4 w-4" aria-hidden="true" /> : <Sun className="h-4 w-4" aria-hidden="true" />}
            <span className="flex-1 text-left">Dark mode</span>
            <span aria-hidden="true" className={cn("relative h-5 w-9 shrink-0 rounded-full transition-colors duration-200", theme === "dark" ? "bg-[#2B13CF]" : "bg-[#D6D3CC]")}>
              <span className={cn("absolute top-0.5 h-4 w-4 rounded-full bg-white shadow-sm transition-[left] duration-200 motion-reduce:transition-none", theme === "dark" ? "left-[18px]" : "left-0.5")} />
            </span>
          </button>}
        </div>
      </div>
    </aside>
  </>;
}

function AccountAction({ icon: Icon, label, onClick }: { icon: React.ElementType; label: string; onClick: () => void }) {
  return <button type="button" role="menuitem" onClick={onClick} className={cn("flex min-h-10 w-full items-center gap-2.5 rounded-xl px-2.5 text-left text-[13px] font-medium transition-colors duration-150", side.text, side.rowHover, side.focus)}><Icon className={cn("h-4 w-4", side.muted)} aria-hidden="true" />{label}</button>;
}
