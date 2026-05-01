import { Bell, HelpCircle, Calendar, Search, Menu, Sparkles, Compass, LogOut, UserCircle } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  Button,
  Avatar,
  AvatarFallback
} from "@/components/ui";
import { useUI } from "@/store/ui";
import { useAuth } from "@/context/AuthContext";
import { useState } from "react";
import { cn } from "@/lib/utils";
import { MOCK } from "@/data/mockOverview";

const RANGES = ["Today", "Last 7 days", "Last 30 days", "Last 90 days", "This year"] as const;

export function Topbar({ section = "Overview" }: { section?: string }) {
  const { setMobileSidebarOpen, setCmdOpen, setNotifOpen, notifOpen, setCopilotOpen, dateRange, setDateRange, startTour } = useUI();
  const { user, logout } = useAuth();
  const [dateOpen, setDateOpen] = useState(false);
  const unread = MOCK.notifications.filter((n) => n.unread).length;

  return (
    <header className="sticky top-0 z-40 flex h-[var(--topbar-h)] shrink-0 items-center justify-between border-b border-border bg-bg px-4 sm:px-6">
      <div className="flex items-center gap-3.5">
        <button
          onClick={() => setMobileSidebarOpen(true)}
          className="flex h-[34px] w-[34px] items-center justify-center rounded-md border border-border bg-white/[0.035] md:hidden"
          aria-label="Open menu"
        >
          <Menu className="h-4 w-4 text-t1" />
        </button>
        <nav data-tour="topbar-breadcrumb" className="flex items-center gap-1.5" aria-label="Breadcrumb">
          <span className="text-[0.76rem] text-t3">Dashboard</span>
          <span className="text-[0.76rem] text-t4">/</span>
          <span className="text-[0.76rem] font-medium text-t1">{section}</span>
        </nav>
      </div>

      <div className="flex items-center gap-2">
        {/* Date picker */}
        <div data-tour="topbar-date" className="relative">
          <button
            onClick={() => setDateOpen((v) => !v)}
            className="flex items-center gap-1.5 rounded-md border border-border bg-white/[0.045] px-2.5 py-1.5 text-[0.76rem] text-t1 transition-colors hover:border-border-md"
          >
            <Calendar className="h-3 w-3 text-t3" />
            <span className="hidden md:inline">{dateRange}</span>
            <svg viewBox="0 0 24 24" className={cn("h-2.5 w-2.5 stroke-t4 transition-transform", dateOpen && "rotate-180")} fill="none" strokeWidth={2} strokeLinecap="round">
              <polyline points="6 9 12 15 18 9" />
            </svg>
          </button>
          {dateOpen && (
            <>
              <div className="fixed inset-0 z-[150]" onClick={() => setDateOpen(false)} />
              <div className="absolute right-0 top-[calc(100%+6px)] z-[200] min-w-[160px] overflow-hidden rounded-xl border border-border-md bg-bg-notif shadow-elegant">
                {RANGES.map((r) => (
                  <button
                    key={r}
                    onClick={() => { setDateRange(r); setDateOpen(false); }}
                    className={cn(
                      "flex w-full items-center justify-between gap-3.5 whitespace-nowrap px-3.5 py-2.5 text-[0.79rem] text-t2 transition-colors hover:bg-white/[0.065] hover:text-t1",
                      r === dateRange && "font-semibold text-t1",
                    )}
                  >
                    {r}
                    {r === dateRange && <span className="text-[0.7rem] accent-text">✓</span>}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>

        {/* Search trigger (⌘K) */}
        <button
          data-tour="topbar-search"
          onClick={() => setCmdOpen(true)}
          className="hidden items-center gap-2 rounded-md border border-border bg-white/[0.045] px-2.5 py-1.5 text-[0.76rem] text-t3 transition-colors hover:border-border-md sm:flex"
        >
          <Search className="h-3 w-3" />
          <span>Search or jump to…</span>
          <kbd className="ml-2 rounded border border-border bg-bg-3 px-1.5 py-px text-[0.65rem] font-medium text-t2">⌘K</kbd>
        </button>

        {/* Copilot */}
        <button
          data-tour="topbar-copilot"
          onClick={() => setCopilotOpen(true)}
          className="flex h-[34px] items-center gap-1.5 rounded-md border px-2.5 text-[0.76rem] font-semibold transition-all hover:opacity-90"
          style={{ background: "hsl(var(--accent) / 0.12)", borderColor: "hsl(var(--accent) / 0.25)", color: "hsl(var(--accent))" }}
          title="AI Copilot"
        >
          <Sparkles className="h-3.5 w-3.5" />
          <span className="hidden lg:inline">Copilot</span>
        </button>

        {/* Product tour trigger */}
        <button
          data-tour="topbar-tour"
          onClick={startTour}
          className="hidden h-[34px] w-[34px] items-center justify-center rounded-md border border-border bg-white/[0.035] text-t1 transition-colors hover:border-border-md sm:flex"
          aria-label="Start product tour"
          title="Take a tour"
        >
          <Compass className="h-3.5 w-3.5" />
        </button>

        {/* Notifications */}
        <button
          data-tour="topbar-notif"
          onClick={() => setNotifOpen(!notifOpen)}
          className="relative flex h-[34px] w-[34px] items-center justify-center rounded-md border border-border bg-white/[0.035] text-t1 transition-colors hover:border-border-md"
          aria-label="Notifications"
        >
          <Bell className="h-3.5 w-3.5" />
          {unread > 0 && (
            <span
              className="absolute right-1 top-1 h-2 w-2 rounded-full ring-2 ring-bg"
              style={{ background: "hsl(var(--accent))" }}
            />
          )}
        </button>

        {/* Help */}
        <button className="hidden h-[34px] w-[34px] items-center justify-center rounded-md border border-border bg-white/[0.035] text-t1 transition-colors hover:border-border-md sm:flex" aria-label="Help">
          <HelpCircle className="h-3.5 w-3.5" />
        </button>

        {/* User Menu */}
        {user && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                className="relative h-[34px] w-[34px] rounded-full border border-border bg-white/[0.035] p-0 hover:bg-white/[0.065] hover:border-border-md"
                aria-label="User menu"
              >
                <Avatar className="h-[26px] w-[26px] border border-border">
                  <AvatarFallback className="text-[0.7rem] bg-primary/20 text-primary">
                    {user.full_name?.split(' ').map((n: string) => n[0]).join('').toUpperCase() || 'U'}
                  </AvatarFallback>
                </Avatar>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56" sideOffset={8}>
              <div className="flex items-center gap-3 px-2 py-2">
                <Avatar className="h-8 w-8 border border-border">
                  <AvatarFallback className="bg-primary/20 text-primary text-sm">
                    {user.full_name?.split(' ').map((n: string) => n[0]).join('').toUpperCase() || 'U'}
                  </AvatarFallback>
                </Avatar>
                <div className="flex flex-col gap-0.5">
                  <span className="text-sm font-medium text-t1">{user.full_name || 'User'}</span>
                  <span className="text-xs text-t3 truncate max-w-[140px]">{user.email || ''}</span>
                </div>
              </div>
              <DropdownMenuSeparator />
              <DropdownMenuItem asChild>
                <a href="/profile" className="flex items-center gap-2 cursor-pointer">
                  <UserCircle className="h-3.5 w-3.5" />
                  <span>Profile</span>
                </a>
              </DropdownMenuItem>
              <DropdownMenuItem asChild>
                <a href="/settings" className="flex items-center gap-2 cursor-pointer">
                  <span className="h-3.5 w-3.5 border-[1.5px] border-border rounded" />
                  <span>Settings</span>
                </a>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onSelect={logout}
                className="flex items-center gap-2 text-destructive focus:text-destructive cursor-pointer"
              >
                <LogOut className="h-3.5 w-3.5" />
                <span>Log out</span>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
    </header>
  );
}
