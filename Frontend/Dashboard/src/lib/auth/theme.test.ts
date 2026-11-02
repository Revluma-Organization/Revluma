import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { JSDOM } from 'jsdom';
import { afterEach, describe, expect, it, vi } from 'vitest';

const source = readFileSync('../assets/js/theme.js', 'utf8');
const css = readFileSync('../assets/css/auth-theme.css', 'utf8');
const pages = ['login', 'signup', 'verifyemail', 'forgottenpassword', 'onboarding', 'choose-plan', 'payment-success'];
type StorageFixture = Record<string, string>;
const saved = (preference: unknown, theme = 'light') => ({ 'rv-theme': JSON.stringify({ state: { preference, theme } }) });
const windows: JSDOM[] = [];

function load(page: string, initialDark: boolean, storage: StorageFixture = {}, legacyMedia = false) {
  const dashboard = page === 'dashboard';
  const html = readFileSync(dashboard ? 'index.html' : `../auth/${page}.html`, 'utf8');
  const dom = new JSDOM(html, { url: `http://localhost/${dashboard ? 'dashboard/' : `auth/${page}.html`}`, runScripts: 'outside-only' });
  windows.push(dom);
  const win = dom.window;
  let dark = initialDark;
  const listeners = new Set<() => void>();
  const subscribe = (callback: () => void) => listeners.add(callback);
  const unsubscribe = (callback: () => void) => listeners.delete(callback);
  Object.defineProperty(win, 'matchMedia', { configurable: true, value: () => ({
    get matches() { return dark; },
    ...(legacyMedia ? { addListener: subscribe, removeListener: unsubscribe }
      : { addEventListener: (_event: string, callback: () => void) => subscribe(callback), removeEventListener: (_event: string, callback: () => void) => unsubscribe(callback) }),
  }) });
  for (const [key, value] of Object.entries(storage)) win.localStorage.setItem(key, value);
  const request = vi.fn(() => { throw new Error('Network forbidden in theme tests.'); });
  win.fetch = request;
  const bootstrap = dashboard ? Array.from(win.document.scripts as HTMLCollectionOf<HTMLScriptElement>).find(script => script.textContent.includes('window.RevlumaTheme'))!.textContent : source;
  win.eval(bootstrap);
  if (!dashboard) {
    const style = win.document.createElement('style'); style.textContent = css; win.document.head.append(style);
  }
  return {
    win, html, request, listeners,
    appearance: () => win.document.documentElement.classList.contains('dark') ? 'dark' : 'light',
    change: (value: boolean) => { dark = value; listeners.forEach(callback => callback()); },
  };
}
afterEach(() => { windows.splice(0).forEach(dom => dom.window.close()); vi.restoreAllMocks(); });

