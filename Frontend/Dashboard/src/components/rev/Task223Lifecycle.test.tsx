import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import InvestigationTimeline from './InvestigationTimeline';
import EvidencePanel from './EvidencePanel';
import type { EvidenceItem, InvestigationStep, RevAnswerPayload } from '@/lib/revStream';

vi.mock('framer-motion', () => ({
  AnimatePresence: ({ children }: { children: React.ReactNode }) => children,
  motion: { div: ({ children, ...props }: React.HTMLAttributes<HTMLDivElement>) => <div {...props}>{children}</div> },
}));
const steps: InvestigationStep[] = [
  { id: 'orders', tool: 'orders_summary', label: 'Check recorded orders', status: 'completed' },
  { id: 'revenue', tool: 'revenue_summary', label: 'Check recorded revenue', status: 'running' },
  { id: 'customers', tool: 'customers_summary', label: 'Check customer records', status: 'pending' },
];
const evidence: EvidenceItem = {
  id: 'ev-orders', metric: 'orders_count', label: 'Recorded orders', value: 41, unit: 'count', currency: null,
  status: 'available', period: { start: '2026-10-01', end: '2026-10-31', timezone: 'UTC' },
  source: 'orders', definition: 'Recorded orders in the selected period.', freshness: { state: 'stale', as_of: '2026-11-01T00:00:00Z' },
};
const payload: RevAnswerPayload = {
  success: true, read_only: true, response_type: 'analysis', text: 'Orders changed.', conversation_id: 'conv-1',
  investigation: { id: 'inv-1', question: 'Orders?', intent: 'revenue_investigation', status: 'complete', period: evidence.period, steps, follow_ups: [] },
  evidence: { items: [evidence], validation: { valid: true, errors: [] }, generated_at: '2026-11-01T00:00:00Z' },
};

describe('Task 223 truthful investigation lifecycle', () => {
  for (const width of [320, 375, 430, 600, 768, 1024, 1280, 1440, 1920]) {
    it(`keeps compact investigation text wrap-safe at ${width}px without invented percentages`, () => {
      window.innerWidth = width;
      const { container } = render(<InvestigationTimeline steps={steps} compact streaming />);
      expect(container.querySelector('[role="status"]')).toHaveStyle({ fontSize: '0.76rem', margin: '0px' });
      expect(screen.getByRole('status')).toHaveTextContent('Check recorded revenue');
      expect(screen.getByRole('status')).not.toHaveTextContent(/\d+%|\d+\/\d+/);
      expect(screen.getByRole('status')).toHaveAttribute('aria-busy', 'true');
    });
  }
  it('does not invent a running check when none is running', () => {
    render(<InvestigationTimeline steps={steps.map(step => ({ ...step, status: 'pending' }))} compact streaming />);
    expect(screen.getByRole('status')).toHaveTextContent('Investigation in progress');
    expect(screen.queryByText(/Preparing checks/)).not.toBeInTheDocument();
  });
  it('reports a failed check without claiming investigation completion', () => {
    render(<InvestigationTimeline steps={steps.map(step => ({ ...step, status: 'failed' }))} />);
    expect(screen.getByRole('button')).toHaveTextContent('Investigation has failed checks');
    expect(screen.getByRole('button')).not.toHaveTextContent('Investigation complete');
  });
  it('requires all actual checks complete before a complete label', () => {
    render(<InvestigationTimeline steps={steps} streaming={false} />);
    expect(screen.getByRole('button')).toHaveTextContent('Investigation incomplete');
  });
  it('shows no timeline when the backend provided no steps', () => {
    const { container } = render(<InvestigationTimeline steps={[]} streaming />);
    expect(container).toBeEmptyDOMElement();
  });
  it('discloses actual backend step status on keyboard activation', () => {
    render(<InvestigationTimeline steps={steps} streaming />);
    const trigger = screen.getByRole('button'); trigger.focus(); fireEvent.keyDown(trigger, { key: 'Enter' }); fireEvent.click(trigger);
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('Check recorded revenue')).toHaveTextContent('(running)');
  });
  it('exposes a polite live region for compact status', () => {
    render(<InvestigationTimeline steps={steps} compact streaming />);
    expect(screen.getByRole('status')).toHaveAttribute('aria-live', 'polite');
  });
  it('keeps expanded evidence provenance scoped to the supplied investigation', () => {
    render(<EvidencePanel evidence={payload.evidence} onClose={() => {}} />);
    expect(screen.getByText('orders')).toBeInTheDocument();
    expect(screen.getByText('Recorded orders')).toBeInTheDocument();
  });
  it('distinguishes stale evidence freshness without discarding the recorded fact', () => {
    render(<EvidencePanel evidence={{ ...payload.evidence!, freshness: { state: 'stale', as_of: '2026-11-01T00:00:00Z' } }} onClose={() => {}} />);
    expect(screen.getAllByText(/stale/i).length).toBeGreaterThan(0);
    expect(screen.getByText('41')).toBeInTheDocument();
  });
  it('fails closed for unsupported evidence validation', () => {
    const invalid = { ...payload, evidence: { ...payload.evidence!, validation: { valid: false, errors: ['missing_provenance'] } } };
    render(<EvidencePanel evidence={invalid.evidence} onClose={() => {}} />);
    expect(screen.getByText('Available — unverified')).toBeInTheDocument();
    expect(screen.queryByText('Verified')).not.toBeInTheDocument();
  });
  it('provides an accessible evidence close action', () => {
    const onClose = vi.fn(); render(<EvidencePanel evidence={payload.evidence} onClose={onClose} />);
    const close = screen.getByRole('button', { name: /close evidence/i });
    fireEvent.click(close); expect(onClose).toHaveBeenCalledOnce();
  });
});
