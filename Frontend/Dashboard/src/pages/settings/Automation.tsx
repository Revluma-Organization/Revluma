import { useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import {
  AlertCircle,
  Bot,
  CheckCircle2,
  Loader2,
  LockKeyhole,
  Mail,
  Percent,
  Save,
  ShieldCheck,
  Store as StoreIcon,
} from "lucide-react";
import { toast } from "sonner";
import { Link } from "react-router-dom";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { ApiError } from "@/lib/api";
import {
  DISABLED_AUTOMATION_POLICY,
  validateAutomationPolicy,
  getBetaAutomationPolicy,
  listAutomationStores,
  updateBetaAutomationPolicy,
  type AutomationStore,
  type BetaAutomationPolicy,
} from "@/lib/betaAutomation";
import { useAuthStore } from "@/store/authStore";

function errorMessage(error: unknown, fallback: string): string {
  if (error instanceof ApiError) {
    const body = error.body as { error?: string; message?: string } | null;
    return body?.error || body?.message || fallback;
  }
  return error instanceof Error ? error.message : fallback;
}

function numericValue(value: string): number {
  const parsed = Number(value);
  return value.trim() && Number.isFinite(parsed) ? parsed : NaN;
}

function useAutomationController(role: string | undefined) {
  const canManage = role === "owner" || role === "admin";
  const [stores, setStores] = useState<AutomationStore[]>([]);
  const [storeId, setStoreId] = useState("");
  const [policy, setPolicy] = useState<BetaAutomationPolicy>({
    ...DISABLED_AUTOMATION_POLICY,
  });
  const [acknowledged, setAcknowledged] = useState(false);
  const [storesLoading, setStoresLoading] = useState(canManage);
  const [policyLoading, setPolicyLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [storesError, setStoresError] = useState<string | null>(null);
  const [policyError, setPolicyError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [storesAttempt, retryStores] = useState(0);
  const [policyAttempt, retryPolicy] = useState(0);
  const [loadedStoreId, setLoadedStoreId] = useState('');
  const saveInFlight = useRef(false);
  const generation = useRef(0);

  useEffect(() => {
    if (!canManage) return;
    let cancelled = false;
    setStoresLoading(true);
    setStoresError(null);
    setStoreId('');
    setStores([]);
    void listAutomationStores()
      .then((availableStores) => {
        if (cancelled) return;
        setStores(availableStores);
        setStoreId((current) => current || availableStores[0]?.id || "");
      })
      .catch((error) => {
        if (!cancelled) {
          setStoresError(errorMessage(error, "Unable to load connected stores."));
        }
      })
      .finally(() => {
        if (!cancelled) setStoresLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [canManage, storesAttempt]);

  useEffect(() => {
    generation.current += 1;
    setLoadedStoreId('');
    setSaved(false);
    setSaveError(null);
    setPolicyError(null);
    setPolicy({ ...DISABLED_AUTOMATION_POLICY });
    setAcknowledged(false);
    if (!canManage || !storeId) return;
    let cancelled = false;
    setPolicyLoading(true);
    void getBetaAutomationPolicy(storeId)
      .then((loadedPolicy) => {
        if (cancelled) return;
        setPolicy(loadedPolicy);
        setLoadedStoreId(storeId);
        setAcknowledged(false);
      })
      .catch((error) => {
        if (cancelled) return;
        setPolicy({ ...DISABLED_AUTOMATION_POLICY });
        setAcknowledged(false);
        setPolicyError(errorMessage(error, "Unable to load the automation policy."));
      })
      .finally(() => {
        if (!cancelled) setPolicyLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [canManage, storeId, policyAttempt]);

  const setEnabled = (enabled: boolean) => {
    setSaved(false);
    setSaveError(null);
    setPolicy((current) => ({
      ...current,
      enabled,
      kill_switch: !enabled,
      allowed_actions: enabled
        ? Array.from(new Set(["cart_recovery_message", ...current.allowed_actions]))
        : current.allowed_actions,
      allowed_channels: enabled ? ["email"] : current.allowed_channels,
      max_messages_per_customer_24h:
        enabled && current.max_messages_per_customer_24h < 1
          ? 1
          : current.max_messages_per_customer_24h,
      max_actions_per_store_24h:
        enabled && current.max_actions_per_store_24h < 1
          ? 25
          : current.max_actions_per_store_24h,
    }));
    if (!enabled) setAcknowledged(false);
  };

  const setDiscountsEnabled = (enabled: boolean) => {
    setSaved(false);
    setSaveError(null);
    setPolicy((current) => ({
      ...current,
      allowed_actions: enabled
        ? Array.from(new Set([...current.allowed_actions, "percentage_discount"]))
        : current.allowed_actions.filter((action) => action !== "percentage_discount"),
      max_discount_pct: enabled
        ? Math.max(5, current.max_discount_pct)
        : 0,
    }));
  };

  const savePolicy = async () => {
    if (!canManage || !storeId || storesLoading || policyLoading || policyError ||
        loadedStoreId !== storeId || saveInFlight.current) return;
    // Automated recovery is deferred for the MVP. Existing authorisation may be paused.
    if (policy.enabled) return;
    const invalid = validateAutomationPolicy(policy, acknowledged);
    if (invalid) { setSaveError(invalid); return; }
    const requestGeneration = generation.current;
    saveInFlight.current = true;
    setSaveError(null);
    setSaved(false);
    try {
      setSaving(true);
      const saved = await updateBetaAutomationPolicy(storeId, policy);
      if (generation.current !== requestGeneration) return;
      setPolicy(saved);
      setAcknowledged(false);
      setSaved(true);
      toast.success(saved.enabled ? "Store automation authorisation saved." : "Automation paused for this store.");
    } catch (error) {
      if (generation.current === requestGeneration) setSaveError(errorMessage(error, "Unable to save the automation policy."));
    } finally {
      saveInFlight.current = false;
      setSaving(false);
    }
  };

  return {
    canManage, stores, storeId, policy, acknowledged, storesLoading,
    policyLoading: policyLoading || (!!storeId && loadedStoreId !== storeId && !policyError),
    saving, storesError, policyError, saveError, saved,
    setStoreId, setPolicy: (update: Parameters<typeof setPolicy>[0]) => { setSaved(false); setSaveError(null); setPolicy(update); },
    setAcknowledged, setEnabled, setDiscountsEnabled, savePolicy,
    retryStores: () => retryStores(value => value + 1),
    retryPolicy: () => retryPolicy(value => value + 1),
  };
}

export type AutomationPresentationProps = ReturnType<typeof useAutomationController> & { preview?: boolean };

export default function Automation() {
  const role = useAuthStore(state => state.user?.role?.toLowerCase());
  const controller = useAutomationController(role);
  return <AutomationPresentation {...controller} />;
}

export function AutomationPresentation({
  canManage, stores, storeId, policy, acknowledged, storesLoading, policyLoading,
  saving, storesError, policyError, saveError, saved, setStoreId, setPolicy,
  setAcknowledged, setEnabled, setDiscountsEnabled, savePolicy, retryStores, retryPolicy, preview = false,
}: AutomationPresentationProps) {
  if (!canManage) {
    return (
      <div className="space-y-6">
        <header>
          <h1 className="text-2xl font-bold tracking-tight text-t1">Automation</h1>
          <p className="mt-1 text-sm text-t3">Review recovery policy settings.</p>
        </header>
        <div className="rounded-2xl border border-border bg-bg-2 p-8 text-center">
          <LockKeyhole className="mx-auto h-8 w-8 text-t3" />
          <h2 className="mt-4 font-semibold text-t1">Owner or admin access required</h2>
          <p className="mt-2 text-sm text-t3">
            Only workspace owners and administrators can manage recovery policies.
          </p>
        </div>
      </div>
    );
  }

  const discountsEnabled = policy.allowed_actions.includes("percentage_discount");
  const selectedStore = stores.find((store) => store.id === storeId);
  const busy = storesLoading || policyLoading;

  return (
    <div className="w-full max-w-4xl space-y-6 pb-12">
      <header className="border-b border-border pb-6">
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl border border-[hsl(var(--accent)/0.25)] bg-[hsl(var(--accent)/0.1)]">
            <Bot className="h-5 w-5 text-[hsl(var(--accent))]" />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-t1">Recovery Automation</h1>
            <p className="mt-1 text-sm text-t3">
              Automated recovery is deferred. Review policy settings or pause existing authorisation.
            </p>
          </div>
        </div>
      </header>

      <div role="note" className="rounded-xl border border-border bg-bg-3 p-4 text-sm text-t2">
        Shopify-only MVP: automated emails and coupons are deferred. New automation cannot be enabled here.
      </div>
      {storesLoading ? (
        <div className="flex min-h-48 items-center justify-center rounded-2xl border border-border bg-bg-2">
          <Loader2 className="h-5 w-5 animate-spin text-t3" aria-label="Loading connected stores" />
        </div>
      ) : storesError ? (
        <div role="alert" className="rounded-xl border border-red-500/30 bg-bg-2 p-6 text-t1">
          <p>{storesError}</p><p className="mt-2 text-sm text-t2">Store connection status is unavailable.</p>
          <Button onClick={retryStores} className="mt-4">Retry stores</Button>
        </div>
      ) : stores.length === 0 ? (
        <div className="rounded-2xl border border-amber-500/20 bg-amber-500/10 p-6">
          <div className="flex items-start gap-3">
            <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-amber-500" />
            <div>
              <h2 className="font-semibold text-t1">Connect an active store first</h2>
              <p className="mt-1 text-sm text-t2">
                Policies belong to an active Shopify store.
              </p>
              <Link className="mt-4 inline-flex font-semibold text-t1 underline" to="/dashboard/integrations">Open Integrations</Link>
            </div>
          </div>
        </div>
      ) : (
        <>
          <motion.section
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            className="rounded-2xl border border-border bg-bg-2 p-6 shadow-sm"
          >
            <Label htmlFor="automation-store" className="text-sm font-semibold text-t1">
              Connected store
            </Label>
            <Select value={storeId} onValueChange={setStoreId} disabled={saving}>
              <SelectTrigger id="automation-store" className="mt-3 h-11 border-border bg-bg-3 text-t1">
                <SelectValue placeholder="Select a store" />
              </SelectTrigger>
              <SelectContent>
                {stores.map((store) => (
                  <SelectItem key={store.id} value={store.id}>
                    {store.shop_domain || store.platform} · {store.platform}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </motion.section>

          {policyLoading ? (
            <div role="status" className="rounded-xl border border-border bg-bg-2 p-8 text-t2">Loading store policy…</div>
          ) : policyError ? (
            <div role="alert" className="rounded-xl border border-red-500/30 bg-bg-2 p-6 text-t1">
              <p>{policyError}</p><Button onClick={retryPolicy} className="mt-4">Retry policy</Button>
            </div>
          ) : <>
          <motion.section
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.05 }}
            className="rounded-2xl border border-border bg-bg-2 p-6 shadow-sm"
          >
            <div className="flex items-start justify-between gap-6">
              <div>
                <div className="flex items-center gap-2">
                  <StoreIcon className="h-4 w-4 text-[hsl(var(--accent))]" />
                  <h2 className="font-semibold text-t1">Recovery authorisation</h2>
                </div>
                <p className="mt-2 max-w-xl text-sm leading-relaxed text-t3">
                  Policy for {selectedStore?.shop_domain || "this store"}. Automated recovery remains deferred for the MVP.
                </p>
              </div>
              <Switch
                checked={policy.enabled}
                onCheckedChange={setEnabled}
                disabled={busy || saving || (!preview && !policy.enabled)}
                aria-label="Recovery authorisation"
              />
            </div>
            <div className={`mt-4 rounded-xl border p-3 text-sm ${
              policy.enabled
                ? "border-emerald-500/20 bg-emerald-500/10 text-emerald-600 dark:text-emerald-300"
                : "border-border bg-bg-3 text-t3"
            }`}>
              <div className="flex items-center gap-2">
                {policy.enabled ? <CheckCircle2 className="h-4 w-4" /> : <ShieldCheck className="h-4 w-4" />}
                {policy.enabled ? "Existing authorisation recorded; recovery is deferred" : "Policy disabled; recovery remains deferred"}
              </div>
            </div>
          </motion.section>

          <motion.section
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            className="rounded-2xl border border-border bg-bg-2 p-6 shadow-sm"
          >
            <h2 className="font-semibold text-t1">Allowed actions</h2>
            <p className="mt-1 text-sm text-t3">Retained policy settings for future recovery support.</p>

            <div className="mt-5 space-y-4">
              <div className="flex items-start gap-3 rounded-xl border border-border bg-bg-3 p-4">
                <Checkbox id="recovery-email" checked={policy.enabled} disabled />
                <div>
                  <Label htmlFor="recovery-email" className="flex items-center gap-2 font-medium text-t1">
                    <Mail className="h-4 w-4" /> Cart-recovery email
                  </Label>
                  <p className="mt-1 text-xs leading-relaxed text-t3">
                    Deferred. Any future email recovery requires recorded shopper marketing consent.
                  </p>
                </div>
              </div>

              <div className="flex items-start gap-3 rounded-xl border border-border bg-bg-3 p-4">
                <Checkbox
                  id="percentage-discount"
                  checked={discountsEnabled}
                  onCheckedChange={(value) => setDiscountsEnabled(value === true)}
                  disabled={!preview || !policy.enabled || busy || saving}
                />
                <div className="flex-1">
                  <Label htmlFor="percentage-discount" className="flex items-center gap-2 font-medium text-t1">
                    <Percent className="h-4 w-4" /> Percentage discount
                  </Label>
                  <p className="mt-1 text-xs leading-relaxed text-t3">
                    Deferred Shopify percentage-discount policy. No coupon actions run from this page.
                  </p>
                  {discountsEnabled && (
                    <div className="mt-4 max-w-xs">
                      <Label htmlFor="max-discount" className="text-xs font-semibold text-t2">
                        Maximum discount percentage
                      </Label>
                      <Input
                        id="max-discount"
                        type="number"
                        min={1}
                        max={25}
                        value={Number.isNaN(policy.max_discount_pct) ? "" : policy.max_discount_pct}
                        onChange={(event) => setPolicy((current) => ({
                          ...current,
                          max_discount_pct: numericValue(event.target.value),
                        }))}
                        disabled={!preview || !policy.enabled || busy || saving}
                        className="mt-2 bg-bg-2"
                      />
                      <p className="mt-1 text-xs text-t3">The Backend enforces a hard maximum of 25%.</p>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </motion.section>

          <motion.section
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.15 }}
            className="rounded-2xl border border-border bg-bg-2 p-6 shadow-sm"
          >
            <h2 className="font-semibold text-t1">Safety limits</h2>
            <p className="mt-1 text-sm text-t3">Policy limits are validated before saving. Automated sending is deferred.</p>
            <div className="mt-5 grid gap-5 sm:grid-cols-2">
              <div>
                <Label htmlFor="customer-limit" className="text-sm font-medium text-t2">
                  Emails per customer in 24 hours
                </Label>
                <Input
                  id="customer-limit"
                  type="number"
                  min={policy.enabled ? 1 : 0}
                  max={10}
                  value={Number.isNaN(policy.max_messages_per_customer_24h) ? "" : policy.max_messages_per_customer_24h}
                  onChange={(event) => setPolicy((current) => ({
                    ...current,
                    max_messages_per_customer_24h: numericValue(event.target.value),
                  }))}
                  disabled={!preview || !policy.enabled || busy || saving}
                  className="mt-2 bg-bg-3"
                />
                <p className="mt-1 text-xs text-t3">{policy.enabled ? "Allowed range: 1–10." : "Disabled policy: 0 emails. Future enabled range: 1–10."}</p>
              </div>
              <div>
                <Label htmlFor="store-limit" className="text-sm font-medium text-t2">
                  Total actions per store in 24 hours
                </Label>
                <Input
                  id="store-limit"
                  type="number"
                  min={policy.enabled ? 1 : 0}
                  max={1000}
                  value={Number.isNaN(policy.max_actions_per_store_24h) ? "" : policy.max_actions_per_store_24h}
                  onChange={(event) => setPolicy((current) => ({
                    ...current,
                    max_actions_per_store_24h: numericValue(event.target.value),
                  }))}
                  disabled={!preview || !policy.enabled || busy || saving}
                  className="mt-2 bg-bg-3"
                />
                <p className="mt-1 text-xs text-t3">{policy.enabled ? "Allowed range: 1–1,000." : "Disabled policy: 0 actions. Future enabled range: 1–1,000."}</p>
              </div>
            </div>
          </motion.section>

          {policy.enabled && (
            <section className="rounded-2xl border border-amber-500/25 bg-amber-500/10 p-5">
              <div className="flex items-start gap-3">
                <Checkbox
                  id="automation-authorization"
                  checked={acknowledged}
                  onCheckedChange={(value) => setAcknowledged(value === true)}
                  disabled={!preview || saving}
                  className="mt-0.5"
                />
                <div>
                  <Label htmlFor="automation-authorization" className="font-semibold text-t1">
                    Confirm merchant authorisation
                  </Label>
                  <p className="mt-1 text-sm leading-relaxed text-t2">
                    Future recovery requires merchant authorisation within these limits and separate
                    shopper marketing consent. Recovery remains deferred.
                  </p>
                </div>
              </div>
            </section>
          )}

          {validateAutomationPolicy(policy, acknowledged) && <p role="status" className="text-sm text-t2">{validateAutomationPolicy(policy, acknowledged)}</p>}
          {saveError && <p role="alert" className="text-sm text-red-700 dark:text-red-300">{saveError} Review the form and try saving again.</p>}
          {saved && <p role="status" className="text-sm text-emerald-700 dark:text-emerald-300">{preview ? 'Sample saved visual — no changes were saved.' : 'Automation policy saved.'}</p>}
          <div className="flex justify-end">
            <Button
              type="button"
              onClick={savePolicy}
              disabled={preview || busy || saving || !storeId || (!preview && policy.enabled) || !!validateAutomationPolicy(policy, acknowledged)}
              className="h-11 min-w-44 bg-sky-600 text-white hover:bg-sky-500"
            >
              {saving ? <Loader2 className="animate-spin" /> : <Save />}
              {saving ? "Saving..." : "Save automation policy"}
            </Button>
          </div>
          </>}
        </>
      )}
    </div>
  );
}
