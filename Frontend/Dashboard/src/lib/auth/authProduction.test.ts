import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { createHash, webcrypto } from 'node:crypto';
import { JSDOM } from 'jsdom';
import { waitFor } from '@testing-library/react';

const client = readFileSync('../assets/js/auth-client.js', 'utf8');
const appleButton = readFileSync('../assets/js/auth-apple.js', 'utf8');
const page = (name: string) => readFileSync(`../auth/${name}.html`, 'utf8');
const API = 'https://api.example.test/api/v1';

type Call = [string, RequestInit | undefined];
let dom: JSDOM;
let request: ReturnType<typeof vi.fn>;
const json = (body: unknown, status = 200) => ({ ok: status < 400, status, json: async () => body, text: async () => '' });
const calls = () => request.mock.calls as Call[];
const callTo = (suffix: string) => calls().filter(([url]) => url.endsWith(suffix));
const bodyOf = (call: Call) => JSON.parse(String(call[1]?.body || '{}'));

async function load(name: string, { token = '' } = {}) {
  dom = new JSDOM(page(name), { url: `http://localhost/auth/${name}.html`, runScripts: 'outside-only' });
  await new Promise<void>(resolve => dom.window.document.addEventListener('DOMContentLoaded', () => resolve(), { once: true }));
  const win = dom.window as unknown as Record<string, unknown> & typeof dom.window;
  win.REVLUMA_API_BASE = API;
  win.fetch = request;
  Object.defineProperty(win, 'crypto', { configurable: true, value: webcrypto });
  win.TextEncoder = TextEncoder;
  win.console = { ...console, log() {}, info() {}, warn() {}, error() {} };
  win.scrollTo = () => {};
  if (token) win.localStorage.setItem('rv-auth', JSON.stringify({ state: { accessToken: token, user: { id: 'u1', onboarding_completed: false } }, version: 0 }));
  win.eval(client);
  win.showGlassmorphismCard = vi.fn();
  win.hideGlassmorphismCard = vi.fn();
  return win;
}
const inlineScript = (marker: string) =>
  Array.from(dom.window.document.scripts as HTMLCollectionOf<HTMLScriptElement>).find(script => script.textContent.includes(marker))!.textContent;

beforeEach(() => { request = vi.fn().mockResolvedValue(json({ success: true, data: {} })); });
afterEach(() => { dom?.window.close(); });

