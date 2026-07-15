import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import {
  ChevronLeft, ChevronRight, Sun, Moon, X, Rocket,
  ChevronDown, LogOut, Settings, CreditCard, Users as UsersIcon, HelpCircle,
} from 'lucide-react';
import { useUI } from '@/store/ui';
import { useThemeStore } from '@/store';
import { NAV } from '@/data/nav';
import { cn } from '@/lib/utils';
import { useAuth } from '@/context/AuthContext';
import { useEffect, useState } from 'react';
import revlumaIcon from '@/assets/brand/revluma-icon.png';

// Derive initials from a full name string
function getInitials(fullName: string | undefined | null): string {
  if (!fullName) return '--';
  return fullName
    .split(' ')
    .filter(Boolean)
    .map((p) => p[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
}

export function Sidebar() {
  const { sidebarCollapsed, setSidebarCollapsed, mobileSidebarOpen, setMobileSidebarOpen } = useUI();
  const theme = useThemeStore((s) => s.theme);
  const toggleTheme = useThemeStore((s) => s.toggleTheme);
  const { user, logout } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [userOpen, setUserOpen] = useState(false);

  useEffect(() => { setMobileSidebarOpen(false); }, [location.pathname, setMobileSidebarOpen]);

  const groups = NAV.reduce<Record<string, typeof NAV>>((acc, item) => {
    (acc[item.group] ||= []).push(item);
    return acc;
  }, {});

  const initials = getInitials(user?.full_name);
  const displayName = user?.full_name ?? '--';
  const displayEmail = user?.email ?? '--';

  return (
    <>
      <div
        className={cn(
          'fixed inset-0 z-40 bg-black/60 backdrop-blur-sm transition-opacity md:hidden',
          mobileSidebarOpen ? 'opacity-100' : 'pointer-events-none opacity-0',
        )}
        onClick={() => setMobileSidebarOpen(false)}
        aria-hidden
      />

      <aside
        data-tour="sidebar"
        className={cn(
          'fixed inset-y-0 left-0 z-50 flex flex-col border-r border-slate-200 dark:border-slate-800 bg-gray-50 dark:bg-slate-950 transition-[width,transform] duration-300 ease-out md:relative md:translate-x-0',
          sidebarCollapsed ? 'md:w-[var(--sidebar-w-collapsed)]' : 'md:w-[var(--sidebar-w)]',
          'w-[var(--sidebar-w)]',
          mobileSidebarOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0',
        )}
      >
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-br from-glass/[0.022] to-transparent" />

        {/* Logo + controls */}
        <div className={cn(
          'relative z-[1] flex shrink-0 items-center justify-between px-4 pb-3.5 pt-4', 
          sidebarCollapsed && 'md:flex-col md:px-2 md:gap-4 md:items-center'
        )}>
          <div className="flex items-center gap-2.5">
            <img
              src={revlumaIcon}
              alt="Revluma"
              className="h-8 w-8 shrink-0 object-contain md:h-10 md:w-10"
            />
            {!sidebarCollapsed && <span className="display text-[1.18rem] font-extrabold text-slate-900 dark:text-white">Revluma</span>}
          </div>
          
          <div className={cn('flex items-center gap-1', sidebarCollapsed && 'md:hidden')}>
            <button
              onClick={toggleTheme}
              className="relative h-[22px] w-[42px] rounded-full border border-border-md bg-bg-4 transition-colors"
              aria-label="Toggle theme"
            >
              <span
                className={cn(
                  'absolute top-[2px] flex h-[16px] w-[16px] items-center justify-center rounded-full transition-transform',
                  'left-[2px]',
                  theme === 'light' && 'translate-x-[20px]',
                )}
                style={{ background: 'hsl(var(--t1))' }}
              >
                {theme === 'dark'
                  ? <Moon className="h-2 w-2" style={{ color: 'hsl(var(--sidebar-bg))' }} />
                  : <Sun className="h-2 w-2" style={{ color: 'hsl(var(--sidebar-bg))' }} />}
              </span>
            </button>
            <button
              onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
              className="hidden h-[26px] w-[26px] items-center justify-center rounded-md border border-border bg-bg-3 text-t2 transition-colors hover:bg-glass/[0.065] md:flex"
              aria-label="Collapse sidebar"
            >
              <ChevronLeft className="h-3 w-3" />
            </button>
            <button
              onClick={() => setMobileSidebarOpen(false)}
              className="flex h-[26px] w-[26px] items-center justify-center rounded-md border border-border bg-bg-3 text-t2 md:hidden"
              aria-label="Close sidebar"
            >
              <X className="h-3 w-3" />
            </button>
          </div>

          {sidebarCollapsed && (
            <button
              onClick={() => setSidebarCollapsed(false)}
              className="hidden h-[26px] w-[26px] items-center justify-center rounded-md border border-border bg-bg-3 text-t2 transition-colors hover:bg-glass/[0.065] md:flex"
              aria-label="Expand sidebar"
            >
              <ChevronRight className="h-3 w-3" />
            </button>
          )}
        </div>

        {/* Nav */}
        <nav className="relative z-[1] flex-1 overflow-y-auto px-2.5 pt-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {Object.entries(groups).map(([group, items]) => (
            <div key={group}>
              {!sidebarCollapsed && (
                <div className="mb-1 mt-3.5 px-2 text-[0.62rem] font-bold uppercase tracking-[0.11em] text-t4 first:mt-1">
                  {group}
                </div>
              )}
              {items.map((item) => {
                const Icon = item.icon;
                return (
                  <NavLink
                    key={item.to}
                    to={item.to}
                    end={item.to === '/'}
                    className={({ isActive }) =>
                      cn(
                        'group relative my-px flex items-center gap-2.5 rounded-lg border border-transparent px-2.5 py-2 transition-all hover:bg-black/5 dark:hover:bg-white/5',
                        isActive && 'bg-black/5 dark:bg-white/5',
                        sidebarCollapsed && 'md:justify-center md:px-2.5 md:py-2.5',
                      )
                    }
                  >
                    {({ isActive }) => (
                      <>
                        <span
                          className={cn(
                            'flex shrink-0 items-center justify-center rounded-lg transition-colors',
                            sidebarCollapsed ? 'md:h-[38px] md:w-[38px] h-[30px] w-[30px]' : 'h-[30px] w-[30px]',
                          )}
                        >
                          <Icon className={cn('h-4 w-4', isActive ? 'text-slate-900 dark:text-white' : 'text-slate-500 dark:text-slate-400')} strokeWidth={1.8} />
                        </span>
                        {!sidebarCollapsed && (
                          <>
                            <span className={cn('flex-1 truncate text-[0.82rem] transition-colors', isActive ? 'font-medium text-slate-900 dark:text-white' : 'font-normal text-slate-500 dark:text-slate-400')}>
                              {item.label}
                            </span>
                            {item.badge && <NavBadge tone={item.badge.tone} text={item.badge.text} />}
                          </>
                        )}
                      </>
                    )}
                  </NavLink>
                );
              })}
            </div>
          ))}
        </nav>

        {/* Upgrade banner */}
        {!sidebarCollapsed && (
          <div
            className="relative z-[1] mx-2.5 mb-2.5 rounded-xl border p-3.5 text-center"
            style={{ background: 'hsl(var(--glass) / 0.03)', borderColor: 'hsl(var(--border-soft) / 0.10)' }}
          >
            <div className="mb-2.5 flex justify-center">
              <Rocket className="h-9 w-9" style={{ color: 'hsl(var(--accent))' }} />
            </div>
            <div className="mb-1 text-[0.8rem] font-semibold text-t1">Unlock full automation</div>
            <div className="mb-3 text-[0.7rem] leading-[1.5] text-t3">Advanced recovery &amp; AI intelligence</div>
            <button className="w-full rounded-md bg-t1 px-0 py-1.5 text-[0.75rem] font-bold text-bg transition-all hover:-translate-y-px hover:opacity-90">
              Upgrade to Pro →
            </button>
          </div>
        )}

        {/* User panel — real auth data */}
        <div className={cn('relative z-[1] shrink-0 border-t border-border p-2.5', sidebarCollapsed && 'md:flex md:justify-center')}>
          {userOpen && !sidebarCollapsed && (
            <div className="absolute bottom-[calc(100%+6px)] left-2.5 right-2.5 z-[200] overflow-hidden rounded-xl border border-border-md bg-bg-notif shadow-elegant">
              <DDItem icon={Settings} label="Account Settings" onClick={() => { navigate('/dashboard/settings/profile'); setUserOpen(false); }} />
              <DDItem icon={CreditCard} label="Billing & Plans" onClick={() => { navigate('/dashboard/settings/billing'); setUserOpen(false); }} />
              <DDItem icon={UsersIcon} label="Team Members" onClick={() => { navigate('/dashboard/settings/team'); setUserOpen(false); }} />
              <DDItem icon={HelpCircle} label="Help & Support" onClick={() => { setUserOpen(false); }} />
              <div className="my-1 h-px bg-border" />
              <DDItem icon={LogOut} label="Log out" danger onClick={() => { void logout(); }} />
            </div>
          )}
          <button
            onClick={() => setUserOpen((v) => !v)}
            className={cn(
              'flex w-full items-center gap-2.5 rounded-md p-2 transition-colors hover:bg-glass/[0.065]',
              sidebarCollapsed && 'md:w-[42px] md:justify-center md:rounded-full md:p-1.5',
            )}
          >
            <div
              className={cn(
                'flex shrink-0 items-center justify-center rounded-full text-[0.72rem] font-bold border border-slate-200 dark:border-slate-800 bg-black/5 dark:bg-white/5 text-slate-900 dark:text-white',
                sidebarCollapsed ? 'md:h-[34px] md:w-[34px] h-[30px] w-[30px]' : 'h-[30px] w-[30px]',
              )}
            >
              {initials}
            </div>
            {!sidebarCollapsed && (
              <>
                <div className="min-w-0 flex-1 text-left">
                  <div className="truncate text-[0.79rem] font-semibold text-t1">{displayName}</div>
                  <div className="truncate text-[0.66rem] text-t3">{displayEmail}</div>
                </div>
                <ChevronDown className={cn('h-3 w-3 text-t3 transition-transform', userOpen && 'rotate-180')} />
              </>
            )}
          </button>
        </div>
      </aside>
    </>
  );
}

function NavBadge({ tone, text }: { tone: 'new' | 'beta' | 'count'; text: string }) {
  const styles =
    tone === 'new' ? { background: 'hsl(var(--accent))', color: '#000' }
      : tone === 'beta' ? { background: 'hsl(var(--purple))', color: '#fff' }
        : { background: 'hsl(var(--t1))', color: 'hsl(var(--sidebar-bg))' };
  return (
    <span className="shrink-0 whitespace-nowrap rounded-full px-1.5 py-px text-[0.58rem] font-bold uppercase tracking-[0.04em]" style={styles}>
      {text}
    </span>
  );
}

function DDItem({ icon: Icon, label, danger, onClick }: { icon: React.ElementType; label: string; danger?: boolean; onClick?: () => void }) {
  return (
    <button
      onClick={onClick}
      type="button"
      className={cn(
        'flex w-full items-center gap-2.5 px-3.5 py-2.5 text-[0.8rem] font-medium text-t2 transition-colors hover:bg-glass/[0.065] hover:text-t1',
        danger && 'hover:!text-red'
      )}
    >
      <Icon className="h-3.5 w-3.5" />
      {label}
    </button>
  );
}