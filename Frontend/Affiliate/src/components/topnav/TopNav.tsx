import { useState, useRef, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../hooks/useAuth';
import { useTheme } from '../../hooks/useTheme';
import { useSidebar } from '../../providers/SidebarProvider';
import AvatarUpload from '../common/AvatarUpload';

export default function TopNav() {
  const { user, logout } = useAuth();
  const { theme, toggle: toggleTheme } = useTheme();
  const { toggle: toggleSidebar } = useSidebar();
  const navigate = useNavigate();
  const [profileOpen, setProfileOpen] = useState(false);
  const [avatarUploadOpen, setAvatarUploadOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const avatarRef = useRef<HTMLButtonElement>(null);

  const handleClickOutside = useCallback((e: MouseEvent) => {
    if (
      panelRef.current &&
      !panelRef.current.contains(e.target as Node) &&
      avatarRef.current &&
      !avatarRef.current.contains(e.target as Node)
    ) {
      setProfileOpen(false);
    }
  }, []);

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.key === 'Escape') setProfileOpen(false);
  }, []);

  useEffect(() => {
    if (profileOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      document.addEventListener('keydown', handleKeyDown);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [profileOpen, handleClickOutside, handleKeyDown]);

  const handleLogout = () => {
    setProfileOpen(false);
    logout();
    navigate('/login');
  };

  return (
    <>
    <header
      style={{
        height: 'var(--topnav-height)',
        background: 'var(--color-bg-elevated)',
        borderBottom: '1px solid var(--color-border)',
        display: 'flex',
        alignItems: 'center',
        padding: '0 24px',
        gap: 16,
        position: 'sticky',
        top: 0,
        zIndex: 'var(--z-topnav)',
      }}
    >
      {/* Hamburger (mobile) */}
      <button onClick={toggleSidebar} className="sidebar-toggle" style={{
        display: 'none', width: 34, height: 34, borderRadius: 8, cursor: 'pointer',
        color: 'var(--color-text-secondary)', background: 'transparent', border: 'none',
        alignItems: 'center', justifyContent: 'center', flexShrink: 0, marginRight: 8,
      }}
        onMouseEnter={e => { e.currentTarget.style.background = 'var(--color-bg-hover)'; e.currentTarget.style.color = 'var(--color-text)'; }}
        onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--color-text-secondary)'; }}
      >
        <MenuIcon size={18} />
      </button>

      {/* Left: Search */}
      <div className="topnav-search" style={{ flex: '0 0 320px' }}>
        <button
          onClick={() => navigate('/dashboard/search')}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            width: '100%',
            padding: '8px 14px',
            borderRadius: 8,
            background: 'var(--color-bg-inset)',
            border: '1px solid var(--color-border)',
            color: 'var(--color-text-tertiary)',
            fontSize: 13,
            cursor: 'pointer',
            transition: 'all var(--transition-fast)',
          }}
          onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--color-border-hover)'; }}
          onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--color-border)'; }}
        >
          <SearchIcon size={15} />
          <span>Search partners, campaigns...</span>
          <span style={{
            marginLeft: 'auto',
            fontSize: 10,
            color: 'var(--color-text-tertiary)',
            background: 'var(--color-bg-active)',
            padding: '1px 6px',
            borderRadius: 4,
            fontFamily: 'var(--font-mono)',
          }}>
            ⌘K
          </span>
        </button>
      </div>

      {/* Center: Workspace Status + Environment */}
      <div className="topnav-center" style={{
        flex: 1,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 16,
      }}>
        <StatusPill label="All Systems" variant="success" />
        <EnvBadge />
      </div>

      {/* Right: Theme + Notifications + Profile */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        flexShrink: 0,
      }}>
        {/* Theme toggle */}
        <IconButton onClick={toggleTheme} title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}>
          {theme === 'dark' ? <SunIcon size={18} /> : <MoonIcon size={18} />}
        </IconButton>

        {/* Notifications */}
        <IconButton onClick={() => navigate('/dashboard/notifications')} title="Notifications">
          <BellIcon size={18} />
          <span style={{
            position: 'absolute',
            top: 2,
            right: 2,
            width: 8,
            height: 8,
            borderRadius: '50%',
            background: 'var(--color-error)',
            border: '2px solid var(--color-bg-elevated)',
          }} />
        </IconButton>

        {/* Profile avatar */}
        <button
          ref={avatarRef}
          onClick={() => setProfileOpen(prev => !prev)}
          style={{
            width: 32,
            height: 32,
            borderRadius: '50%',
            overflow: 'hidden',
            border: '2px solid var(--color-border)',
            cursor: 'pointer',
            padding: 0,
            background: 'var(--color-brand)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: '#fff',
            fontSize: 12,
            fontWeight: 600,
            flexShrink: 0,
            transition: 'border-color var(--transition-fast)',
          }}
          onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--color-brand)'; }}
          onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--color-border)'; }}
          aria-label="Profile menu"
          aria-expanded={profileOpen}
        >
          {user?.avatarUrl ? (
            <img src={user.avatarUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          ) : (
            user?.fullName?.charAt(0)?.toUpperCase() || user?.username?.charAt(0)?.toUpperCase() || '?'
          )}
        </button>
      </div>

      {/* Profile panel */}
      {profileOpen && (
        <div
          ref={panelRef}
          role="menu"
          style={{
            position: 'absolute',
            top: 'calc(var(--topnav-height) - 8px)',
            right: 16,
            width: 260,
            background: 'var(--color-bg-elevated)',
            border: '1px solid var(--color-border)',
            borderRadius: 12,
            boxShadow: 'var(--shadow-lg)',
            backdropFilter: 'blur(16px)',
            zIndex: 'var(--z-dropdown)',
            overflow: 'hidden',
          }}
        >
          {/* Profile header */}
          <div style={{
            padding: '16px 16px 12px',
            borderBottom: '1px solid var(--color-border)',
            display: 'flex',
            alignItems: 'center',
            gap: 12,
          }}>
            <div style={{
              width: 40,
              height: 40,
              borderRadius: '50%',
              background: 'var(--color-brand)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#fff',
              fontSize: 14,
              fontWeight: 600,
              overflow: 'hidden',
              flexShrink: 0,
            }}>
              {user?.avatarUrl ? (
                <img src={user.avatarUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
              ) : (
                user?.fullName?.charAt(0)?.toUpperCase() || '?'
              )}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {user?.fullName || user?.username || 'User'}
              </div>
              <div style={{ fontSize: 11, color: 'var(--color-text-tertiary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {user?.email}
              </div>
            </div>
          </div>

          {/* Menu items */}
          <div style={{ padding: '4px 6px', display: 'flex', flexDirection: 'column', gap: 1 }}>
            <ProfileMenuItem icon={<CameraIcon size={15} />} label="Change Photo" onClick={() => { setProfileOpen(false); setAvatarUploadOpen(true); }} />
            <ProfileMenuItem icon={<UserIcon size={15} />} label="Manage Account" onClick={() => { setProfileOpen(false); navigate('/settings/account'); }} />
            <ProfileMenuItem icon={<SettingsIcon size={15} />} label="Settings" onClick={() => { setProfileOpen(false); navigate('/settings'); }} />
            <ProfileMenuItem icon={<PaletteIcon size={15} />} label="Appearance" onClick={() => { setProfileOpen(false); navigate('/settings/appearance'); }} />
            <ProfileMenuItem icon={<LockIcon size={15} />} label="Security" onClick={() => { setProfileOpen(false); navigate('/settings/security'); }} />
            <div style={{ borderTop: '1px solid var(--color-border)', margin: '4px 0' }} />
            <ProfileMenuItem icon={<LogOutIcon size={15} />} label="Log Out" onClick={handleLogout} danger />
          </div>
        </div>
      )}
    </header>
      {avatarUploadOpen && <AvatarUpload onClose={() => setAvatarUploadOpen(false)} />}
    </>
  );
}

function ProfileMenuItem({ icon, label, onClick, danger }: {
  icon: React.ReactNode; label: string; onClick: () => void; danger?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      role="menuitem"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        padding: '8px 10px',
        borderRadius: 6,
        fontSize: 13,
        color: danger ? 'var(--color-error)' : 'var(--color-text)',
        cursor: 'pointer',
        transition: 'background var(--transition-fast)',
        border: 'none',
        background: 'transparent',
        width: '100%',
        textAlign: 'left',
      }}
      onMouseEnter={e => { e.currentTarget.style.background = 'var(--color-bg-hover)'; }}
      onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}
    >
      <span style={{ opacity: danger ? 1 : 0.6, display: 'flex' }}>{icon}</span>
      {label}
    </button>
  );
}

