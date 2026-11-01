import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { waitFor } from '@testing-library/react';

const source = readFileSync('../assets/js/auth-client.js', 'utf8');
const page = (name: string) => readFileSync(`../auth/${name}.html`, 'utf8');
let dom: JSDOM;
let request: ReturnType<typeof vi.fn>;
const reply = (success = true, status = 200) => ({ ok: status < 400, status, json: async () => ({ success, message: 'Server-confirmed response', error: success ? undefined : 'Code rejected' }) });
async function load(name = 'login') {
  dom = new JSDOM(page(name), { url: `http://localhost/auth/${name}.html`, runScripts: 'outside-only' });
  await new Promise<void>(resolve => dom.window.document.addEventListener('DOMContentLoaded', () => resolve(), { once: true }));
  dom.window.REVLUMA_API_BASE = 'https://api.example.test/api/v1';
  dom.window.fetch = request;
  dom.window.console = { ...console, log() {}, info() {}, warn() {}, error() {} };
  dom.window.eval(source);
  dom.window.showGlassmorphismCard = vi.fn(); dom.window.hideGlassmorphismCard = vi.fn();
}

describe('static authentication requests', () => {
  beforeEach(() => { request = vi.fn().mockResolvedValue(reply()); });
  afterEach(() => { dom?.window.close(); });
  it('verification and resend use configured endpoints and never create sessions', async () => {
    await load();
    await dom.window.revlumaAuth.verifyEmail('person@example.test', '123456');
    expect(request).toHaveBeenNthCalledWith(1, 'https://api.example.test/api/v1/auth/verify-email', expect.objectContaining({ credentials: 'include', body: JSON.stringify({ email: 'person@example.test', code: '123456' }) }));
    await dom.window.revlumaAuth.resendVerification('person@example.test');
    expect(request).toHaveBeenNthCalledWith(2, 'https://api.example.test/api/v1/auth/resend-verification', expect.objectContaining({ body: JSON.stringify({ email: 'person@example.test' }) }));
    expect(dom.window.localStorage.getItem('rv-auth')).toBeNull();
  });
  it.each([200, 400])('propagates backend verification and resend failure (HTTP %s)', async status => {
    await load(); request.mockResolvedValue(reply(false, status));
    await expect(dom.window.revlumaAuth.verifyEmail('person@example.test', '000000')).rejects.toThrow('Code rejected');
    await expect(dom.window.revlumaAuth.resendVerification('person@example.test')).rejects.toThrow('Code rejected');
    expect(dom.window.localStorage.getItem('rv-auth')).toBeNull();
  });
  it('does not claim success when the network fails', async () => {
    await load(); request.mockRejectedValue(new Error('offline'));
    await expect(dom.window.revlumaAuth.resendVerification('person@example.test')).rejects.toThrow('offline');
  });
  it('reachable login verification and resend handlers perform real requests', async () => {
    await load();
    const script = Array.from(dom.window.document.scripts as HTMLCollectionOf<HTMLScriptElement>).find(script => script.textContent.includes('async function apiVerifyCode'))!;
    dom.window.eval(script.textContent);
    dom.window.showVerifySection('person@example.test');
    const document = dom.window.document;
    document.getElementById('verifyCode').value = '123456';
    document.getElementById('verifyBtn').click();
    await waitFor(() => expect(request).toHaveBeenCalledWith(expect.stringContaining('/auth/verify-email'), expect.anything()));
    await waitFor(() => expect(document.getElementById('verifySection').classList.contains('show')).toBe(false));
    const resend = document.getElementById('resendBtn'); resend.disabled = false; resend.click();
    await waitFor(() => expect(request).toHaveBeenCalledWith(expect.stringContaining('/auth/resend-verification'), expect.anything()));
    expect(dom.window.localStorage.getItem('rv-auth')).toBeNull();
  });
  it('dedicated verification sends the entered code and waits for confirmation', async () => {
    await load('verifyemail');
    dom.window.localStorage.setItem('signup_email', 'person@example.test');
    dom.window.loadGlassmorphismCard = async () => true;
    const script = Array.from(dom.window.document.scripts as HTMLCollectionOf<HTMLScriptElement>).find(script => script.textContent.includes('const API_BASE'))!;
    dom.window.eval(script.textContent);
    dom.window.document.dispatchEvent(new dom.window.Event('DOMContentLoaded'));
    await waitFor(() => expect(dom.window.document.getElementById('displayEmail').textContent).toBe('person@example.test'));
    for (const input of dom.window.document.querySelectorAll('.code-box')) input.value = '1';
    request.mockResolvedValue(reply(false, 400));
    dom.window.document.getElementById('verifyForm').dispatchEvent(new dom.window.Event('submit', { cancelable: true }));
    await waitFor(() => expect(dom.window.document.getElementById('codeError').textContent).toBe('Code rejected'));
    expect(dom.window.showGlassmorphismCard).not.toHaveBeenCalledWith('success', expect.anything(), expect.anything(), expect.anything(), expect.anything());
    expect(dom.window.localStorage.getItem('rv-auth')).toBeNull();
  });
  it('signup uses the registration API and preserves its failure', async () => {
    await load('signup'); request.mockResolvedValue(reply(false, 409));
    await expect(dom.window.revlumaAuth.register({ account: { email: 'existing@example.test' } })).rejects.toThrow();
    expect(request.mock.calls[0][0]).toBe('https://api.example.test/api/v1/auth/register');
    expect(dom.window.localStorage.getItem('rv-auth')).toBeNull();
    expect(page('signup')).toContain('await window.revlumaAuth.register(payload)');
    for (const name of ['login', 'signup', 'verifyemail']) expect(page(name)).not.toMatch(/mock-token|mock-user|return \{ success: true, message: 'Verification code sent'/);
  });
});
