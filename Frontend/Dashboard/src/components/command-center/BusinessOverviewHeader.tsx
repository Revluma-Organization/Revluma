import {
  ArrowUpRight,
  Calendar,
  Check,
  ChevronDown,
  ChevronsUpDown,
  Clock3,
  Globe,
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
import {
  REPORTING_PERIOD_OPTIONS,
  resolveConnectionStatus,
  resolveLastUpdate,
  resolveReportingContext,
  resolveStoreList,
  storeDisplayName,
  storeSecondaryDomain,
  type ConciseConnectionStatus,
  type ConnectionTone,
  type ReportingPeriodKey,
} from "@/lib/overviewReporting";
import { cn } from "@/lib/utils";
import type { CommandCenterData } from "./types";

export interface BusinessOverviewHeaderProps {
  data: CommandCenterData | null;
  refreshing: boolean;
  lastSuccessfulAt?: string | null;
  selectedPeriod?: ReportingPeriodKey;
  onRefresh: () => void;
  onSelectStore?: (storeId: string) => void;
  onSelectPeriod?: (period: ReportingPeriodKey) => void;
}

const FOCUS_RING =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1F06AC] focus-visible:ring-offset-2";

const CONNECTION_PILL_STYLES: Record<
  ConnectionTone,
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
    pill: "border-[#E2E8F0] bg-[#F8FAFC] text-[#475467]",
    dot: "bg-[#94A3B8]",
  },
};

function ConnectionStatusBadge({
  status,
  inRouter,
}: {
  status: ConciseConnectionStatus;
  inRouter: boolean;
}) {
  const style = CONNECTION_PILL_STYLES[status.tone];
  const inner = (
    <>
      <span
        aria-hidden="true"
        className={cn(
          "h-2 w-2 shrink-0 rounded-full",
          style.dot,
          style.pulse && "animate-pulse motion-reduce:animate-none",
        )}
      />
      <span>{status.label}</span>
      {status.needsAttention && status.actionHref && (
        <ArrowUpRight className="h-3 w-3 shrink-0 opacity-75" aria-hidden="true" />
      )}
    </>
  );

  const sharedClass = cn(
    "inline-flex min-h-8 shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors",
    style.pill,
  );

  if (status.needsAttention && status.actionHref) {
    if (inRouter) {
      return (
        <Link
          to={status.actionHref}
          title={status.description}
          className={cn(sharedClass, "hover:brightness-95", FOCUS_RING)}
        >
          {inner}
        </Link>
      );
    }
    return (
      <a
        href={status.actionHref}
        title={status.description}
        className={cn(sharedClass, "hover:brightness-95", FOCUS_RING)}
      >
        {inner}
      </a>
    );
  }

  return (
    <span title={status.description} className={sharedClass}>
      {inner}
    </span>
  );
}