function contrast(first: string, second: string) {
  const luminance = (hex: string) => {
    const full = hex.length === 4 ? '#' + [...hex.slice(1)].map(char => char + char).join('') : hex;
    const values = [1, 3, 5].map(index => parseInt(full.slice(index, index + 2), 16) / 255)
      .map(value => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
    return values[0] * 0.2126 + values[1] * 0.7152 + values[2] * 0.0722;
  };
  const levels = [luminance(first), luminance(second)].sort((a, b) => b - a);
  return (levels[0] + 0.05) / (levels[1] + 0.05);
}

describe('standalone authentication appearance', () => {
  it.each(pages.flatMap(page => [false, true].map(dark => ({ page, dark }))))('$page defaults to system (dark=$dark), follows changes both ways, and has readable palette tokens', ({ page, dark }) => {
    const view = load(page, dark);
    expect(view.appearance()).toBe(dark ? 'dark' : 'light');
    expect(view.win.document.documentElement.style.colorScheme).toBe(view.appearance());
    const palette = view.win.getComputedStyle(view.win.document.documentElement);
    for (const foreground of ['--text', '--muted', '--muted2']) {
      for (const background of ['--bg', '--surface']) {
        expect(contrast(palette.getPropertyValue(foreground).trim(), palette.getPropertyValue(background).trim())).toBeGreaterThanOrEqual(4.5);
      }
    }
    view.change(!dark); expect(view.appearance()).toBe(dark ? 'light' : 'dark');
    view.change(dark); expect(view.appearance()).toBe(dark ? 'dark' : 'light');
    expect(view.request).not.toHaveBeenCalled();
    expect(view.win.localStorage.length).toBe(0);
  });
  it.each(pages.flatMap(page => [false, true].map(dark => ({ page, dark }))))('$page restores saved System (dark=$dark)', ({ page, dark }) => {
    const view = load(page, dark, saved('system', dark ? 'light' : 'dark'));
    expect(view.appearance()).toBe(dark ? 'dark' : 'light');
    view.change(!dark); expect(view.appearance()).toBe(dark ? 'light' : 'dark');
  });
  it.each(pages.flatMap(page => ['light', 'dark'].map(preference => ({ page, preference }))))('$page honours explicit $preference across system changes', ({ page, preference }) => {
    const view = load(page, preference !== 'dark', saved(preference));
    expect(view.appearance()).toBe(preference);
    view.change(preference === 'dark'); view.change(preference !== 'dark');
    expect(view.appearance()).toBe(preference);
  });
  it.each(['{corrupt', JSON.stringify({ state: [] }), JSON.stringify({ state: { preference: 'invalid', theme: 'light' } }), JSON.stringify({ state: { preference: null, theme: 'light' } })])('falls back to system for malformed persisted state: %s', stored => {
    expect(load('login', true, { 'rv-theme': stored }).appearance()).toBe('dark');
  });
  it.each(['light', 'dark'])('ignores the standalone %s cache without deleting it', cache => {
    const view = load('login', cache === 'light', { theme: cache });
    expect(view.appearance()).toBe(cache === 'light' ? 'dark' : 'light');
    expect(view.win.localStorage.getItem('theme')).toBe(cache);
  });
  it.each(['light', 'dark'])('preserves the documented legacy rv-theme %s migration', theme => {
    const stored = JSON.stringify({ state: { theme }, version: 0 });
    const view = load('login', theme !== 'dark', { 'rv-theme': stored });
    expect(view.appearance()).toBe(theme); expect(view.win.localStorage.getItem('rv-theme')).toBe(stored);
  });
  it('supports older matchMedia listeners and remains safe when matchMedia or storage is unavailable', () => {
    const view = load('login', true, {}, true);
    expect(view.appearance()).toBe('dark'); view.change(false); expect(view.appearance()).toBe('light');
    Reflect.deleteProperty(view.win, 'RevlumaTheme');
    Object.defineProperty(view.win, 'matchMedia', { value: undefined });
    Object.defineProperty(view.win, 'localStorage', { get: () => { throw new Error('Storage blocked'); } });
    expect(() => view.win.eval(source)).not.toThrow();
    expect(view.appearance()).toBe('light');
  });
  it('responds to authoritative storage changes without writing auth, organisation or session state', () => {
    const view = load('login', true, { 'rv-auth': 'unchanged-auth-fixture', active_organisation: 'unchanged-org-fixture' });
    view.win.sessionStorage.setItem('session-fixture', 'unchanged');
    const writes = vi.spyOn(view.win.Storage.prototype, 'setItem');
    view.change(false); view.change(true);
    expect(writes).not.toHaveBeenCalled();
    view.win.localStorage.setItem('rv-theme', JSON.stringify({ state: { preference: 'light' } }));
    writes.mockClear();
    view.win.dispatchEvent(new view.win.StorageEvent('storage', { key: 'rv-theme' }));
    expect(view.appearance()).toBe('light'); expect(writes).not.toHaveBeenCalled();
    expect(view.win.localStorage.getItem('rv-auth')).toBe('unchanged-auth-fixture');
    expect(view.win.localStorage.getItem('active_organisation')).toBe('unchanged-org-fixture');
    expect(view.win.sessionStorage.getItem('session-fixture')).toBe('unchanged');
  });
  it.each(pages)('%s loads the real local theme assets synchronously before auth scripts and styling', page => {
    const { win, html } = load(page, true);
    const script = win.document.querySelector('script[src="../assets/js/theme.js"]') as HTMLScriptElement;
    const link = win.document.querySelector('link[href="../assets/css/auth-theme.css"]') as HTMLLinkElement;
    expect(script).not.toBeNull(); expect(link).not.toBeNull();
    expect(script.async).not.toBe(true); expect(script.defer).toBe(false);
    expect(html.indexOf('theme.js')).toBeLessThan(html.indexOf('<style'));
    for (const asset of [script.src, link.href]) {
      const url = new URL(asset); expect(url.origin).toBe('http://localhost');
      expect(existsSync(path.join('..', url.pathname))).toBe(true);
    }
    expect(css).toContain('input::placeholder'); expect(css).toContain('.toast-error');
    expect(css).toContain('#loadingOverlay'); expect(css).toContain('.glassmorphism-card');
  });
});

describe('authentication to dashboard theme handoff', () => {
  it.each([{}, saved('system'), saved('light'), saved('dark'), { theme: 'light' }, { 'rv-theme': JSON.stringify({ state: { theme: 'dark' } }) }])('keeps appearance consistent through navigation and reload: %j', storage => {
    const login = load('login', true, storage);
    const signup = load('signup', true, storage);
    const dashboard = load('dashboard', true, storage);
    const reloaded = load('dashboard', true, storage);
    for (const view of [signup, dashboard, reloaded]) expect(view.appearance()).toBe(login.appearance());
    expect(dashboard.listeners.size).toBe(0);
    const bootPosition = dashboard.html.indexOf('window.RevlumaTheme');
    expect(bootPosition).toBeLessThan(dashboard.html.indexOf('<link'));
    expect(bootPosition).toBeLessThan(dashboard.html.indexOf('type="module"'));
    const main = readFileSync('src/main.tsx', 'utf8');
    expect(main).toContain('forcedTheme={theme}'); expect(main).toContain('enableSystem={false}');
    expect(readFileSync('src/pages/settings/Preferences.tsx', 'utf8')).toMatch(/id:\s*["']system["']/);
  });
});
