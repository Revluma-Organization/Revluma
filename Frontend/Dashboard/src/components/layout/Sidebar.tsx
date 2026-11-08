import { useEffect, useState } from "react";
import { NavLink, useLocation, useNavigate } from "react-router-dom";
import {
  ChevronDown, ChevronLeft, ChevronRight, CreditCard, HelpCircle, LogOut,
  Moon, Settings, Sun, Users as UsersIcon, X,
} from "lucide-react";
import { useUI } from "@/store/ui";
import { useThemeStore } from "@/store";
import { MVP_NAV } from "@/data/nav";
import { cn } from "@/lib/utils";
import { useAuth } from "@/context/AuthContext";
import revlumaIcon from "@/assets/brand/revluma-icon.png";
import revIntellLogo from "@/assets/images/rev-intell-logo.png";
import { shell } from "@/components/command-center/tokens";

function initials(name: string | null | undefined) {
  return name?.split(" ").filter(Boolean).map(part => part[0]).join("").slice(0, 2).toUpperCase() || "--";
}

export function Sidebar() {
  const { sidebarCollapsed, setSidebarCollapsed, mobileSidebarOpen, setMobileSidebarOpen } = useUI();
  const theme = useThemeStore(state => state.theme);
  const toggleTheme = useThemeStore(state => state.toggleTheme);
  const { user, logout } = useAuth();
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const [userOpen, setUserOpen] = useState(false);

  useEffect(() => { setMobileSidebarOpen(false); setUserOpen(false); }, [pathname, setMobileSidebarOpen]);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") { setMobileSidebarOpen(false); setUserOpen(false); }
    };
    const onResize = () => { if (window.innerWidth < 768) setSidebarCollapsed(false); };
    window.addEventListener("keydown", onKey);
    window.addEventListener("resize", onResize);
    onResize();
    return () => { window.removeEventListener("keydown", onKey); window.removeEventListener("resize", onResize); };
  }, [setMobileSidebarOpen, setSidebarCollapsed]);

  const groups = MVP_NAV.reduce<Record<string, typeof MVP_NAV>>((result, item) => {
    (result[item.group] ||= []).push(item);
    return result;
  }, {});
  const displayName = user?.full_name || "Account";
  const displayEmail = user?.email || "No email available";

  return <>
    <button
      type="button"
      aria-label="Close navigation"
      tabIndex={mobileSidebarOpen ? 0 : -1}
      className={cn("fixed inset-0 z-40 bg-black/60 md:hidden", mobileSidebarOpen ? "block" : "hidden")}
      onClick={() => setMobileSidebarOpen(false)}
    />
    <aside
      data-tour="sidebar"
      aria-label="Primary navigation"
      className={cn(
        "fixed inset-y-0 left-0 z-50 flex shrink-0 flex-col overflow-hidden border-r transition-[width,transform] duration-200 motion-reduce:transition-none md:relative md:translate-x-0",
        shell.sidebar,
        sidebarCollapsed ? "md:w-[var(--sidebar-w-collapsed)]" : "md:w-[var(--sidebar-w)]",
        "w-[min(84vw,280px)]",
        mobileSidebarOpen ? "translate-x-0" : "-translate-x-full",
      )}
    >
      <div className={cn("flex h-16 shrink-0 items-center justify-between border-b border-[#292d36] px-4", sidebarCollapsed && "md:px-3")}>
        <div className="flex min-w-0 items-center gap-2.5">
          <img src={revlumaIcon} alt="" className="h-8 w-8 shrink-0 object-contain" />
          {!sidebarCollapsed && <span className="display truncate text-lg font-bold">Revluma</span>}
        </div>
        <button
          type="button"
          onClick={() => sidebarCollapsed ? setSidebarCollapsed(false) : window.innerWidth < 768 ? setMobileSidebarOpen(false) : setSidebarCollapsed(true)}
          className={cn("flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-[#c6ccd8] hover:bg-white/[0.07] hover:text-white md:h-9 md:w-9", shell.focus)}
          aria-label={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
        >{sidebarCollapsed ? <ChevronRight className="h-4 w-4" /> : window.innerWidth < 768 ? <X className="h-5 w-5" /> : <ChevronLeft className="h-4 w-4" />}</button>
      </div>

      <nav className="flex-1 overflow-y-auto px-3 py-4" aria-label="Workspace">
        {Object.entries(groups).map(([group, items]) => <div key={group}>
          {!sidebarCollapsed && <p className="mb-2 px-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-[#8992a3]">{group}</p>}
          <ul className="space-y-1">{items.map(item => {
            const Icon = item.icon;
            return <li key={item.to}><NavLink
              to={item.to}
              end={item.to === "/"}
              title={sidebarCollapsed ? item.label : undefined}
              onClick={() => setMobileSidebarOpen(false)}
              className={({ isActive }) => cn(
                "group flex min-h-11 items-center gap-3 rounded-lg px-3 text-sm text-[#c6ccd8] transition-colors",
                shell.sidebarHover, shell.focus,
                sidebarCollapsed && "md:justify-center md:px-2",
                isActive && shell.sidebarActive,
              )}
            >{({ isActive }) => <>
              {item.useCustomIcon
                ? <img src={revIntellLogo} alt="" className="h-6 w-6 shrink-0 object-contain" />
                : <Icon aria-hidden="true" className={cn("h-[18px] w-[18px] shrink-0", isActive ? "text-white" : "text-[#aeb5c2] group-hover:text-white")} strokeWidth={1.8} />}
              {!sidebarCollapsed && <><span className="min-w-0 flex-1 truncate">{item.label}</span>{item.badge && <span className={cn("rounded px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide", isActive ? "bg-white/15 text-white" : "bg-white/[0.08] text-[#c6ccd8]")}>{item.badge.text}</span>}</>}
            </>}</NavLink></li>;
          })}</ul>
        </div>)}
      </nav>

      <div className="shrink-0 border-t border-[#292d36] p-3">
        <div className="relative">
          {userOpen && !sidebarCollapsed && <div className="absolute bottom-[calc(100%+8px)] left-0 right-0 z-20 overflow-hidden rounded-lg border border-[#353a45] bg-[#1b1e24] py-1 shadow-xl">
            <AccountAction icon={Settings} label="Account settings" onClick={() => navigate("/dashboard/settings/profile")} />
            <AccountAction icon={CreditCard} label="Billing & plans" onClick={() => navigate("/dashboard/settings/billing")} />
            <AccountAction icon={UsersIcon} label="Team members" onClick={() => navigate("/dashboard/settings/team")} />
            <AccountAction icon={HelpCircle} label="Help & support" onClick={() => setUserOpen(false)} />
            <div className="my-1 border-t border-[#353a45]" />
            <AccountAction icon={LogOut} label="Log out" onClick={() => void logout()} />
          </div>}
          <button
            type="button"
            aria-label="Open account menu"
            aria-expanded={userOpen}
            onClick={() => setUserOpen(open => !open)}
            className={cn("flex min-h-12 w-full items-center gap-3 rounded-lg p-2 text-left hover:bg-white/[0.07]", shell.focus, sidebarCollapsed && "md:justify-center")}
          >
            <span className="flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-full bg-white/10 text-[11px] font-semibold text-white">
              {user?.profile_picture_url ? <img src={user.profile_picture_url} alt="" className="h-full w-full object-cover" /> : initials(user?.full_name)}
            </span>
            {!sidebarCollapsed && <><span className="min-w-0 flex-1"><span className="block truncate text-xs font-semibold text-white">{displayName}</span><span className="mt-0.5 block truncate text-[10px] text-[#aeb5c2]">{displayEmail}</span></span><ChevronDown className={cn("h-3.5 w-3.5 text-[#aeb5c2] transition-transform", userOpen && "rotate-180")} /></>}
          </button>
        </div>
        {!sidebarCollapsed && <button type="button" onClick={toggleTheme} className={cn("mt-1 flex min-h-10 w-full items-center gap-3 rounded-lg px-3 text-xs text-[#aeb5c2] hover:bg-white/[0.07] hover:text-white", shell.focus)} aria-label={`Use ${theme === "light" ? "dark" : "light"} workspace theme`}>
          {theme === "light" ? <Moon className="h-4 w-4" /> : <Sun className="h-4 w-4" />}Use {theme === "light" ? "dark" : "light"} workspace theme
        </button>}
      </div>
    </aside>
  </>;
}

function AccountAction({ icon: Icon, label, onClick }: { icon: React.ElementType; label: string; onClick: () => void }) {
  return <button type="button" onClick={onClick} className={cn("flex min-h-10 w-full items-center gap-2.5 px-3 text-left text-xs text-[#c6ccd8] hover:bg-white/[0.07] hover:text-white", shell.focus)}><Icon className="h-4 w-4" />{label}</button>;
}