function StoreSwitcher({
  data,
  inRouter,
  onSelectStore,
}: {
  data: CommandCenterData | null;
  inRouter: boolean;
  onSelectStore?: (storeId: string) => void;
}) {
  const stores = resolveStoreList(data);
  const activeStore = data?.context.store ?? null;
  const activeName = storeDisplayName(activeStore);
  const activeDomain = storeSecondaryDomain(activeStore);

  if (inRouter) {
    return (
      <RouterStoreSwitcherMenu
        activeStore={activeStore}
        activeName={activeName}
        activeDomain={activeDomain}
        stores={stores}
        onSelectStore={onSelectStore}
      />
    );
  }

  return (
    <div className="inline-flex min-h-10 min-w-0 max-w-full items-center gap-2 rounded-lg px-2 py-1.5">
      <span
        aria-hidden="true"
        className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-[#EEF0FF] text-[#1F06AC]"
      >
        <Store className="h-3.5 w-3.5" />
      </span>
      <span className="min-w-0 truncate text-[13px] font-semibold text-[#0F172A]">
        {activeName}
      </span>
    </div>
  );
}

function RouterStoreSwitcherMenu({
  activeStore,
  activeName,
  activeDomain,
  stores,
  onSelectStore,
}: {
  activeStore: CommandCenterData["context"]["store"];
  activeName: string;
  activeDomain: string | null;
  stores: ReturnType<typeof resolveStoreList>;
  onSelectStore?: (storeId: string) => void;
}) {
  const navigate = useNavigate();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={`Switch store, current store: ${activeName}`}
          title={activeDomain ? `${activeName} (${activeDomain})` : activeName}
          className={cn(
            "inline-flex min-h-10 min-w-0 max-w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-[#F4F6FA]",
            FOCUS_RING,
          )}
        >
          <span
            aria-hidden="true"
            className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-[#EEF0FF] text-[#1F06AC]"
          >
            <Store className="h-3.5 w-3.5" />
          </span>
          <span className="min-w-0 max-w-[200px] truncate text-[13px] font-semibold text-[#0F172A] sm:max-w-[260px]">
            {activeName}
          </span>
          <ChevronsUpDown className="h-3.5 w-3.5 shrink-0 text-[#64748B]" aria-hidden="true" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        sideOffset={6}
        className="w-72 rounded-xl border border-[#DFE4EC] bg-white p-1.5 text-[#0F172A] shadow-[0_12px_32px_rgba(15,23,42,0.12)]"
      >
        <DropdownMenuLabel className="px-2.5 py-1.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-[#526071]">
          Connected stores
        </DropdownMenuLabel>
        {stores.length > 0 ? (
          stores.map((store) => {
            const isSelected = activeStore?.id === store.id;
            const label = storeDisplayName(store);
            const domain = storeSecondaryDomain(store);
            const storeStatus = store.connection_status
              ? resolveConnectionStatus(null, store.connection_status)
              : null;
            return (
              <DropdownMenuItem
                key={store.id}
                onSelect={() => {
                  if (!isSelected) onSelectStore?.(store.id);
                }}
                className={cn(
                  "flex cursor-pointer items-center justify-between gap-2.5 rounded-lg px-2.5 py-2 text-xs focus:bg-[#F4F6FA] focus:text-[#0F172A]",
                  isSelected && "bg-[#F5F7FF]",
                )}
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span className="truncate font-semibold text-[#0F172A]">{label}</span>
                    {storeStatus && (
                      <span
                        aria-hidden="true"
                        className={cn(
                          "h-1.5 w-1.5 shrink-0 rounded-full",
                          CONNECTION_PILL_STYLES[storeStatus.tone].dot,
                        )}
                      />
                    )}
                  </div>
                  {(domain || store.iana_timezone) && (
                    <p className="mt-0.5 truncate text-[11px] text-[#526071]">
                      {[domain, store.iana_timezone].filter(Boolean).join(" · ")}
                    </p>
                  )}
                </div>
                {isSelected && (
                  <Check className="h-3.5 w-3.5 shrink-0 text-[#1F06AC]" aria-hidden="true" />
                )}
              </DropdownMenuItem>
            );
          })
        ) : (
          <div className="px-2.5 py-2 text-xs text-[#526071]">
            No Shopify store is connected to this workspace yet.
          </div>
        )}
        <DropdownMenuSeparator className="my-1.5 bg-[#E7EBF2]" />
        <DropdownMenuItem
          onSelect={() => navigate("/dashboard/integrations")}
          className="flex cursor-pointer items-center gap-2 rounded-lg px-2.5 py-2 text-xs font-medium text-[#1F06AC] focus:bg-[#F5F7FF] focus:text-[#1F06AC]"
        >
          <Settings2 className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <span>{stores.length > 0 ? "Manage stores in Integrations" : "Connect a Shopify store"}</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function ReportingPeriodControl({
  data,
  selectedPeriod,
  onSelectPeriod,
}: {
  data: CommandCenterData | null;
  selectedPeriod?: ReportingPeriodKey;
  onSelectPeriod?: (period: ReportingPeriodKey) => void;
}) {
  const reporting = resolveReportingContext(data, selectedPeriod);
  const canSwitchPeriod = Boolean(onSelectPeriod && (data?.business_health || data?.context?.store));
  const timezoneTooltip = reporting.timezone.verified
    ? `Verified Shopify store timezone: ${reporting.timezone.iana}`
    : `Reporting timezone: ${reporting.timezone.iana}`;

  const readout = (
    <>
      <Calendar className="h-3.5 w-3.5 shrink-0 text-[#526071]" aria-hidden="true" />
      <span className="font-semibold text-[#0F172A]">{reporting.periodLabel}</span>
      {reporting.dateRangeLabel && (
        <span className="hidden text-[#526071] tabular-nums sm:inline">
          {reporting.dateRangeLabel}
        </span>
      )}
      <span
        title={timezoneTooltip}
        className="rounded-md bg-[#F1F5F9] px-1.5 py-0.5 text-[11px] font-medium text-[#475467]"
      >
        {reporting.timezone.label}
      </span>
    </>
  );

  if (!canSwitchPeriod) {
    return (
      <div
        title={timezoneTooltip}
        className="inline-flex min-h-10 min-w-0 flex-wrap items-center gap-1.5 rounded-lg px-2 py-1.5 text-xs"
      >
        {readout}
      </div>
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={`Reporting period: ${reporting.periodLabel}, timezone ${reporting.timezone.iana}`}
          title={timezoneTooltip}
          className={cn(
            "inline-flex min-h-10 min-w-0 flex-wrap items-center gap-1.5 rounded-lg px-2 py-1.5 text-xs transition-colors hover:bg-[#F4F6FA]",
            FOCUS_RING,
          )}
        >
          {readout}
          <ChevronDown className="h-3.5 w-3.5 shrink-0 text-[#64748B]" aria-hidden="true" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        sideOffset={6}
        className="w-64 rounded-xl border border-[#DFE4EC] bg-white p-1.5 text-[#0F172A] shadow-[0_12px_32px_rgba(15,23,42,0.12)]"
      >
        <DropdownMenuLabel className="px-2.5 py-1.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-[#526071]">
          Reporting period
        </DropdownMenuLabel>
        {REPORTING_PERIOD_OPTIONS.map((option) => {
          const active = reporting.periodKey === option.value;
          return (
            <DropdownMenuItem
              key={option.value}
              onSelect={() => {
                if (!active) onSelectPeriod?.(option.value);
              }}
              className={cn(
                "flex cursor-pointer items-center justify-between gap-2 rounded-lg px-2.5 py-2 text-xs focus:bg-[#F4F6FA] focus:text-[#0F172A]",
                active && "bg-[#F5F7FF]",
              )}
            >
              <div>
                <p className="font-semibold text-[#0F172A]">{option.label}</p>
                <p className="text-[11px] text-[#526071]">{option.comparisonLabel}</p>
              </div>
              {active && <Check className="h-3.5 w-3.5 shrink-0 text-[#1F06AC]" aria-hidden="true" />}
            </DropdownMenuItem>
          );
        })}
        <DropdownMenuSeparator className="my-1.5 bg-[#E7EBF2]" />
        <div className="flex items-start gap-2 px-2.5 py-1.5 text-[11px] leading-4 text-[#526071]">
          <Globe className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#64748B]" aria-hidden="true" />
          <div>
            <p className="font-medium text-[#334155]">
              {reporting.timezone.verified ? "Shopify store timezone" : "Reporting timezone"}
            </p>
            <p className="mt-0.5">{reporting.timezone.iana}</p>
          </div>
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function BusinessOverviewHeader({
  data,
  refreshing,
  lastSuccessfulAt,
  selectedPeriod,
  onRefresh,
  onSelectStore,
  onSelectPeriod,
}: BusinessOverviewHeaderProps) {
  const inRouter = useInRouterContext();
  const reporting = resolveReportingContext(data, selectedPeriod);
  const connection = resolveConnectionStatus(data);
  const lastUpdate = resolveLastUpdate(
    data,
    lastSuccessfulAt,
    refreshing,
    reporting.timezone.iana,
  );

  return (
    <header aria-labelledby="business-overview-heading" className="space-y-4">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <h1
            id="business-overview-heading"
            className="text-[1.75rem] font-semibold leading-[1.15] tracking-[-0.03em] text-[#0F172A] sm:text-[2rem]"
          >
            Your business at a glance.
          </h1>
          <p className="mt-1.5 max-w-2xl text-sm leading-6 text-[#475467]">
            Understand your store&apos;s performance, discover what needs attention, and see what
            Revluma knows about your business.
          </p>
        </div>

        <button
          type="button"
          onClick={onRefresh}
          disabled={refreshing}
          aria-label={refreshing ? "Refreshing…" : "Refresh briefing"}
          className={cn(
            "inline-flex min-h-11 shrink-0 items-center justify-center gap-2 self-start rounded-lg border border-[#CFD6E2] bg-white px-3.5 text-xs font-semibold text-[#1E293B] shadow-[0_1px_2px_rgba(15,23,42,0.05)] transition-colors hover:border-[#94A3B8] hover:bg-[#F8FAFC] disabled:cursor-not-allowed disabled:opacity-60 sm:self-auto",
            FOCUS_RING,
          )}
        >
          <RefreshCw
            className={cn(
              "h-3.5 w-3.5 text-[#475467]",
              refreshing && "animate-spin motion-reduce:animate-none",
            )}
            aria-hidden="true"
          />
          <span>{refreshing ? "Refreshing…" : "Refresh"}</span>
        </button>
      </div>

      <div
        role="region"
        aria-label="Store and reporting context"
        className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-2 rounded-xl border border-[#DFE4EC] bg-white px-2.5 py-2 shadow-[0_1px_2px_rgba(15,23,42,0.04)]"
      >
        <StoreSwitcher
          data={data}
          inRouter={inRouter}
          onSelectStore={onSelectStore}
        />

        <span aria-hidden="true" className="hidden h-5 w-px bg-[#E5E9F0] sm:block" />

        <ConnectionStatusBadge status={connection} inRouter={inRouter} />

        <span aria-hidden="true" className="hidden h-5 w-px bg-[#E5E9F0] sm:block" />

        <ReportingPeriodControl
          data={data}
          selectedPeriod={selectedPeriod}
          onSelectPeriod={onSelectPeriod}
        />

        <span
          title={lastUpdate.title ?? undefined}
          className="inline-flex min-h-8 items-center gap-1.5 px-2 py-1 text-xs text-[#526071] tabular-nums lg:ml-auto"
        >
          <Clock3 className="h-3.5 w-3.5 shrink-0 text-[#64748B]" aria-hidden="true" />
          <span>{lastUpdate.label}</span>
        </span>
      </div>
    </header>
  );
}
