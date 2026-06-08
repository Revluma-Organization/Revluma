import { useEffect, useState, useCallback, type ReactNode } from 'react';
import { ThemeContext, type ThemeMode } from '../hooks/useTheme';
import { storage } from '../utils/storage';

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<ThemeMode>(() => {
    return storage.get<ThemeMode>('theme', 'dark');
  });

  const applyTheme = useCallback((t: ThemeMode) => {
    document.documentElement.classList.toggle('light', t === 'light');
    document.documentElement.classList.toggle('dark', t === 'dark');
    storage.set('theme', t);
  }, []);

  useEffect(() => {
    applyTheme(theme);
  }, [theme, applyTheme]);

  const toggle = useCallback(() => {
    setThemeState(prev => (prev === 'dark' ? 'light' : 'dark'));
  }, []);

  const setTheme = useCallback((t: ThemeMode) => {
    setThemeState(t);
  }, []);

  return (
    <ThemeContext value={{ theme, toggle, setTheme }}>
      {children}
    </ThemeContext>
  );
}
