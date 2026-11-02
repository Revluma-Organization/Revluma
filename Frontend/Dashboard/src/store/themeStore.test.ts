import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

beforeEach(() => {
  Reflect.deleteProperty(window, 'RevlumaTheme');
  document.documentElement.removeAttribute('data-theme-owner');
  localStorage.clear();
});
afterEach(() => { vi.unstubAllGlobals(); document.documentElement.removeAttribute('data-theme-owner'); });

describe('theme preference persistence', () => {
  let dark = false;
  let onChange: () => void;
  beforeEach(() => {
    vi.resetModules();
    localStorage.clear();
    document.documentElement.setAttribute('data-theme-owner', 'dashboard');
    dark = false;
    vi.stubGlobal('matchMedia', vi.fn(() => ({
      get matches() { return dark; },
      addEventListener: (_event: string, listener: () => void) => { onChange = listener; },
      removeEventListener: vi.fn(),
    })));
  });

  it('defaults to System, follows OS changes, and keeps explicit choices', async () => {
    const { useThemeStore } = await import('./themeStore');
    expect(useThemeStore.getState()).toMatchObject({ preference: 'system', theme: 'light' });
    const dispose = useThemeStore.getState().initializeTheme();
    dark = true; onChange();
    expect(useThemeStore.getState().theme).toBe('dark');
    useThemeStore.getState().setTheme('light');
    onChange();
    expect(useThemeStore.getState()).toMatchObject({ preference: 'light', theme: 'light' });
    useThemeStore.getState().setTheme('system');
    expect(useThemeStore.getState().theme).toBe('dark');
    expect(JSON.parse(localStorage.getItem('rv-theme')!).state.preference).toBe('system');
    dispose();
  });

  it.each(['light', 'dark'] as const)('preserves legacy %s choice on hydration and reload', async theme => {
    localStorage.setItem('rv-theme', JSON.stringify({ state: { theme }, version: 0 }));
    const { useThemeStore } = await import('./themeStore');
    expect(useThemeStore.getState()).toMatchObject({ preference: theme, theme });
    useThemeStore.getState().toggleTheme();
    const next = theme === 'dark' ? 'light' : 'dark';
    await useThemeStore.persist.rehydrate();
    expect(useThemeStore.getState()).toMatchObject({ preference: next, theme: next });
  });

  it('does not treat a standalone next-themes cache as an app preference', async () => {
    dark = true; localStorage.setItem('theme', 'light');
    const { useThemeStore } = await import('./themeStore');
    expect(useThemeStore.getState()).toMatchObject({ preference: 'system', theme: 'dark' });
    expect(localStorage.getItem('theme')).toBe('light');
  });
  it.each(['invalid', null, false])('does not promote the cached colour when preference is %j', async preference => {
    localStorage.setItem('rv-theme', JSON.stringify({ state: { preference, theme: 'dark' } }));
    const { useThemeStore } = await import('./themeStore');
    expect(useThemeStore.getState()).toMatchObject({ preference: 'system', theme: 'light' });
  });
  it.each(['light', 'dark', 'system'] as const)('restores modern %s consistently on dashboard reload', async preference => {
    dark = true; localStorage.setItem('rv-theme', JSON.stringify({ state: { preference, theme: 'light' } }));
    const { useThemeStore } = await import('./themeStore');
    expect(useThemeStore.getState()).toMatchObject({ preference, theme: preference === 'light' ? 'light' : 'dark' });
    const dispose = useThemeStore.getState().initializeTheme();
    expect(document.documentElement).toHaveClass(useThemeStore.getState().theme);
    dark = false; onChange();
    expect(useThemeStore.getState().theme).toBe(preference === 'dark' ? 'dark' : 'light');
    // The store updates state; next-themes owns subsequent dashboard classes.
    expect(document.documentElement).toHaveClass(preference === 'light' ? 'light' : 'dark');
    await useThemeStore.persist.rehydrate();
    expect(useThemeStore.getState().preference).toBe(preference);
    dispose();
  });
  it('recovers corrupted storage without touching unrelated storage', async () => {
    dark = true; localStorage.setItem('rv-theme', '{bad'); localStorage.setItem('unrelated', 'unchanged');
    const { useThemeStore } = await import('./themeStore');
    expect(useThemeStore.getState()).toMatchObject({ preference: 'system', theme: 'dark' });
    useThemeStore.getState().setTheme('system');
    expect(localStorage.getItem('unrelated')).toBe('unchanged');
  });
  it.each([false, true])('cleans up system listeners, including legacy browsers (legacy=%s)', async legacy => {
    const listeners = new Set<() => void>();
    const add = (listener: () => void) => listeners.add(listener);
    const remove = (listener: () => void) => listeners.delete(listener);
    vi.stubGlobal('matchMedia', () => ({
      get matches() { return dark; },
      ...(legacy ? { addListener: add, removeListener: remove } : {
        addEventListener: (_event: string, listener: () => void) => add(listener),
        removeEventListener: (_event: string, listener: () => void) => remove(listener),
      }),
    }));
    const { useThemeStore } = await import('./themeStore');
    const stop = useThemeStore.getState().initializeTheme();
    expect(listeners.size).toBe(1);
    dark = true; listeners.forEach(listener => listener());
    expect(useThemeStore.getState().theme).toBe('dark');
    stop(); expect(listeners.size).toBe(0);
    dark = false; listeners.forEach(listener => listener());
    expect(useThemeStore.getState().theme).toBe('dark');
  });
});

