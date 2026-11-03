import { useEffect } from 'react';
import { act, cleanup, render, waitFor } from '@testing-library/react';
import { ThemeProvider } from 'next-themes';
import { afterEach, expect, it, vi } from 'vitest';

afterEach(() => { cleanup(); vi.unstubAllGlobals(); document.documentElement.removeAttribute('data-theme-owner'); });

it('hands the pre-auth theme to next-themes, follows System, and preserves manual choices without touching auth storage', async () => {
  vi.resetModules(); Reflect.deleteProperty(window, 'RevlumaTheme');
  localStorage.clear(); sessionStorage.clear();
  document.documentElement.setAttribute('data-theme-owner', 'dashboard');
  localStorage.setItem('theme', 'light');
  localStorage.setItem('rv-auth', 'unchanged-auth-fixture');
  sessionStorage.setItem('organisation-fixture', 'unchanged');
  let dark = true;
  const listeners = new Set<() => void>();
  vi.stubGlobal('matchMedia', () => ({
    get matches() { return dark; },
    addEventListener: (_event: string, callback: () => void) => listeners.add(callback),
    removeEventListener: (_event: string, callback: () => void) => listeners.delete(callback),
    addListener: (callback: () => void) => listeners.add(callback),
    removeListener: (callback: () => void) => listeners.delete(callback),
  }));
  const { useThemeStore } = await import('./themeStore');
  expect(document.documentElement).toHaveClass('dark');
  function Handoff() {
    const theme = useThemeStore(state => state.theme);
    useEffect(() => useThemeStore.getState().initializeTheme(), []);
    return <ThemeProvider attribute="class" defaultTheme="system" forcedTheme={theme} enableSystem={false} enableColorScheme><p>Local theme fixture</p></ThemeProvider>;
  }
  const view = render(<Handoff />);
  await waitFor(() => expect(document.documentElement).toHaveClass('dark'));
  act(() => { dark = false; listeners.forEach(listener => listener()); });
  await waitFor(() => expect(document.documentElement).toHaveClass('light'));
  act(() => { dark = true; listeners.forEach(listener => listener()); });
  await waitFor(() => expect(document.documentElement).toHaveClass('dark'));
  act(() => useThemeStore.getState().setTheme('light'));
  await waitFor(() => expect(document.documentElement).toHaveClass('light'));
  act(() => { dark = false; listeners.forEach(listener => listener()); dark = true; listeners.forEach(listener => listener()); });
  expect(document.documentElement).toHaveClass('light');
  act(() => useThemeStore.getState().setTheme('system'));
  await waitFor(() => expect(document.documentElement).toHaveClass('dark'));
  expect(document.documentElement.style.colorScheme).toBe('dark');
  expect(localStorage.getItem('rv-auth')).toBe('unchanged-auth-fixture');
  expect(sessionStorage.getItem('organisation-fixture')).toBe('unchanged');
  view.unmount(); expect(listeners.size).toBe(0);
});