function IconButton({ children, onClick, title }: { children: React.ReactNode; onClick: () => void; title?: string }) {
  return (
    <button
      onClick={onClick}
      title={title}
      style={{
        width: 34,
        height: 34,
        borderRadius: 8,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: 'var(--color-text-secondary)',
        cursor: 'pointer',
        transition: 'all var(--transition-fast)',
        border: 'none',
        background: 'transparent',
        position: 'relative',
      }}
      onMouseEnter={e => { e.currentTarget.style.background = 'var(--color-bg-hover)'; e.currentTarget.style.color = 'var(--color-text)'; }}
      onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--color-text-secondary)'; }}
    >
      {children}
    </button>
  );
}

function StatusPill({ label, variant }: { label: string; variant: 'success' | 'warning' | 'error' }) {
  const colors = {
    success: { bg: 'var(--color-success-bg)', dot: 'var(--color-success)' },
    warning: { bg: 'var(--color-warning-bg)', dot: 'var(--color-warning)' },
    error: { bg: 'var(--color-error-bg)', dot: 'var(--color-error)' },
  };
  const c = colors[variant];
  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      gap: 6,
      padding: '4px 10px',
      borderRadius: 6,
      background: c.bg,
      fontSize: 11,
      fontWeight: 500,
      color: c.dot,
    }}>
      <span style={{ width: 6, height: 6, borderRadius: '50%', background: c.dot }} />
      {label}
    </div>
  );
}

