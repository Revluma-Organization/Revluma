import { Bell, HelpCircle, Search, Menu, Compass } from 'lucide-react';
import { Link } from 'react-router-dom';
import revIntellLogo from '@/assets/images/rev-intell-logo.png';
import { useUI } from '@/store/ui';
import { api } from '@/lib/api';
import { useState, useEffect } from 'react';
import { cn } from '@/lib/utils';

export function Topbar({ section = 'Overview' }: { section?: string }) {
  const { setMobileSidebarOpen, setCmdOpen, setNotifOpen, notifOpen, startTour } = useUI();
  const [unreadCount, setUnreadCount] = useState<number | null>(null);

  useEffect(() => {
    api.get<{ data: { count: number } }>('/notifications/unread-count')
      .then((res) => setUnreadCount(res.data.data.count))
      .catch(() => setUnreadCount(null));
  }, []);

  const hasUnread = unreadCount !== null && unreadCount > 0;

  return (
    <header className="sticky top-0 z-40 flex h-[var(--topbar-h)] shrink-0 items-center justify-between border-b border-border bg-bg px-4 sm:px-6">
      
      {/* Left Side: Breadcrumbs & Mobile Menu */}
      <div className="flex items-center gap-3.5">
        <button
          onClick={() => setMobileSidebarOpen(true)}
          className="flex h-[34px] w-[34px] items-center justify-center rounded-md border border-border bg-glass/[0.035] md:hidden"
          aria-label="Open menu"
        >
          <Menu className="h-4 w-4 text-t1" />
        </button>
        <nav data-tour="topbar-breadcrumb" className="flex items-center gap-1.5" aria-label="Breadcrumb">
          <Link to="/dashboard/overview" className="text-[0.76rem] text-t3 hover:text-t1 transition-colors">Dashboard</Link>
          <span className="text-[0.76rem] text-t4">/</span>
          <span className="text-[0.76rem] font-medium text-t1">{section}</span>
        </nav>
      </div>

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
          className="flex h-[34px] items-center gap-2 rounded-lg border px-3 text-[0.76rem] font-semibold transition-all hover:opacity-90"
          style={{ background: 'rgba(88,101,242,0.1)', borderColor: 'rgba(88,101,242,0.25)', color: '#5865f2' }}
          title="Rev Intelligence"
        >
          <img src={revIntellLogo} alt="Rev" style={{ width: 16, height: 16, objectFit: 'contain', filter: 'drop-shadow(0 0 4px rgba(100,160,255,0.7))' }} />
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