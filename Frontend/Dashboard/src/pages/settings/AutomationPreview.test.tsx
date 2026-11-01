import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { api } from '@/lib/api';
import { useAuthStore } from '@/store/authStore';
import AutomationPreview from './AutomationPreview';

describe('development sample presentation', () => {
  it('renders every sample without accounts, requests or writes', () => {
    const get = vi.spyOn(api, 'get');
    const put = vi.spyOn(api, 'put');
    const post = vi.spyOn(api, 'post');
    const before = useAuthStore.getState();
    render(<MemoryRouter><AutomationPreview /></MemoryRouter>);
    expect(screen.getByLabelText('Emails per customer in 24 hours')).toHaveAttribute('min', '0');
    expect(screen.getByLabelText('Total actions per store in 24 hours')).toHaveAttribute('min', '0');
    expect(screen.getByText('Disabled policy: 0 emails. Future enabled range: 1–10.')).toBeInTheDocument();
    const select = screen.getByLabelText('Sample state');
    for (const state of ['Member', 'Loading stores', 'Store error', 'No store', 'Loading policy', 'Policy error', 'Save failure', 'Saved visual', 'Owner']) {
      fireEvent.change(select, { target: { value: state } });
      for (const retry of screen.queryAllByRole('button', { name: /Retry/ })) fireEvent.click(retry);
    }
    expect(screen.getByRole('button', { name: 'Save automation policy' })).toBeDisabled();
    expect(get).not.toHaveBeenCalled(); expect(put).not.toHaveBeenCalled(); expect(post).not.toHaveBeenCalled();
    expect(useAuthStore.getState()).toBe(before);
    vi.restoreAllMocks();
  });
  it('validates empty, fractional and out-of-range sample inputs with acknowledgement', () => {
    render(<MemoryRouter><AutomationPreview /></MemoryRouter>);
    fireEvent.click(screen.getByRole('switch', { name: 'Recovery authorisation' }));
    expect(screen.getByText('Confirm merchant authorisation before saving an enabled policy.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('checkbox', { name: 'Confirm merchant authorisation' }));
    const limit = screen.getByLabelText('Emails per customer in 24 hours');
    fireEvent.change(limit, { target: { value: '' } });
    expect(screen.getByText('Emails per customer must be a whole number from 1 to 10.')).toBeInTheDocument();
    fireEvent.change(limit, { target: { value: '1.5' } });
    expect(screen.getByText('Emails per customer must be a whole number from 1 to 10.')).toBeInTheDocument();
    fireEvent.change(limit, { target: { value: '2' } });
    fireEvent.click(screen.getByRole('checkbox', { name: 'Percentage discount' }));
    fireEvent.change(screen.getByLabelText('Maximum discount percentage'), { target: { value: '26' } });
    expect(screen.getByText('Discount must be a whole percentage from 1 to 25.')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Maximum discount percentage'), { target: { value: '10' } });
    expect(screen.queryByText(/must be a whole/)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save automation policy' })).toBeDisabled();
  });
});
