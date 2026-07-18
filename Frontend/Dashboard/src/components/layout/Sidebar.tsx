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
  initial={{ x: -32, opacity: 0 }}
  animate={{ x: 0, opacity: 1 }}
  transition={{ type: 'spring', stiffness: 220, damping: 28 }}
  className={cn(
    'fixed inset-y-0 left-0 z-50 flex flex-col border-r transition-colors duration-300',
    // Theme-aware backgrounds: Light mode = White, Dark mode = Black
    theme === 'light' ? 'bg-white text-slate-900 border-slate-200' : 'bg-black text-white border-slate-800',
    sidebarCollapsed ? 'md:w-[var(--sidebar-w-collapsed)]' : 'w-[var(--sidebar-w)]',
    mobileSidebarOpen ? 'translate-x-0' : '-translate-x-full'
  )}
>
        {/* Ambient drifting orbs — makes the glass actually feel glassy */}
        <motion.div
          aria-hidden
          className="pointer-events-none absolute -left-16 -top-16 h-56 w-56 rounded-full blur-3xl opacity-40"
          style={{ background: 'radial-gradient(circle, hsl(var(--glass-surface-border) / 0.20), transparent 70%)' }}
          animate={{ x: [0, 40, 0], y: [0, 30, 0] }}
          transition={{ duration: 16, repeat: Infinity, ease: 'easeInOut' }}
        />
        <motion.div
          aria-hidden
          className="pointer-events-none absolute -bottom-24 -right-16 h-64 w-64 rounded-full blur-3xl opacity-30"
          style={{ background: 'radial-gradient(circle, hsl(var(--glass-surface-border) / 0.18), transparent 70%)' }}
          animate={{ x: [0, -30, 0], y: [0, -20, 0] }}
          transition={{ duration: 20, repeat: Infinity, ease: 'easeInOut' }}
        />

        {/* Logo + controls */}
        <div className={cn(
          'relative z-[1] flex shrink-0 items-center justify-between px-4 pb-3.5 pt-4',
          sidebarCollapsed && 'md:flex-col md:px-2 md:gap-4 md:items-center'
        )}>
          <div className="flex items-center gap-2.5">
            <motion.img
              src={revlumaIcon}
              alt="Revluma"
              whileHover={{ scale: 1.12, rotate: -6 }}
              transition={{ type: 'spring', stiffness: 400, damping: 14 }}
              className="h-8 w-8 shrink-0 object-contain md:h-10 md:w-10 drop-shadow-[0_2px_8px_rgba(0,0,0,0.3)]"
            />
            <AnimatePresence>
              {!sidebarCollapsed && (
                <motion.span
                  initial={{ opacity: 0, x: -8 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -8 }}
                  transition={{ duration: 0.2 }}
                  className="display text-[1.18rem] font-extrabold text-t1"
                >
                  Revluma
                </motion.span>
              )}
            </AnimatePresence>
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
              whileHover={{ scale: 1.08, rotate: -4 }}
              whileTap={{ scale: 0.9 }}
              onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
              className="hidden h-[26px] w-[26px] items-center justify-center rounded-md border border-border bg-bg-3 text-t2 transition-colors hover:bg-glass/[0.065] md:flex"
              aria-label="Collapse sidebar"
            >
              <ChevronLeft className="h-3 w-3" />
            </motion.button>
            <button
  onClick={(e) => {
    e.stopPropagation(); // Stops the event from hitting the overlay behind it
    setMobileSidebarOpen(false);
  }}
  className="relative z-[100] flex h-[26px] w-[26px] items-center justify-center cursor-pointer rounded-md hover:bg-slate-200/20 transition-colors"
  aria-label="Close sidebar"
>
  <X className="h-4 w-4" />
