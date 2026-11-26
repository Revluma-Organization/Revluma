import { useEffect, useRef, useState } from "react";
import {
  ArrowUpRight,
  Check,
  ChevronDown,
  Clock3,
  RefreshCw,
  Settings2,
  Store,
} from "lucide-react";
import { Link, useInRouterContext, useNavigate } from "react-router-dom";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { CommandCenterFailure } from "@/lib/commandCenterError";
import { cc } from "./tokens";
import {
  WELCOME_SUPPORTING_COPY,
  formatWelcomeGreeting,
  resolveLastSynchronized,
  resolveWelcomeConnectionStatus,
  resolveWelcomeStoreIdentity,
  type WelcomeConnectionStatus,
  type WelcomeConnectionTone,
  type WelcomeUserProfile,
} from "@/lib/commandCenterWelcome";
import { cn } from "@/lib/utils";
import { useAuthStore } from "@/store/authStore";
import type { CommandCenterData, StoreSummary } from "./types";

export interface CommandCenterWelcomeSectionProps {
  data: CommandCenterData | null;
  loading?: boolean;
  refreshing: boolean;
  failure?: CommandCenterFailure | null;
  /** Optional explicit timestamp fallback retained for call-site compatibility. */
  lastSuccessfulAt?: string | null;
  /** Optional user override for deterministic tests; defaults to authenticated user. */
  userOverride?: WelcomeUserProfile | null;
  /** Optional reference clock for deterministic tests; defaults to live time. */
  nowOverride?: Date;
  onRefresh: () => void | Promise<void>;
  onSelectStore?: (storeId: string) => void;
}

const FOCUS_RING =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2";

const CONNECTION_PILL_STYLES: Record<
  WelcomeConnectionTone,
  { pill: string; dot: string; appState: string; pulse?: boolean }
> = {
  positive: {
    // Text color flows through cc.positive so the tested literal is preserved.
    pill: `border-success-line bg-success-soft ${cc.positive}`,
    dot: "bg-success-bright",
    appState: "current",
  },
  progress: {
    pill: "border-brand-line bg-brand-mist text-brand",
    dot: "bg-brand",
    appState: "updating",
    pulse: true,
  },
  warning: {
    pill: "border-warning-line bg-warning-soft text-warning",
    dot: "bg-warning-strong",
    appState: "partial",
  },
  negative: {
    pill: "border-danger-line bg-danger-soft text-danger",
    dot: "bg-danger-strong",
    appState: "unavailable",
  },
  neutral: {
    pill: "border-line bg-workspace text-ink-steel",
    dot: "bg-ink-faint",
    appState: "empty",
  },
};

const REFRESH_FEEDBACK_DURATION_MS = 4_000;
const CLOCK_TICK_MS = 30_000;

function ShopifyBagIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      className={className}
    >
      <path
        d="M17.9 6.35a.42.42 0 0 0-.37-.36l-1.56-.11s-1.24-1.2-1.36-1.32a.52.52 0 0 0-.29-.1l-.68 15.04 5.26-1.15L17.9 6.35Z"
        fill="currentColor"
        fillOpacity="0.72"
      />
      <path
        d="M14.32 4.46c-.11-.31-.28-.6-.51-.83a1.9 1.9 0 0 0-1.32-.55c-.06 0-.11 0-.17.01-.34-.42-.83-.64-1.4-.62-1.09.03-2.17.82-3.04 2.22-.62 1-1.09 2.25-1.22 3.22l-1.85.57c-.55.17-.57.19-.64.71-.05.4-1.48 11.41-1.48 11.41L13.64 22l.68-17.54Zm-2.38-.51c-.39.12-.83.26-1.3.4.25-.96.73-1.91 1.51-2.26.25.56.25 1.32-.21 1.86Zm-1.08-2.34c.23 0 .42.06.59.17-.88.41-1.64 1.45-1.99 2.94-.39.12-.77.24-1.12.35.42-1.44 1.38-3.42 2.52-3.46Zm-1.6 10.6c.08.92.99 1.54 1.77 1.88.78.34 1.04.74 1 1.24-.06.76-.75 1.18-1.59 1.12-.96-.06-1.49-.62-1.49-.62l-.33.96s.58.65 1.77.74c1.55.12 2.75-.74 2.86-2.16.08-1.05-.62-1.67-1.47-2.06-.67-.31-1.05-.56-1-1.07.04-.49.49-.84 1.14-.8.67.04 1.07.31 1.07.31l.39-.95s-.55-.39-1.46-.44c-1.3-.08-2.74.75-2.66 1.85Z"
        fill="currentColor"
      />
    </svg>
  );
}

