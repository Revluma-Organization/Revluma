import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { ThemeProvider } from "next-themes";
import App from "./App";
import { useThemeStore } from "./store/themeStore";
import "./index.css";
import { ErrorBoundary } from "./components/ErrorBoundary";

/**
 * Zustand is the single source of truth for the dashboard theme.
 *
 * next-themes receives that same value instead of independently
 * restoring a different theme from its own storage.
 *
 * This keeps the sidebar, topbar, dashboard and theme-aware
 * components aligned after reloads and navigation.
 */
function StoreSyncedThemeProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const theme = useThemeStore((state) => state.theme);

  return (
    <ThemeProvider
      attribute="class"
      defaultTheme="system"
      forcedTheme={theme}
      enableSystem={false}
      enableColorScheme
      disableTransitionOnChange
    >
      {children}
    </ThemeProvider>
  );
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <StoreSyncedThemeProvider>
      <BrowserRouter>
        <ErrorBoundary>
          <App />
        </ErrorBoundary>
      </BrowserRouter>
    </StoreSyncedThemeProvider>
  </React.StrictMode>,
);