</button>
          </div>

          {sidebarCollapsed && (
            <motion.button
              whileHover={{ scale: 1.08, rotate: 4 }}
              whileTap={{ scale: 0.9 }}
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
                <motion.div
                  initial={{ opacity: 0, y: -4 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.05 + groupIdx * 0.04 }}
                  className="mb-1 mt-3.5 px-2 text-[0.62rem] font-bold uppercase tracking-[0.11em] text-t4 first:mt-1"
                >
                  {group}
                </motion.div>
              )}
              {items.map((item, itemIdx) => {
                const Icon = item.icon;
                return (
                  <motion.div
                    key={item.to}
                    initial={{ opacity: 0, x: -12 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{
                      delay: 0.04 * (groupIdx * 4 + itemIdx),
                      type: 'spring',
                      stiffness: 300,
                      damping: 26,
                    }}
                  >
                    <NavLink
                      to={item.to}
                      end={item.to === '/'}
                      className="group relative my-px flex items-center gap-2.5 rounded-lg px-2.5 py-2"
                    >
                      {({ isActive }) => (
                        <motion.div
                          whileHover={!isActive ? { x: 3 } : undefined}
                          whileTap={{ scale: 0.97 }}
                          className={cn(
                            'glass-row relative flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2',
                            sidebarCollapsed && 'md:justify-center md:px-2.5 md:py-2.5',
                          )}
                        >
                          {isActive && (
                         <motion.span
                     layoutId="sidebar-active-pill"
                      transition={{ type: 'spring', stiffness: 300, damping: 30 }}
                      className="absolute inset-0 rounded-md bg-[#007FFF]"
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
                            <motion.span
                              animate={isActive ? { rotate: [0, -10, 8, 0], scale: [1, 1.15, 1] } : { rotate: 0, scale: 1 }}
                              transition={{ duration: 0.55, ease: 'easeOut' }}
                              className="flex items-center justify-center"
                            >
                              <Icon
                                className={cn('h-4 w-4 transition-colors', isActive ? 'nav-blue-icon' : 'text-t3 group-hover:text-t1')}
                                strokeWidth={1.8}
                              />
                            </motion.span>
                          </span>
                          {!sidebarCollapsed && (
                            <>
                              <span className={cn('relative z-[1] flex-1 truncate text-[0.82rem] transition-colors', isActive ? 'nav-blue-text font-semibold' : 'font-normal text-t2 group-hover:text-t1')}>
                                {item.label}
                              </span>
                              {item.badge && <span className="relative z-[1]"><NavBadge tone={item.badge.tone} text={item.badge.text} isActive={isActive} /></span>}
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
<AnimatePresence>
  {!sidebarCollapsed && (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 12 }}
      transition={{ type: 'spring', stiffness: 260, damping: 24 }}
      className="relative z-[1] mx-2.5 mb-4 overflow-hidden rounded-xl bg-[#007FFF]/10 border border-[#007FFF]/20 p-4"
    >
      <motion.div
        className="mb-2.5 flex justify-center"
        animate={{ y: [0, -3, 0] }}
        transition={{ duration: 3, repeat: Infinity, ease: 'easeInOut' }}
      >
        <Rocket className="h-9 w-9 text-[#007FFF]" />
      </motion.div>
      <div className="mb-1 text-center text-[0.8rem] font-semibold text-white">Unlock full automation</div>
      <div className="mb-3 text-center text-[0.7rem] text-slate-400">Advanced recovery &amp; AI intelligence</div>
      <motion.button
        whileHover={{ scale: 1.02 }}
        whileTap={{ scale: 0.98 }}
        className="w-full rounded-md bg-[#007FFF] px-0 py-1.5 text-xs font-medium text-white transition hover:bg-[#007FFF]/90"
      >
        Upgrade to Pro →
      </motion.button>
    </motion.div>
  )}
</AnimatePresence>
        
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
            whileHover={{ scale: 1.015 }}
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
                  <div className="flex items-center gap-1.5 mt-0.5">
                    <div className="truncate text-[0.66rem] text-t3">{displayEmail}</div>
                    {user?.role && (
                      <span className={cn(
                        "shrink-0 whitespace-nowrap rounded px-1 py-px text-[0.55rem] font-bold uppercase tracking-wider border",
                        user.role === "owner"
                          ? "bg-amber-500/15 text-amber-400 border-amber-500/25"
                          : user.role === "admin"
                            ? "bg-blue-500/15 text-blue-400 border-blue-500/25"
                            : "bg-slate-500/15 text-slate-400 border-slate-500/25",
                      )}>
                        {user.role}
                      </span>
                    )}
                  </div>
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

function NavBadge({ tone, text, isActive }: { tone: 'new' | 'beta' | 'count'; text: string; isActive?: boolean }) {
  // When the row is active (inverse glass), flip badge to match inverse theme
  if (isActive) {
    return (
      <span
        className="shrink-0 whitespace-nowrap rounded-full px-1.5 py-px text-[0.58rem] font-bold uppercase tracking-[0.04em]"
        style={{
          background: 'hsl(var(--nav-active-fg) / 0.15)',
          color: 'hsl(var(--nav-active-fg))',
          border: '1px solid hsl(var(--nav-active-fg) / 0.25)',
        }}
      >
        {text}
      </span>
    );
  }
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
      whileHover={{ x: 3 }}
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