describe('onboarding is saved to the server as each step completes', () => {
  async function openOnboarding(saved: unknown = { step: 1, completed: false, store: {}, goals: [] }) {
    request.mockImplementation(async (url: string) => {
      if (url.endsWith('/onboarding')) return json({ success: true, data: saved });
      if (url.endsWith('GlassmorphismCard.html')) return json({});
      return json({ success: true, data: { step: 2 } });
    });
    const win = await load('onboarding', { token: 'access-1' });
    win.eval(inlineScript('async function loadGlassmorphismCard'));
    win.eval(inlineScript('saveOnboardingStore'));
    win.document.dispatchEvent(new win.Event('DOMContentLoaded'));
    await waitFor(() => expect(callTo('/onboarding')).toHaveLength(1));
    return win;
  }
  const doc = () => dom.window.document;
  const click = (selector: string) => (doc().querySelector(selector) as HTMLElement).click();
  const submit = (id: string) => doc().getElementById(id)!.dispatchEvent(new dom.window.Event('submit', { cancelable: true }));

  it('step 1 is sent with the bearer token before step 2 opens', async () => {
    await openOnboarding();
    (doc().getElementById('storeName') as HTMLInputElement).value = 'Ada Threads';
    (doc().getElementById('storeUrl') as HTMLInputElement).value = 'https://ada.myshopify.com/';
    click('[data-category="fashion"]');
    click('[data-orders="100_1000"]');
    submit('step1Form');
    await waitFor(() => expect(callTo('/onboarding/store')).toHaveLength(1));
    const [, init] = callTo('/onboarding/store')[0];
    expect(init?.method).toBe('PUT');
    expect((init?.headers as Record<string, string>).Authorization).toBe('Bearer access-1');
    expect(bodyOf(callTo('/onboarding/store')[0])).toEqual({ store_name: 'Ada Threads', store_url: 'ada.myshopify.com', store_category: 'fashion', monthly_orders: '100_1000' });
    await waitFor(() => expect(doc().getElementById('step2')!.classList.contains('hidden')).toBe(false));
  });

  it('step 2 saves goals, then moves to plan choice', async () => {
    await openOnboarding({ step: 2, completed: false, store: { name: 'Ada', url: 'https://ada.myshopify.com', category: 'fashion', monthly_orders: 'under_100' }, goals: [] });
    await waitFor(() => expect(doc().getElementById('step2')!.classList.contains('hidden')).toBe(false));
    expect((doc().getElementById('storeName') as HTMLInputElement).value).toBe('Ada');
    click('[data-goal="priorities"]');
    click('[data-goal="sales_changes"]');
    submit('step2Form');
    await waitFor(() => expect(callTo('/onboarding/goals')).toHaveLength(1));
    expect(bodyOf(callTo('/onboarding/goals')[0])).toEqual({ goals: ['sales_changes', 'priorities'] });
    await waitFor(() => expect(dom.window.showGlassmorphismCard).toHaveBeenCalledWith('success', 'Store profile saved', expect.any(String), expect.any(Function), 'Choose your plan'));
  });

  it('a failed save keeps the merchant on the step and shows the server field error', async () => {
    await openOnboarding();
    request.mockImplementation(async () => json({ success: false, error: 'Enter a valid store address.', field: 'store_url' }, 400));
    (doc().getElementById('storeName') as HTMLInputElement).value = 'Ada';
    (doc().getElementById('storeUrl') as HTMLInputElement).value = 'ada.myshopify.com';
    click('[data-category="pets"]');
    click('[data-orders="under_100"]');
    submit('step1Form');
    await waitFor(() => expect(doc().getElementById('storeUrlError')!.textContent).toBe('Enter a valid store address.'));
    expect(doc().getElementById('step2')!.classList.contains('hidden')).toBe(true);
    expect(JSON.parse(dom.window.localStorage.getItem('rv-onboarding')!).store_name).toBe('Ada');
  });

  it('without a session the page sends the merchant to sign in', async () => {
    const win = await load('onboarding');
    const replace = vi.fn();
    Object.defineProperty(win, 'location', { configurable: true, value: { ...win.location, replace } });
    win.eval(inlineScript('saveOnboardingStore'));
    win.document.dispatchEvent(new win.Event('DOMContentLoaded'));
    await waitFor(() => expect(replace).toHaveBeenCalledWith('/auth/login.html'));
  });
});

