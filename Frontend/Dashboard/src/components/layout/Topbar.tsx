import { Bell, HelpCircle, Search, Menu, Compass } from 'lucide-react';
import { Link } from 'react-router-dom';
import { RevOrb } from '@/components/rev/RevOrb';
import { useUI } from '@/store/ui';
import { api } from '@/lib/api';
import { useState, useEffect } from 'react';
import { WorkspaceSelection } from '../WorkspaceSelection';
import { cn } from '@/lib/utils';
import { useThemeStore } from '@/store/themeStore';

export interface Crumb { label: string; to?: string }

export function Topbar({ section = 'Overview', crumbs, lightWorkspace = false }: { section?: string; crumbs?: Crumb[]; lightWorkspace?: boolean }) {
  // Default trail is Dashboard / <section>; Settings passes Settings / <page>.
  const trail: Crumb[] = crumbs ?? [{ label: 'Dashboard', to: '/dashboard/overview' }, { label: section }];
  const { mobileSidebarOpen, setMobileSidebarOpen, setCmdOpen, setNotifOpen, notifOpen, startTour } = useUI();
  const [unreadCount, setUnreadCount] = useState<number | null>(null);

  useEffect(() => {
    api.get<{ data: { count: number } }>('/notifications/unread-count')
      .then((res) => setUnreadCount(res.data.data.count))
      .catch(() => setUnreadCount(null));
  }, []);

  const hasUnread = unreadCount !== null && unreadCount > 0;
  // The light Command Center skin applies only in light mode; in dark mode the
  // bar uses the shared pure-black tokens like every other dashboard screen.
  const theme = useThemeStore((state) => state.theme);
  const lightSkin = lightWorkspace && theme !== 'dark';

  return (
    <header className={`sticky top-0 z-40 flex h-[var(--topbar-h)] shrink-0 items-center justify-between border-b px-4 sm:px-6 lg:px-8 ${lightSkin ? "border-[#E7E9EF] bg-white text-[#17191F] [&_.text-t1]:text-[#17191F] [&_.text-t2]:text-[#343844] [&_.text-t3]:text-[#707582] [&_.text-t4]:text-[#98A2B3] [&_.border-border]:border-[#E7E9EF] [&_.bg-bg-3]:bg-[#F4F5F8]" : "border-border bg-bg"}`}>
      
      {/* Left Side: Breadcrumbs & Mobile Menu */}
      <div className="flex items-center gap-3.5">
        <button
          onClick={() => setMobileSidebarOpen(!mobileSidebarOpen)}
          className="flex h-[34px] w-[34px] items-center justify-center rounded-md border border-border bg-glass/[0.035] md:hidden"
          aria-label={mobileSidebarOpen ? "Close navigation menu" : "Open navigation menu"}
          aria-expanded={mobileSidebarOpen}
          aria-controls="sidebar-drawer"
        >
          <Menu className="h-4 w-4 text-t1" />
        </button>
        <nav data-tour="topbar-breadcrumb" aria-label="Breadcrumb" className="min-w-0">
          <ol className="flex min-w-0 items-center gap-1.5">
            {trail.map((crumb, index) => {
              const last = index === trail.length - 1;
              return (
                <li key={`${crumb.label}-${index}`} className={cn('flex min-w-0 items-center gap-1.5', !last && index === 0 && trail.length > 2 && 'max-sm:hidden')}>
                  {index > 0 ? <span aria-hidden="true" className="text-[0.76rem] text-t4">/</span> : null}
                  {last || !crumb.to
                    ? <span aria-current={last ? 'page' : undefined} className={cn('truncate text-[0.76rem]', last ? 'font-medium text-t1' : 'text-t3')}>{crumb.label}</span>
                    : <Link to={crumb.to} className="truncate text-[0.76rem] text-t3 transition-colors hover:text-t1">{crumb.label}</Link>}
                </li>
              );
            })}
          </ol>
        </nav>
      </div>

      <WorkspaceSelection compact />
      {/* Right Side: Actions & Buttons */}
      <div className="flex items-center gap-2">
        
                {/* Search trigger */}
        <button
          data-tour="topbar-search"
          onClick={() => setCmdOpen(true)}
          className="hidden items-center gap-2 rounded-md border border-border bg-glass/[0.045] px-2.5 py-1.5 text-[0.76rem] text-t3 transition-colors hover:border-border-md sm:flex"
        >
          <Search className="h-3 w-3" />
          <span>Search or jump to…</span>
          <kbd className="ml-2 rounded border border-border bg-bg-3 px-1.5 py-px text-[0.65rem] font-medium text-t2">⌘K</kbd>
        </button>

        {/* Rev Intell */}
        <Link
          to="/dashboard/rev-intell"
          data-tour="topbar-rev"
          className="flex h-[34px] items-center gap-2 rounded-lg border px-3 text-[0.76rem] font-semibold transition-all hover:opacity-90"
          style={
            lightSkin
              ? { background: 'rgba(68,56,232,0.08)', borderColor: 'rgba(68,56,232,0.22)', color: '#4438E8' }
              : { background: 'rgba(88,101,242,0.1)', borderColor: 'rgba(88,101,242,0.25)', color: '#5865f2' }
          }
          title="Rev Intelligence"
        >
          <RevOrb size={18} alt="Rev" />
          <span className="hidden lg:inline">Rev Intell</span>
        </Link>

        {/* Product tour */}
        <button
          data-tour="topbar-tour"
          onClick={startTour}
          className="hidden h-[34px] w-[34px] items-center justify-center rounded-md border border-border bg-glass/[0.035] text-t1 transition-colors hover:border-border-md sm:flex"
          aria-label="Start product tour"
          title="Take a tour"
        >
          <Compass className="h-3.5 w-3.5" />
        </button>

        {/* Notifications */}
        <button
          data-tour="topbar-notif"
          onClick={() => setNotifOpen(!notifOpen)}
          className="relative flex h-[34px] w-[34px] items-center justify-center rounded-md border border-border bg-glass/[0.035] text-t1 transition-colors hover:border-border-md"
          aria-label="Notifications"
        >
          <Bell className="h-3.5 w-3.5" />
          {hasUnread && (
            <span
              className="absolute right-1 top-1 h-2 w-2 rounded-full ring-2 ring-bg"
              style={{ background: 'hsl(var(--accent))' }}
            />
          )}
        </button>

        {/* Help */}
        <button
          className="hidden h-[34px] w-[34px] items-center justify-center rounded-md border border-border bg-glass/[0.035] text-t1 transition-colors hover:border-border-md sm:flex"
          aria-label="Help"
        >
          <HelpCircle className="h-3.5 w-3.5" />
        </button>
        
      </div>
    </header>
  );
                }