function EnvBadge() {
  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      gap: 6,
      padding: '4px 10px',
      borderRadius: 6,
      background: 'var(--color-bg-active)',
      fontSize: 11,
      fontWeight: 500,
      color: 'var(--color-text-tertiary)',
      fontFamily: 'var(--font-mono)',
    }}>
      <div style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--color-warning)' }} />
      Production
    </div>
  );
}

// SVG Icons
function SearchIcon({ size }: { size: number }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="11" cy="11" r="8" /><path d="m21 21-4.3-4.3" />
    </svg>
  );
}
function SunIcon({ size }: { size: number }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="4" /><path d="M12 2v2" /><path d="M12 20v2" /><path d="m4.93 4.93 1.41 1.41" /><path d="m17.66 17.66 1.41 1.41" /><path d="M2 12h2" /><path d="M20 12h2" /><path d="m6.34 17.66-1.41 1.41" /><path d="m19.07 4.93-1.41 1.41" />
    </svg>
  );
}
function MoonIcon({ size }: { size: number }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z" />
    </svg>
  );
}
function BellIcon({ size }: { size: number }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" /><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
    </svg>
  );
}
function CameraIcon({ size }: { size: number }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" /><circle cx="12" cy="13" r="4" />
    </svg>
  );
}
function UserIcon({ size }: { size: number }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" />
    </svg>
  );
}
function SettingsIcon({ size }: { size: number }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" /><circle cx="12" cy="12" r="3" />
    </svg>
  );
}
function PaletteIcon({ size }: { size: number }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="13.5" cy="6.5" r=".5" fill="currentColor" /><circle cx="17.5" cy="10.5" r=".5" fill="currentColor" /><circle cx="8.5" cy="7.5" r=".5" fill="currentColor" /><circle cx="6.5" cy="12.5" r=".5" fill="currentColor" /><path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.93 0 1.5-.6 1.5-1.5 0-.4-.15-.7-.4-1-.25-.3-.6-.5-.6-1 0-.5.4-1 1-1h1.5c3 0 5.5-2.5 5.5-5.5C20 5.5 16.5 2 12 2z" />
    </svg>
  );
}
function LockIcon({ size }: { size: number }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="11" width="18" height="11" rx="2" ry="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" />
    </svg>
  );
}
function LogOutIcon({ size }: { size: number }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><polyline points="16 17 21 12 16 7" /><line x1="21" y1="12" x2="9" y2="12" />
    </svg>
  );
}
function MenuIcon({ size }: { size: number }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="4" y1="6" x2="20" y2="6" /><line x1="4" y1="12" x2="20" y2="12" /><line x1="4" y1="18" x2="20" y2="18" />
    </svg>
  );
}