describe('Sign in with Apple', () => {
  it('stays hidden until the backend reports Apple as configured', async () => {
    request.mockResolvedValue(json({ success: true, data: { enabled: false } }));
    const win = await load('login');
    win.eval(appleButton);
    win.initAppleButton(win.document.getElementById('appleSignInBtn'), {});
    await waitFor(() => expect(callTo('/auth/apple/config')).toHaveLength(1));
    expect((win.document.getElementById('appleSignInBtn') as HTMLButtonElement).hidden).toBe(true);
  });

  it('sends the raw nonce to Revluma while Apple only sees its SHA-256, and checks state', async () => {
    let initOptions: Record<string, string> = {};
    request.mockImplementation(async (url: string) => {
      if (url.endsWith('/auth/apple/config')) return json({ success: true, data: { enabled: true, client_id: 'com.revluma.web', redirect_uri: 'https://revluma.vercel.app/auth/login', scope: 'name email' } });
      return json({ success: true, data: { access_token: 'apple-access', user: { id: 'u1', onboarding_completed: false } } });
    });
    const win = await load('signup');
    win.AppleID = {
      auth: {
        init: (options: Record<string, string>) => { initOptions = options; },
        signIn: async () => ({ authorization: { id_token: 'header.payload.signature', state: initOptions.state }, user: { name: { firstName: 'Ada', lastName: 'Obi' } } }),
      },
    };
    const result = await win.revlumaAuth.appleLogin();
    expect(result.success).toBe(true);
    expect(initOptions).toMatchObject({ clientId: 'com.revluma.web', redirectURI: 'https://revluma.vercel.app/auth/login', usePopup: true });
    const sent = bodyOf(callTo('/auth/apple')[0]);
    expect(sent).toMatchObject({ id_token: 'header.payload.signature', terms_agreed: true, user: { name: { firstName: 'Ada', lastName: 'Obi' } } });
    expect(sent.nonce).toMatch(/^[0-9a-f]{64}$/);
    expect(initOptions.nonce).toBe(createHash('sha256').update(sent.nonce).digest('hex'));
    expect(JSON.parse(win.localStorage.getItem('rv-auth')!).state.accessToken).toBe('apple-access');
    expect(win.revlumaAuth.destinationAfterSignIn({ onboarding_completed: false })).toBe('/auth/onboarding.html');
    expect(win.revlumaAuth.destinationAfterSignIn({ onboarding_completed: true })).toBe('/dashboard/overview');
  });

  it('rejects a popup response whose state does not match', async () => {
    request.mockResolvedValue(json({ success: true, data: { enabled: true, client_id: 'c', redirect_uri: 'r' } }));
    const win = await load('login');
    win.AppleID = { auth: { init() {}, signIn: async () => ({ authorization: { id_token: 'x.y.z', state: 'forged' } }) } };
    await expect(win.revlumaAuth.appleLogin()).rejects.toMatchObject({ code: 'APPLE_FAILED' });
    expect(callTo('/auth/apple')).toHaveLength(0);
  });

  it('keeps the Apple authorisation for linking when the email already has an account', async () => {
    request.mockImplementation(async (url: string) => {
      if (url.endsWith('/auth/apple/config')) return json({ success: true, data: { enabled: true, client_id: 'c', redirect_uri: 'r' } });
      if (url.endsWith('/auth/apple')) return json({ success: false, code: 'APPLE_ACCOUNT_LINK_REQUIRED', error: 'exists' }, 409);
      return json({ success: true, data: { apple_linked: true } });
    });
    const win = await load('login', { token: 'password-session' });
    let state = '';
    win.AppleID = { auth: { init: (o: { state: string }) => { state = o.state; }, signIn: async () => ({ authorization: { id_token: 'a.b.c', state } }) } };
    const error = await win.revlumaAuth.appleLogin().catch((e: { code: string; appleAuthorization: unknown }) => e);
    expect(error.code).toBe('APPLE_ACCOUNT_LINK_REQUIRED');
    await win.revlumaAuth.linkApple(error.appleAuthorization);
    const [, init] = callTo('/auth/apple/link')[0];
    expect((init?.headers as Record<string, string>).Authorization).toBe('Bearer password-session');
    expect(bodyOf(callTo('/auth/apple/link')[0])).toMatchObject({ id_token: 'a.b.c' });
  });

  it('login and signup pages carry the Apple button and the social consent line', () => {
    for (const [name, id] of [['login', 'appleSignInBtn'], ['signup', 'appleSignUpBtn']]) {
      const html = page(name);
      expect(html).toContain(`id="${id}"`);
      expect(html).toContain('auth-apple.js');
      expect(html).toContain('By continuing with Google or Apple, you agree to our');
    }
  });
});

describe('no invented data and USD only', () => {
  it('Google sign-in sends no placeholder store', async () => {
    request.mockResolvedValue(json({ success: true, data: { access_token: 't', user: {} } }));
    const win = await load('login');
    await win.revlumaAuth.googleLogin('google-credential');
    expect(bodyOf(callTo('/auth/google')[0])).toEqual({ credential: 'google-credential', terms_agreed: true });
  });

  it('signup and checkout pages do not invent store data or charge in naira', () => {
    const signup = page('signup');
    expect(signup).not.toMatch(/example\.com|0-10k|storeSetup/);
    expect(signup).not.toMatch(/'<svg[^']*_ACCOUNT_LINK_REQUIRED'/);
    for (const name of ['login', 'signup', 'onboarding', 'choose-plan', 'payment-success']) expect(page(name)).not.toMatch(/NGN|₦|naira/i);
    expect(page('choose-plan')).toContain("currency: 'USD'");
    expect(page('choose-plan')).toContain("request('/subscriptions/start-trial', { plan, billing_cycle: billing })");
    expect(page('login')).not.toContain('cdn.tailwindcss.com');
    expect(page('login')).not.toMatch(/function storeSession|function apiLogin|revluma_token'\)/);
  });
});
