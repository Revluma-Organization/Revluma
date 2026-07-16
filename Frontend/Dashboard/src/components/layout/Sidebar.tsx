import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
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

      <motion.aside
        data-tour="sidebar"
        initial={{ x: -24, opacity: 0 }}
        animate={{ x: 0, opacity: 1 }}
        transition={{ type: 'spring', stiffness: 260, damping: 30 }}
        className={cn(
          'glass-sidebar fixed inset-y-0 left-0 z-50 flex flex-col transition-[width,transform] duration-300 ease-out md:relative md:translate-x-0',
          sidebarCollapsed ? 'md:w-[var(--sidebar-w-collapsed)]' : 'md:w-[var(--sidebar-w)]',
          'w-[var(--sidebar-w)]',
          mobileSidebarOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0',
        )}
      >
        {/* Logo + controls */}
        <div className={cn(
          'relative z-[1] flex shrink-0 items-center justify-between px-4 pb-3.5 pt-4',
          sidebarCollapsed && 'md:flex-col md:px-2 md:gap-4 md:items-center'
        )}>
          <div className="flex items-center gap-2.5">
            <motion.img
              src={revlumaIcon}
              alt="Revluma"
              whileHover={{ scale: 1.08, rotate: -4 }}
              transition={{ type: 'spring', stiffness: 400, damping: 15 }}
              className="h-8 w-8 shrink-0 object-contain md:h-10 md:w-10"
            />
            {!sidebarCollapsed && <span className="display text-[1.18rem] font-extrabold text-t1">Revluma</span>}
          </div>

          <div className={cn('flex items-center gap-1', sidebarCollapsed && 'md:hidden')}>
            <button
              onClick={toggleTheme}
              className="relative h-[22px] w-[42px] rounded-full border border-border-md bg-bg-4 transition-colors"
              aria-label="Toggle theme"
            >
              <motion.span
                layout
                transition={{ type: 'spring', stiffness: 500, damping: 32 }}
                className={cn(
                  'absolute top-[2px] flex h-[16px] w-[16px] items-center justify-center rounded-full',
                  'left-[2px]',
                  theme === 'light' && 'translate-x-[20px]',
                )}
                style={{ background: 'hsl(var(--t1))' }}
              >
                {theme === 'dark'
                  ? <Moon className="h-2 w-2" style={{ color: 'hsl(var(--sidebar-bg))' }} />
                  : <Sun className="h-2 w-2" style={{ color: 'hsl(var(--sidebar-bg))' }} />}
              </motion.span>
            </button>
            <motion.button
              whileHover={{ scale: 1.06 }}
              whileTap={{ scale: 0.92 }}
              onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
              className="hidden h-[26px] w-[26px] items-center justify-center rounded-md border border-border bg-bg-3 text-t2 transition-colors hover:bg-glass/[0.065] md:flex"
              aria-label="Collapse sidebar"
            >
              <ChevronLeft className="h-3 w-3" />
            </motion.button>
            <button
              onClick={() => setMobileSidebarOpen(false)}
              className="flex h-[26px] w-[26px] items-center justify-center rounded-md border border-border bg-bg-3 text-t2 md:hidden"
              aria-label="Close sidebar"
            >
              <X className="h-3 w-3" />
            </button>
          </div>

          {sidebarCollapsed && (
            <motion.button
              whileHover={{ scale: 1.06 }}
              whileTap={{ scale: 0.92 }}
              onClick={() => setSidebarCollapsed(false)}
              className="hidden h-[26px] w-[26px] items-center justify-center rounded-md border border-border bg-bg-3 text-t2 transition-colors hover:bg-glass/[0.065] md:flex"
              aria-label="Expand sidebar"
            >
              <ChevronRight className="h-3 w-3" />
            </motion.button>
          )}
        </div>

        {/* Nav */}
        <nav className="relative z-[1] flex-1 overflow-y-auto px-2.5 pt-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {Object.entries(groups).map(([group, items], groupIdx) => (
            <div key={group}>
              {!sidebarCollapsed && (
                <div className="mb-1 mt-3.5 px-2 text-[0.62rem] font-bold uppercase tracking-[0.11em] text-t4 first:mt-1">
                  {group}
                </div>
              )}
              {items.map((item, itemIdx) => {
                const Icon = item.icon;
                return (
                  <motion.div
                    key={item.to}
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{
                      delay: 0.03 * (groupIdx * 4 + itemIdx),
                      type: 'spring',
                      stiffness: 320,
                      damping: 28,
                    }}
                  >
                    <NavLink
                      to={item.to}
                      end={item.to === '/'}
                      className="group relative my-px flex items-center gap-2.5 rounded-lg px-2.5 py-2"
                    >
                      {({ isActive }) => (
                        <motion.div
                          whileHover={!isActive ? { x: 2 } : undefined}
                          whileTap={{ scale: 0.98 }}
                          className={cn(
                            'glass-row relative flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2',
                            sidebarCollapsed && 'md:justify-center md:px-2.5 md:py-2.5',
                          )}
                        >
                          {isActive && (
                            <motion.span
                              layoutId="sidebar-active-pill"
                              transition={{ type: 'spring', stiffness: 480, damping: 38 }}
                              className="glass-pill-active absolute inset-0 rounded-lg"
                            >
                              <span className="nav-active-rail absolute inset-y-1.5 left-0 w-[3px] rounded-full" />
                            </motion.span>
                          )}

                          <span
                            className={cn(
                              'relative z-[1] flex shrink-0 items-center justify-center rounded-lg',
                              sidebarCollapsed ? 'md:h-[38px] md:w-[38px] h-[30px] w-[30px]' : 'h-[30px] w-[30px]',
                            )}
                          >
                            <Icon
                              className={cn('h-4 w-4 transition-colors', isActive ? 'nav-blue-icon' : 'text-t3')}
                              strokeWidth={1.8}
                            />
                          </span>
                          {!sidebarCollapsed && (
                            <>
                              <span className={cn('relative z-[1] flex-1 truncate text-[0.82rem] transition-colors', isActive ? 'nav-blue-text font-semibold' : 'font-normal text-t2')}>
                                {item.label}
                              </span>
                              {item.badge && <span className="relative z-[1]"><NavBadge tone={item.badge.tone} text={item.badge.text} /></span>}
                            </>
                          )}
                        </motion.div>
                      )}
                    </NavLink>
                  </motion.div>
                );
              })}
            </div>
          ))}
        </nav>

        {/* Upgrade banner */}
        {!sidebarCollapsed && (
          <motion.div
            whileHover={{ y: -2 }}
            className="glass-card-soft relative z-[1] mx-2.5 mb-2.5 overflow-hidden rounded-xl p-3.5 text-center"
          >
            <div className="mb-2.5 flex justify-center">
              <Rocket className="h-9 w-9" style={{ color: 'hsl(var(--accent))' }} />
            </div>
            <div className="mb-1 text-[0.8rem] font-semibold text-t1">Unlock full automation</div>
            <div className="mb-3 text-[0.7rem] leading-[1.5] text-t3">Advanced recovery &amp; AI intelligence</div>
            <motion.button
              whileHover={{ scale: 1.015 }}
              whileTap={{ scale: 0.985 }}
              className="w-full rounded-md bg-t1 px-0 py-1.5 text-[0.75rem] font-bold text-bg transition-colors hover:opacity-90"
            >
              Upgrade to Pro →
            </motion.button>
          </motion.div>
        )}

        {/* User panel — real auth data */}
        <div className={cn('relative z-[1] shrink-0 border-t border-border p-2.5', sidebarCollapsed && 'md:flex md:justify-center')}>
          <AnimatePresence>
            {userOpen && !sidebarCollapsed && (
              <motion.div
                initial={{ opacity: 0, y: 8, scale: 0.98 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 8, scale: 0.98 }}
                transition={{ type: 'spring', stiffness: 420, damping: 32 }}
                className="glass-card-soft absolute bottom-[calc(100%+6px)] left-2.5 right-2.5 z-[200] overflow-hidden rounded-xl shadow-elegant"
              >
                <DDItem icon={Settings} label="Account Settings" onClick={() => { navigate('/dashboard/settings/profile'); setUserOpen(false); }} />
                <DDItem icon={CreditCard} label="Billing & Plans" onClick={() => { navigate('/dashboard/settings/billing'); setUserOpen(false); }} />
                <DDItem icon={UsersIcon} label="Team Members" onClick={() => { navigate('/dashboard/settings/team'); setUserOpen(false); }} />
                <DDItem icon={HelpCircle} label="Help & Support" onClick={() => { setUserOpen(false); }} />
                <div className="my-1 h-px bg-border" />
                <DDItem icon={LogOut} label="Log out" danger onClick={() => { void logout(); }} />
              </motion.div>
            )}
          </AnimatePresence>
          <motion.button
            whileHover={{ scale: 1.01 }}
            whileTap={{ scale: 0.98 }}
            onClick={() => setUserOpen((v) => !v)}
            className={cn(
              'glass-row flex w-full items-center gap-2.5 rounded-md p-2',
              sidebarCollapsed && 'md:w-[42px] md:justify-center md:rounded-full md:p-1.5',
            )}
          >
            <div
              className={cn(
                'flex shrink-0 items-center justify-center rounded-full text-[0.72rem] font-bold border border-border bg-black/5 dark:bg-white/5 text-t1',
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
                <motion.span animate={{ rotate: userOpen ? 180 : 0 }} transition={{ type: 'spring', stiffness: 400, damping: 26 }}>
                  <ChevronDown className="h-3 w-3 text-t3" />
                </motion.span>
              </>
            )}
          </motion.button>
        </div>
      </motion.aside>
    </>
  );
}

function NavBadge({ tone, text }: { tone: 'new' | 'beta' | 'count'; text: string }) {
  const styles =
    tone === 'new' ? { background: 'hsl(var(--nav-blue))', color: '#fff' }
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
    <motion.button
      whileHover={{ x: 2 }}
      onClick={onClick}
      type="button"
      className={cn(
        'flex w-full items-center gap-2.5 px-3.5 py-2.5 text-[0.8rem] font-medium text-t2 transition-colors hover:bg-glass/[0.065] hover:text-t1',
        danger && 'hover:!text-red'
      )}
    >
      <Icon className="h-3.5 w-3.5" />
      {label}
    </motion.button>
  );
}