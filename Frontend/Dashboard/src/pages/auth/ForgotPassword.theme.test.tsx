import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import ForgotPassword from './ForgotPassword';
import { api } from '@/lib/api';

vi.mock('@/lib/api', () => ({ api: { post: vi.fn(() => { throw new Error('Network forbidden in theme tests'); }) } }));
afterEach(() => { cleanup(); document.documentElement.className = ''; vi.clearAllMocks(); });

describe('React password recovery appearance', () => {
  it.each(['light', 'dark'])('keeps the form and validation readable in %s without making requests', mode => {
    document.documentElement.className = mode;
    const view = render(<ForgotPassword />);
    const page = view.container.querySelector('.recovery-page')!;
    const input = screen.getByPlaceholderText('you@example.com');
    expect(getComputedStyle(page).backgroundColor).toBe(mode === 'light' ? 'rgb(248, 250, 252)' : 'rgb(6, 6, 8)');
    expect(getComputedStyle(input).color).toBe(mode === 'light' ? 'rgb(23, 32, 51)' : 'rgb(240, 240, 245)');
    fireEvent.submit(view.container.querySelector('form')!);
    expect(screen.getByRole('alert')).toHaveTextContent('Please enter your email address');
    expect(getComputedStyle(screen.getByRole('alert')).color).toBe(mode === 'light' ? 'rgb(185, 28, 28)' : 'rgb(252, 165, 165)');
    expect(api.post).not.toHaveBeenCalled();
  });
});
