import { useEffect, useRef, useState } from "react";
import {
  ArrowUpRight,
  Check,
  ChevronDown,
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
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1F06AC] focus-visible:ring-offset-2";

const CONNECTION_PILL_STYLES: Record<
  WelcomeConnectionTone,
  { pill: string; dot: string; pulse?: boolean }
> = {
  positive: {
    pill: "border-[#ABEFC6] bg-[#ECFDF3] text-[#067647]",
    dot: "bg-[#12B76A]",
  },
  progress: {
    pill: "border-[#C7D2FE] bg-[#EEF2FF] text-[#1F06AC]",
    dot: "bg-[#1F06AC]",
    pulse: true,
  },
  warning: {
    pill: "border-[#FEDF89] bg-[#FFFAEB] text-[#93470E]",
    dot: "bg-[#F79009]",
  },
  negative: {
    pill: "border-[#FECDCA] bg-[#FEF3F2] text-[#B42318]",
    dot: "bg-[#F04438]",
  },
  neutral: {
    pill: "border-[#E4E7EC] bg-[#F9FAFB] text-[#475467]",
    dot: "bg-[#98A2B3]",
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
    "inline-flex min-h-6 shrink-0 items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-medium leading-4 transition-colors",
    style.pill,
  );

  if (status.needsAction && status.actionHref) {
    if (inRouter) {
      return (
        <Link
          to={status.actionHref}
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
        title={status.description}
        className={cn(badgeClass, "hover:brightness-95", FOCUS_RING)}
      >
        {content}
      </a>
    );
  }

  return (
    <span title={status.description} className={badgeClass}>
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
            "inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md border border-transparent text-[#667085] transition-colors hover:border-[#E4E7EC] hover:bg-[#F9FAFB] hover:text-[#101828]",
            FOCUS_RING,
          )}
        >
          <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        sideOffset={6}
        className="w-72 rounded-xl border border-[#E4E7EC] bg-white p-1.5 text-[#0F172A] shadow-[0_12px_28px_rgba(15,23,42,0.1)]"
      >
        <DropdownMenuLabel className="px-2.5 py-1.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-[#667085]">
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
                "flex cursor-pointer items-center justify-between gap-2.5 rounded-lg px-2.5 py-2 text-xs focus:bg-[#F9FAFB] focus:text-[#0F172A]",
                isSelected && "bg-[#F5F7FF]",
              )}
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <span className="truncate font-medium text-[#0F172A]">{name}</span>
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
                  <p className="mt-0.5 truncate text-[11px] text-[#667085]">{secondary}</p>
                )}
              </div>
              {isSelected && (
                <Check className="h-3.5 w-3.5 shrink-0 text-[#1F06AC]" aria-hidden="true" />
              )}
            </DropdownMenuItem>
          );
        })}
        <DropdownMenuSeparator className="my-1.5 bg-[#EAECF0]" />
        <DropdownMenuItem
          onSelect={() => navigate("/dashboard/integrations")}
          className="flex cursor-pointer items-center gap-2 rounded-lg px-2.5 py-2 text-xs font-medium text-[#1F06AC] focus:bg-[#F5F7FF] focus:text-[#1F06AC]"
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

    // Only report refresh success/failure after an in-flight refresh settles.
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
    <header aria-labelledby="command-center-welcome-heading" className="bg-white pb-1">
      {/* 1. Personalized Greeting & 2. Compact Connected Store Status (same horizontal line) */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-6">
        <div className="min-w-0 flex-1">
          <h1
            id="command-center-welcome-heading"
            className="text-[1.75rem] font-semibold leading-[1.16] tracking-[-0.03em] text-[#0F172A] sm:text-[2rem]"
          >
            {greeting.text}
            {greeting.merchantName && <span aria-hidden="true"> 👋</span>}
          </h1>
          <p className="mt-1.5 max-w-xl text-sm leading-6 text-[#526071]">
            {WELCOME_SUPPORTING_COPY}
          </p>
        </div>

        <div
          role="region"
          aria-label="Connected store"
          className="flex w-fit max-w-full shrink-0 flex-col items-start gap-1.5 self-start rounded-xl border border-[#EAECF0] bg-white px-3 py-2 sm:max-w-[300px] sm:items-end md:max-w-[340px]"
        >
          {/* Current store connection status at the top */}
          <WelcomeConnectionBadge status={connection} inRouter={inRouter} />

          {/* Shopify icon with the store URL right next to it */}
          <div className="flex min-w-0 max-w-full items-center gap-1.5">
            <span
              aria-hidden="true"
              className="flex shrink-0 items-center justify-center"
            >
              {storeIdentity.platform === "shopify" ? (
                <ShopifyBagIcon
                  className={cn(
                    "h-3.5 w-3.5",
                    connection.isConfirmedConnected ? "text-[#5E8E3E]" : "text-[#667085]",
                  )}
                />
              ) : (
                <Store className="h-3.5 w-3.5 text-[#667085]" />
              )}
            </span>

            {loading && !data ? (
              <>
                <div
                  aria-hidden="true"
                  className="h-3.5 w-36 max-w-full animate-pulse rounded bg-[#EAECF0] motion-reduce:animate-none"
                />
                <span className="sr-only">Loading connected store details</span>
              </>
            ) : (
              <span
                title={storeDisplayTitle}
                className={cn(
                  "truncate text-xs font-medium",
                  storeIdentity.hasStore ? "text-[#101828]" : "text-[#667085]",
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
        </div>
      </div>

      {/* 3. Last Successful Synchronization & 4. Refresh Control */}
      <div className="mt-3 flex min-w-0 flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <span
          title={lastSynced.title ?? undefined}
          className="min-w-0 text-xs text-[#667085] tabular-nums"
        >
          {lastSynced.label}
        </span>

        <div className="flex shrink-0 items-center gap-3">
          {refreshFeedback === "succeeded" && (
            <span
              role="status"
              className="inline-flex items-center gap-1 text-xs font-medium text-[#067647]"
            >
              <Check className="h-3.5 w-3.5" aria-hidden="true" />
              <span>Refreshed</span>
            </span>
          )}
          {refreshFeedback === "failed" && (
            <span role="status" className="text-xs font-medium text-[#B42318]">
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
              "inline-flex min-h-9 shrink-0 items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium text-[#475467] transition-colors hover:bg-[#F8FAFC] hover:text-[#0F172A] hover:ring-1 hover:ring-[#E4E7EC] disabled:cursor-not-allowed disabled:opacity-55",
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
    </header>
  );
}
