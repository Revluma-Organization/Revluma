import { useState } from 'react';
import { AutomationPresentation, type AutomationPresentationProps } from './Automation';
import { DISABLED_AUTOMATION_POLICY, type BetaAutomationPolicy } from '@/lib/betaAutomation';

const scenarios = ['Owner', 'Member', 'Loading stores', 'Store error', 'No store', 'Loading policy', 'Policy error', 'Save failure', 'Saved visual'] as const;
type Scenario = typeof scenarios[number];

export default function AutomationPreview() {
  const [scenario, setScenario] = useState<Scenario>('Owner');
  return <div className="mx-auto max-w-4xl p-6">
    <aside className="mb-6 rounded-xl border border-amber-500/30 bg-bg-2 p-4 text-t1">
      <p className="font-semibold">Development preview — sample data only</p>
      <p className="mt-1 text-sm text-t2">No account, Shopify connection or policy is created. Save controls never perform writes.</p>
      <label htmlFor="automation-scenario" className="mt-3 block text-sm">Sample state</label>
      <select id="automation-scenario" value={scenario} onChange={event => setScenario(event.target.value as Scenario)} className="mt-2 rounded border border-border bg-bg-3 p-2 text-t1">
        {scenarios.map(value => <option key={value}>{value}</option>)}
      </select>
    </aside>
    <SamplePresentation key={scenario} scenario={scenario} />
  </div>;
}

function SamplePresentation({ scenario }: { scenario: Scenario }) {
  const [policy, setPolicy] = useState<BetaAutomationPolicy>({ ...DISABLED_AUTOMATION_POLICY });
  const [acknowledged, setAcknowledged] = useState(false);
  const sampleStore = { id: 'sample-only', platform: 'shopify', shop_domain: 'sample-store.myshopify.com', status: 'active' };
  const props: AutomationPresentationProps = {
    preview: true,
    canManage: scenario !== 'Member',
    stores: scenario === 'No store' ? [] : [sampleStore],
    storeId: sampleStore.id,
    policy, acknowledged,
    storesLoading: scenario === 'Loading stores', policyLoading: scenario === 'Loading policy', saving: false,
    storesError: scenario === 'Store error' ? 'Sample: store request failed.' : null,
    policyError: scenario === 'Policy error' ? 'Sample: policy request failed.' : null,
    saveError: scenario === 'Save failure' ? 'Sample: policy save failed.' : null,
    saved: scenario === 'Saved visual',
    setStoreId: () => {}, setPolicy, setAcknowledged,
    setEnabled: enabled => { setPolicy(current => ({ ...current, enabled, kill_switch: !enabled, allowed_actions: enabled ? ['cart_recovery_message'] : [], allowed_channels: enabled ? ['email'] : [], max_messages_per_customer_24h: enabled ? 1 : 0, max_actions_per_store_24h: enabled ? 25 : 0 })); setAcknowledged(false); },
    setDiscountsEnabled: enabled => setPolicy(current => ({ ...current, allowed_actions: enabled ? ['cart_recovery_message', 'percentage_discount'] : ['cart_recovery_message'], max_discount_pct: enabled ? 5 : 0 })),
    savePolicy: async () => {}, retryStores: () => {}, retryPolicy: () => {},
  };
  return <AutomationPresentation {...props} />;
}