function WelcomeConnectionBadge({
  status,
  inRouter,
}: {
  status: WelcomeConnectionStatus;
  inRouter: boolean;
}) {
  const style = CONNECTION_PILL_STYLES[status.tone];
  const content = (
    <>
      <span
        aria-hidden="true"
        className={cn(
          "h-1.5 w-1.5 shrink-0 rounded-full",
          style.dot,
          style.pulse && "animate-pulse motion-reduce:animate-none",
        )}
      />
      <span>{status.label}</span>
      {status.needsAction && status.actionHref && (
        <ArrowUpRight className="h-3 w-3 shrink-0 opacity-75" aria-hidden="true" />
      )}
    </>
  );

  const badgeClass = cn(
    "inline-flex min-h-6 shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-medium leading-4 transition-colors",
    style.pill,
  );

  if (status.needsAction && status.actionHref) {
    if (inRouter) {
      return (
        <Link
          to={status.actionHref}
          data-app-state={style.appState}
          title={status.description}
          className={cn(badgeClass, "hover:brightness-95", FOCUS_RING)}
        >
          {content}
        </Link>
      );
    }
    return (
      <a
        href={status.actionHref}
        data-app-state={style.appState}
        title={status.description}
        className={cn(badgeClass, "hover:brightness-95", FOCUS_RING)}
      >
        {content}
      </a>
    );
  }

  return (
    <span data-app-state={style.appState} title={status.description} className={badgeClass}>
      {content}
    </span>
  );
}