describe('pre-authentication bootstrap', () => {
  it('keeps dashboard and auth bootstrap code identical', async () => {
    const { readFileSync } = await import('node:fs');
    const script = readFileSync('../assets/js/theme.js', 'utf8').trim();
    const html = readFileSync('index.html', 'utf8');
    expect(html).toContain(script);
    for (const page of ['login', 'signup', 'verifyemail', 'forgottenpassword', 'onboarding', 'choose-plan', 'payment-success']) {
      const auth = readFileSync(`../auth/${page}.html`, 'utf8');
      expect(auth.indexOf('theme.js')).toBeLessThan(auth.indexOf('<style'));
      if (auth.includes('cdn.tailwindcss.com')) expect(auth.indexOf('theme.js')).toBeLessThan(auth.indexOf('cdn.tailwindcss.com'));
      const document = new DOMParser().parseFromString(auth, 'text/html');
      expect(document.head.querySelector('link[href="../assets/css/auth-theme.css"]')).not.toBeNull();
    }
  });
  it.each(['light', 'dark', 'system'])('applies persisted %s before React mounts', async preference => {
    const { readFileSync } = await import('node:fs');
    localStorage.setItem('rv-theme', JSON.stringify({ state: { preference, theme: 'dark' } }));
    const script = readFileSync('../assets/js/theme.js', 'utf8');
    window.eval(script);
    const expected = preference === 'system' ? (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light') : preference;
    expect(document.documentElement).toHaveClass(expected);
    expect(document.documentElement).not.toHaveClass(expected === 'light' ? 'dark' : 'light');
    expect(document.documentElement.style.colorScheme).toBe(expected);
  });
});

it('defaults auth to System on a dark OS, follows changes, and preserves a manual choice across refresh', async () => {
  localStorage.clear();
  let dark = true;
  let changed: () => void;
  vi.stubGlobal('matchMedia', () => ({ get matches() { return dark; }, addEventListener: (_name: string, callback: () => void) => { changed = callback; } }));
  const { readFileSync } = await import('node:fs');
  const script = readFileSync('../assets/js/theme.js', 'utf8');
  window.eval(script);
  expect(document.documentElement).toHaveClass('dark');
  dark = false; changed!();
  expect(document.documentElement).toHaveClass('light');
  localStorage.setItem('rv-theme', JSON.stringify({ state: { theme: 'dark' } }));
  changed!();
  expect(document.documentElement).toHaveClass('dark');
  window.eval(script);
  expect(document.documentElement).toHaveClass('dark');
  vi.unstubAllGlobals();
});