function StoreSwitcherDropdown({
  activeStore,
  stores,
  onSelectStore,
}: {
  activeStore: StoreSummary;
  stores: StoreSummary[];
  onSelectStore: (storeId: string) => void;
}) {
  const navigate = useNavigate();
  const activeLabel =
    (typeof activeStore.display_name === "string" && activeStore.display_name.trim()) ||
    activeStore.shop_domain ||
    activeStore.name ||
    "Store";

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={`Switch store, current store: ${activeLabel}`}
          className={cn(
            "inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md border border-transparent text-ink-muted transition-colors hover:border-line hover:bg-workspace hover:text-ink",
            FOCUS_RING,
          )}
        >
          <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        sideOffset={6}
        className="w-72 rounded-xl border border-line bg-white p-1.5 text-ink shadow-[0_12px_28px_rgba(17,19,24,0.1)]"
      >
        <DropdownMenuLabel className="px-2.5 py-1.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-muted">
          Connected stores
        </DropdownMenuLabel>
        {stores.map((store) => {
          const isSelected = activeStore.id === store.id;
          const domain = (store.shop_domain || store.name || "").trim();
          const name =
            (typeof store.display_name === "string" && store.display_name.trim()) ||
            domain ||
            "Store";
          const secondary = domain && domain !== name ? domain : null;
          const status = store.connection_status
            ? resolveWelcomeConnectionStatus(null, false, null, store.connection_status)
            : null;
          return (
            <DropdownMenuItem
              key={store.id}
              onSelect={() => {
                if (!isSelected) onSelectStore(store.id);
              }}
              className={cn(
                "flex cursor-pointer items-center justify-between gap-2.5 rounded-lg px-2.5 py-2 text-xs focus:bg-workspace focus:text-ink",
                isSelected && "bg-veil",
              )}
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <span className="truncate font-medium text-ink">{name}</span>
                  {status && (
                    <span
                      aria-hidden="true"
                      className={cn(
                        "h-1.5 w-1.5 shrink-0 rounded-full",
                        CONNECTION_PILL_STYLES[status.tone].dot,
                      )}
                    />
                  )}
                </div>
                {secondary && (
                  <p className="mt-0.5 truncate text-[11px] text-ink-muted">{secondary}</p>
                )}
              </div>
              {isSelected && (
                <Check className="h-3.5 w-3.5 shrink-0 text-brand" aria-hidden="true" />
              )}
            </DropdownMenuItem>
          );
        })}
        <DropdownMenuSeparator className="my-1.5 bg-line" />
        <DropdownMenuItem
          onSelect={() => navigate("/dashboard/integrations")}
          className="flex cursor-pointer items-center gap-2 rounded-lg px-2.5 py-2 text-xs font-medium text-brand focus:bg-veil focus:text-brand"
        >
          <Settings2 className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <span>Manage stores in Integrations</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function CommandCenterWelcomeSection({
  data,
  loading = false,
  refreshing,
  failure = null,
  userOverride,
  nowOverride,
  onRefresh,
  onSelectStore,
}: CommandCenterWelcomeSectionProps) {
  const inRouter = useInRouterContext();
  const authUser = useAuthStore((state) => state.user);
  const user = userOverride !== undefined ? userOverride : authUser;

  // Keep relative synchronization time and greeting period fresh while open.
  const [liveNow, setLiveNow] = useState<Date>(() => nowOverride ?? new Date());
  useEffect(() => {
    if (nowOverride) {
      setLiveNow(nowOverride);
      return;
    }
    const timer = window.setInterval(() => setLiveNow(new Date()), CLOCK_TICK_MS);
    return () => window.clearInterval(timer);
  }, [nowOverride]);

  const now = nowOverride ?? liveNow;

  // Guard against duplicate clicks and surface honest, backend-confirmed feedback.
  const [refreshFeedback, setRefreshFeedback] = useState<"succeeded" | "failed" | null>(null);
  const manualRefreshRequestedRef = useRef(false);
  const prevRefreshingRef = useRef(refreshing);

  useEffect(() => {
    const wasRefreshing = prevRefreshingRef.current;
    prevRefreshingRef.current = refreshing;

    if (wasRefreshing && !refreshing && manualRefreshRequestedRef.current) {
      manualRefreshRequestedRef.current = false;
      setRefreshFeedback(failure ? "failed" : "succeeded");
    }
  }, [refreshing, failure]);

  useEffect(() => {
    if (!refreshFeedback) return;
    const timeout = window.setTimeout(() => setRefreshFeedback(null), REFRESH_FEEDBACK_DURATION_MS);
    return () => window.clearTimeout(timeout);
  }, [refreshFeedback]);

  const handleRefreshClick = () => {
    if (refreshing || loading) return;
    manualRefreshRequestedRef.current = true;
    setRefreshFeedback(null);
    void onRefresh();
  };

  const greeting = formatWelcomeGreeting(user, data, now);
  const connection = resolveWelcomeConnectionStatus(data, loading, failure);
  const storeIdentity = resolveWelcomeStoreIdentity(data, loading, failure, connection);
  const lastSynced = resolveLastSynchronized(data, loading, failure, greeting.timezone, now);

  const canSwitchStores = Boolean(
    storeIdentity.hasMultipleStores &&
      storeIdentity.store &&
      onSelectStore &&
      inRouter,
  );
  const isRefreshDisabled = refreshing || (loading && !data);
  const storeDomain =
    (typeof storeIdentity.store?.shop_domain === "string" &&
      storeIdentity.store.shop_domain.trim()) ||
    "";
  const storeDisplayUrl = storeDomain || storeIdentity.primaryName;
  const storeDisplayTitle =
    storeIdentity.primaryName &&
    storeDomain &&
    storeIdentity.primaryName !== storeDomain
      ? `${storeIdentity.primaryName} (${storeDomain})`
      : (storeDisplayUrl ?? undefined);

  return (
    <header aria-labelledby="command-center-welcome-heading" className="min-w-0">
      <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between xl:gap-6">
        {/* Greeting + contextual introduction */}
        <div className="min-w-0 shrink-0">
          <h1
            id="command-center-welcome-heading"
            className="text-[1.75rem] font-semibold leading-[1.18] tracking-[-0.03em] text-ink sm:text-[2rem]"
          >
            {greeting.text}.
          </h1>
          <p className="mt-1.5 text-sm leading-6 text-ink-muted">
            {WELCOME_SUPPORTING_COPY}
          </p>
        </div>

        {/* Compact horizontal store identity, connection, sync timestamp & refresh bar */}
        <div
          role="region"
          aria-label="Connected store"
          className="flex min-w-0 max-w-full flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border border-line bg-white px-3.5 py-2.5 xl:flex-nowrap"
        >
          {/* Store identity */}
          <div className="flex min-w-0 max-w-full items-center gap-2">
            <span
              aria-hidden="true"
              className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-workspace"
            >
              {storeIdentity.platform === "shopify" ? (
                <ShopifyBagIcon
                  className={cn(
                    "h-3.5 w-3.5",
                    connection.isConfirmedConnected ? "text-connected" : "text-ink-muted",
                  )}
                />
              ) : (
                <Store className="h-3.5 w-3.5 text-ink-muted" />
              )}
            </span>

            {loading && !data ? (
              <>
                <div
                  aria-hidden="true"
                  className="h-3.5 w-32 max-w-full animate-pulse rounded bg-line motion-reduce:animate-none"
                />
                <span className="sr-only">Loading connected store details</span>
              </>
            ) : (
              <span
                title={storeDisplayTitle}
                className={cn(
                  "max-w-[200px] truncate text-xs font-semibold sm:max-w-[220px] xl:max-w-[190px]",
                  storeIdentity.hasStore ? "text-ink" : "text-ink-muted",
                )}
              >
                {storeDisplayUrl}
              </span>
            )}

            {canSwitchStores && storeIdentity.store && onSelectStore && (
              <StoreSwitcherDropdown
                activeStore={storeIdentity.store}
                stores={storeIdentity.stores}
                onSelectStore={onSelectStore}
              />
            )}
          </div>

          {/* Connection status */}
          <div className="shrink-0">
            <WelcomeConnectionBadge status={connection} inRouter={inRouter} />
          </div>

          <span
            aria-hidden="true"
            className="hidden h-4 w-px shrink-0 bg-line sm:inline-block"
          />

          {/* Last successful synchronization timestamp */}
          <span
            title={lastSynced.title ?? undefined}
            className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap text-xs text-ink-muted tabular-nums"
          >
            <Clock3 className="h-3.5 w-3.5 shrink-0 text-ink-faint" aria-hidden="true" />
            <span>{lastSynced.label}</span>
          </span>

          <span
            aria-hidden="true"
            className="hidden h-4 w-px shrink-0 bg-line sm:inline-block"
          />

          {/* Real refresh action + honest completion feedback */}
          <div className="flex shrink-0 items-center gap-2">
            {refreshFeedback === "succeeded" && (
              <span
                role="status"
                className="inline-flex items-center gap-1 text-xs font-medium text-success"
              >
                <Check className="h-3.5 w-3.5" aria-hidden="true" />
                <span>Refreshed</span>
              </span>
            )}
            {refreshFeedback === "failed" && (
              <span role="status" className="text-xs font-medium text-danger">
                Refresh failed
              </span>
            )}

            <button
              type="button"
              onClick={handleRefreshClick}
              disabled={isRefreshDisabled}
              aria-busy={refreshing}
              aria-label={refreshing ? "Refreshing…" : "Refresh briefing"}
              className={cn(
                "inline-flex min-h-8 shrink-0 items-center gap-1.5 rounded-lg border border-line bg-subtle px-2.5 py-1 text-xs font-medium text-ink transition-colors hover:border-brand-line hover:bg-veil hover:text-brand disabled:cursor-not-allowed disabled:opacity-55",
                FOCUS_RING,
              )}
            >
              <RefreshCw
                className={cn(
                  "h-3.5 w-3.5",
                  refreshing && "animate-spin motion-reduce:animate-none",
                )}
                aria-hidden="true"
              />
              <span>{refreshing ? "Refreshing…" : "Refresh"}</span>
            </button>
          </div>
        </div>
      </div>
    </header>
  );
}
