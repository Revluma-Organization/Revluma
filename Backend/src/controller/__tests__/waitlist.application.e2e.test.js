// End-to-end contract for the Founding Merchants application: real proxy
// (api/waitlist/application.js) -> real Express routes and controllers ->
// in-memory database with the production unique keys and CHECK constraints.
// Covers scenarios A-F from the spec plus the security rules.
const assert = require('node:assert/strict');
const { startWaitlistHarness, createClient } = require('./helpers/waitlistHarness');

const STEP1 = {
  full_name: 'Ada Obi',
  work_email: 'ada@adathreads.com',
  store_name: 'Ada Threads',
  store_url: 'ada-threads.myshopify.com',
  phone: '+234 801 234 5678',
  store_age: '1_3y',
  monthly_orders: '101_500',
};
const STEP2 = { challenges: ['browse_no_purchase', 'other'], challenge_other: 'Returns are eating margin', problem_discovery: 'tools_spreadsheets' };
const STEP3 = { price_willingness: 'usd_49', capabilities: ['revenue_leaks', 'checkout_cart', 'prioritized_recommendations'], founding_interest: 'yes' };

const key = () => require('node:crypto').randomUUID();
const step1For = (email, extra = {}) => ({ ...STEP1, work_email: email, ...extra });

async function completeApplication(client, email, extra = {}) {
  const started = await client.call('POST', 'start', step1For(email, extra), { 'Idempotency-Key': key() });
  assert.equal(started.status, 201, JSON.stringify(started.body));
  assert.equal((await client.call('PUT', 'steps/2', STEP2)).status, 200);
  assert.equal((await client.call('PUT', 'steps/3', STEP3)).status, 200);
  const submitted = await client.call('POST', 'submit', {});
  assert.equal(submitted.status, 200, JSON.stringify(submitted.body));
  return submitted.body.data.application;
}

(async () => {
  const h = await startWaitlistHarness();
  const rowsFor = (email) => h.fake.rows.filter((row) => row.work_email === email);
  try {
    // ── A: normal completion -> exactly one submitted record ────────────────
    {
      const browser = createClient(h.siteUrl);
      const fresh = await browser.call('GET', 'resume');
      assert.equal(fresh.status, 200);
      assert.equal(fresh.body.data.application, null, 'nothing to resume yet');

      const started = await browser.call('POST', 'start', STEP1, { 'Idempotency-Key': key() });
      assert.equal(started.status, 201);
      const app = started.body.data.application;
      assert.equal(app.status, 'in_progress');
      assert.equal(app.current_step, 2);
      assert.equal(app.answers.work_email, 'ada@adathreads.com');
      assert.equal(app.answers.store_url, 'https://ada-threads.myshopify.com', 'normalised');
      assert.equal(app.answers.phone, '+2348012345678');
      assert.equal(app.queue_position, null);
      assert.equal('id' in app, false, 'no internal id in responses');

      // The cookie: HttpOnly, SameSite=Strict, scoped to /api, expiring.
      const cookie = browser.lastSetCookie.find((c) => c.startsWith('rv_wl_session='));
      assert.ok(cookie, 'resume cookie set');
      assert.match(cookie, /HttpOnly/i);
      assert.match(cookie, /SameSite=Strict/i);
      assert.match(cookie, /Path=\/api/);
      assert.match(cookie, /Max-Age=2592000/);
      const token = browser.jar.get('rv_wl_session');
      assert.match(token, /^[A-Za-z0-9_-]{43}$/);
      const stored = rowsFor('ada@adathreads.com')[0];
      assert.equal(JSON.stringify(h.fake.rows).includes(token), false, 'raw token never stored');
      assert.match(stored.resume_token_hash, /^[0-9a-f]{64}$/);
      assert.match(stored.id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/, 'random v4 id');

      // Steps cannot be skipped or submitted early.
      assert.equal((await browser.call('PUT', 'steps/3', STEP3)).body.code, 'STEP_LOCKED');
      const early = await browser.call('POST', 'submit', {});
      assert.equal(early.status, 409);
      assert.equal(early.body.code, 'INCOMPLETE');
      assert.equal(early.body.step, 2);
      assert.equal(rowsFor('ada@adathreads.com')[0].status, 'in_progress', 'never submitted while incomplete');

      const s2 = await browser.call('PUT', 'steps/2', STEP2);
      assert.equal(s2.status, 200);
      assert.equal(s2.body.data.application.current_step, 3);
      const s3 = await browser.call('PUT', 'steps/3', STEP3);
      assert.equal(s3.body.data.application.current_step, 4, 'review screen');
      assert.equal(rowsFor('ada@adathreads.com')[0].status, 'in_progress', 'review is not submission');

      const submitted = await browser.call('POST', 'submit', {});
      assert.equal(submitted.status, 200);
      const done = submitted.body.data.application;
      assert.equal(done.status, 'submitted');
      assert.equal(done.queue_position, 1, 'real queue position from the database');
      assert.match(done.referral_code, /^RV-[0-9A-F]{8}$/);
      assert.ok(done.submitted_at);
      assert.equal(rowsFor('ada@adathreads.com').length, 1, 'one record');
      assert.equal(h.fake.rows.length, 1);
      assert.deepEqual(h.emails.map((e) => e.kind), ['welcome'], 'existing confirmation email sent once');
      assert.equal(h.emails[0].data.waitlist_position, 1);
      assert.equal(rowsFor('ada@adathreads.com')[0].welcome_email_sent, true);

      // Submitting again or editing afterwards changes nothing.
      const again = await browser.call('POST', 'submit', {});
      assert.equal(again.status, 200);
      assert.equal(again.body.data.application.queue_position, 1);
      assert.equal(h.emails.length, 1, 'no second email');
      assert.equal((await browser.call('PUT', 'steps/2', STEP2)).body.code, 'ALREADY_SUBMITTED');
      const status = await browser.call('GET', 'status');
      assert.deepEqual(Object.keys(status.body.data).sort(), ['current_step', 'queue_position', 'status', 'submitted_at']);
      assert.equal(status.body.data.status, 'submitted');
    }

    // ── B: abandon after step 1 -> come back later and continue ────────────
    {
      const email = 'bola@bolabeauty.com';
      const tab = createClient(h.siteUrl);
      await tab.call('POST', 'start', step1For(email), { 'Idempotency-Key': key() });
      const firstToken = tab.jar.get('rv_wl_session');

      // Browser closed and reopened: same cookie jar, new page load.
      const reopened = createClient(h.siteUrl);
      reopened.jar.set('rv_wl_session', firstToken);
      const resumed = await reopened.call('GET', 'resume');
      assert.equal(resumed.status, 200);
      assert.equal(resumed.body.data.application.current_step, 2, 'continues at step 2');
      assert.equal(resumed.body.data.application.answers.store_name, 'Ada Threads');
      // The token rotates on every visit; the old one stops working.
      const rotated = reopened.jar.get('rv_wl_session');
      assert.notEqual(rotated, firstToken);
      const stale = createClient(h.siteUrl);
      stale.jar.set('rv_wl_session', firstToken);
      assert.equal((await stale.call('GET', 'resume')).body.data.application, null, 'old token no longer valid');
      assert.equal((await stale.call('PUT', 'steps/2', STEP2)).status, 401);

      // Email alone never unlocks it: a new browser with the same email is
      // told to verify instead of getting the application.
      const otherDevice = createClient(h.siteUrl);
      const blocked = await otherDevice.call('POST', 'start', step1For(email), { 'Idempotency-Key': key() });
      assert.equal(blocked.status, 409);
      assert.equal(blocked.body.code, 'EMAIL_HAS_APPLICATION');
      assert.equal(blocked.body.data, undefined, 'no answers leaked');
      assert.equal(otherDevice.jar.size, 0, 'no session issued');
      assert.equal(rowsFor(email).length, 1);

      // Cross-device resume: one-time code to the email.
      const requested = await otherDevice.call('POST', 'resume/request-code', { email: ' BOLA@bolabeauty.com ' });
      assert.equal(requested.status, 202);
      const unknown = await otherDevice.call('POST', 'resume/request-code', { email: 'nobody@nowhere.com' });
      assert.equal(unknown.status, 202);
      assert.deepEqual(unknown.body, requested.body, 'same answer whether or not the email exists');
      await new Promise((resolve) => setTimeout(resolve, 20));
      const mail = h.emails.filter((e) => e.kind === 'resume_code');
      assert.equal(mail.length, 1, 'code only sent for a real application');
      assert.equal(mail[0].to, email);
      const code = mail[0].data.code;
      assert.equal(JSON.stringify(h.fake.rows).includes(`"${code}"`), false, 'code stored hashed');
      // Immediate re-request does not send another email.
      await otherDevice.call('POST', 'resume/request-code', { email });
      await new Promise((resolve) => setTimeout(resolve, 20));
      assert.equal(h.emails.filter((e) => e.kind === 'resume_code').length, 1);

      const wrong = code === '000000' ? '111111' : '000000';
      assert.equal((await otherDevice.call('POST', 'resume/verify-code', { email, code: wrong })).body.code, 'CODE_INVALID');
      const verified = await otherDevice.call('POST', 'resume/verify-code', { email, code });
      assert.equal(verified.status, 200);
      assert.equal(verified.body.data.application.current_step, 2);
      assert.ok(otherDevice.jar.get('rv_wl_session'));
      assert.equal((await otherDevice.call('POST', 'resume/verify-code', { email, code })).body.code, 'CODE_INVALID', 'single use');
      assert.equal((await reopened.call('GET', 'resume')).body.data.application, null, 'the previous browser is signed out');
      const continued = await otherDevice.call('PUT', 'steps/2', STEP2);
      assert.equal(continued.body.data.application.current_step, 3);

      // Wrong codes lock after five attempts, even if the right one follows.
      await otherDevice.call('POST', 'resume/request-code', { email: 'ada@adathreads.com' });
      await new Promise((resolve) => setTimeout(resolve, 20));
      const adaCode = h.emails.filter((e) => e.kind === 'resume_code').at(-1).data.code;
      const notAda = adaCode === '123456' ? '654321' : '123456';
      for (let i = 0; i < 5; i += 1) await otherDevice.call('POST', 'resume/verify-code', { email: 'ada@adathreads.com', code: notAda });
      assert.equal((await otherDevice.call('POST', 'resume/verify-code', { email: 'ada@adathreads.com', code: adaCode })).body.code, 'CODE_INVALID');
    }

    // ── C: abandon after step 2 -> resume at step 3 with answers ───────────
    {
      const email = 'chi@chicandles.com';
      const browser = createClient(h.siteUrl);
      await browser.call('POST', 'start', step1For(email), { 'Idempotency-Key': key() });
      await browser.call('PUT', 'steps/2', STEP2);
      const resumed = await browser.call('GET', 'resume');
      const app = resumed.body.data.application;
      assert.equal(app.current_step, 3);
      assert.deepEqual(app.answers.challenges, ['browse_no_purchase', 'other']);
      assert.equal(app.answers.challenge_other, 'Returns are eating margin');
      assert.equal(app.answers.problem_discovery, 'tools_spreadsheets');
      assert.equal(app.answers.price_willingness, null, 'no price preselected');

      // Going back to edit step 1 keeps progress at step 3.
      const edited = await browser.call('PUT', 'steps/1', step1For(email, { store_name: 'Chi Candles Co' }));
      assert.equal(edited.body.data.application.current_step, 3);
      assert.equal(edited.body.data.application.answers.store_name, 'Chi Candles Co');
      // Changing the email to one that has an application is refused.
      assert.equal((await browser.call('PUT', 'steps/1', step1For('bola@bolabeauty.com'))).body.code, 'EMAIL_HAS_APPLICATION');
    }

    // ── D: a failed save blocks progress; retry succeeds ───────────────────
    {
      const email = 'dami@damidesigns.com';
      const browser = createClient(h.siteUrl);
      await browser.call('POST', 'start', step1For(email), { 'Idempotency-Key': key() });
      h.fake.failNextOperation('updateMany');
      const failed = await browser.call('PUT', 'steps/2', STEP2);
      assert.equal(failed.status, 500);
      assert.equal(failed.body.success, false);
      let app = (await browser.call('GET', 'resume')).body.data.application;
      assert.equal(app.current_step, 2, 'no progress recorded');
      assert.deepEqual(app.answers.challenges, [], 'nothing half-saved');

      h.setBackendDown(true);
      const offline = await browser.call('PUT', 'steps/2', STEP2);
      assert.equal(offline.status, 502);
      h.setBackendDown(false);

      const retried = await browser.call('PUT', 'steps/2', STEP2);
      assert.equal(retried.status, 200);
      app = (await browser.call('GET', 'resume')).body.data.application;
      assert.equal(app.current_step, 3);
      assert.equal(rowsFor(email).length, 1);
    }

    // ── E: repeated Continue clicks -> no duplicates ────────────────────────
    {
      const email = 'efe@efefoods.com';
      const browser = createClient(h.siteUrl);
      const idem = key();
      const burst = await Promise.all(Array.from({ length: 6 }, () => browser.call('POST', 'start', step1For(email), { 'Idempotency-Key': idem })));
      const statuses = burst.map((r) => r.status).sort();
      assert.equal(statuses.filter((s) => s === 201).length, 1, `exactly one create: ${statuses}`);
      assert.ok(statuses.every((s) => s === 201 || s === 200), String(statuses));
      assert.equal(rowsFor(email).length, 1, 'one record despite six clicks');
      // Every duplicate answered with the same session, whatever order the responses arrive in.
      const cookies = new Set(burst.map(() => browser.jar.get('rv_wl_session')));
      assert.equal(cookies.size, 1);
      assert.equal(rowsFor(email)[0].resume_token_hash, require('node:crypto').createHash('sha256').update(browser.jar.get('rv_wl_session')).digest('hex'));

      // A retry after a lost response (no cookie) gets the same application back.
      const lostResponse = createClient(h.siteUrl);
      const replay = await lostResponse.call('POST', 'start', step1For(email), { 'Idempotency-Key': idem });
      assert.equal(replay.status, 200);
      assert.ok(lostResponse.jar.get('rv_wl_session'));
      assert.equal(rowsFor(email).length, 1);
      // A different key without a cookie is not a replay.
      const stranger = createClient(h.siteUrl);
      assert.equal((await stranger.call('POST', 'start', step1For(email), { 'Idempotency-Key': key() })).body.code, 'EMAIL_HAS_APPLICATION');

      const saves = await Promise.all(Array.from({ length: 5 }, () => lostResponse.call('PUT', 'steps/2', STEP2)));
      assert.ok(saves.every((r) => r.status === 200));
      await lostResponse.call('PUT', 'steps/3', STEP3);
      const submits = await Promise.all(Array.from({ length: 5 }, () => lostResponse.call('POST', 'submit', {})));
      assert.ok(submits.every((r) => r.status === 200));
      const positions = new Set(submits.map((r) => r.body.data.application.queue_position));
      assert.equal(positions.size, 1, 'one queue position');
      assert.equal(rowsFor(email).length, 1);
      assert.equal(h.emails.filter((e) => e.kind === 'welcome' && e.to === email).length, 1, 'one confirmation email');
      const row = rowsFor(email)[0];
      assert.equal(row.status, 'submitted');
    }

    // ── F: referral attribution survives every step ─────────────────────────
    {
      const referrer = await completeApplication(createClient(h.siteUrl), 'fola@folafits.com');
      const code = referrer.referral_code;
      const browser = createClient(h.siteUrl);
      const started = await browser.call('POST', 'start', { ...step1For('gozie@goziegoods.com'), referral_code: code.toLowerCase() }, { 'Idempotency-Key': key() });
      assert.equal(started.body.data.application.referred, true);
      // Refresh mid-way: attribution is on the record, not in the page.
      assert.equal((await browser.call('GET', 'resume')).body.data.application.referred, true);
      await browser.call('PUT', 'steps/1', step1For('gozie@goziegoods.com'));
      await browser.call('PUT', 'steps/2', STEP2);
      await browser.call('PUT', 'steps/3', STEP3);
      assert.equal(rowsFor('fola@folafits.com')[0].referral_count, 0, 'no credit for an unfinished application');
      await browser.call('POST', 'submit', {});
      assert.equal(rowsFor('gozie@goziegoods.com')[0].referred_by_code, code, 'attribution on the final record');
      assert.equal(rowsFor('fola@folafits.com')[0].referral_count, 1, 'referrer credited once on submission');
      await browser.call('POST', 'submit', {});
      assert.equal(rowsFor('fola@folafits.com')[0].referral_count, 1);

      const unknown = createClient(h.siteUrl);
      const noCredit = await unknown.call('POST', 'start', { ...step1For('hadiza@hadizahome.com'), referral_code: 'RV-NOTREAL' }, { 'Idempotency-Key': key() });
      assert.equal(noCredit.status, 201, 'an unknown code never blocks an application');
      assert.equal(noCredit.body.data.application.referred, false);
    }

    // ── Validation, enumeration and transport rules ─────────────────────────
    {
      const browser = createClient(h.siteUrl);
      const invalid = await browser.call('POST', 'start', { ...STEP1, work_email: 'nope', store_url: 'not a url' });
      assert.equal(invalid.status, 400);
      assert.deepEqual(Object.keys(invalid.body.fields).sort(), ['store_url', 'work_email']);
      assert.equal(browser.jar.size, 0);

      await browser.call('POST', 'start', step1For('ike@ikeinks.com'), { 'Idempotency-Key': key() });
      await browser.call('PUT', 'steps/2', STEP2);
      const four = await browser.call('PUT', 'steps/3', { ...STEP3, capabilities: [...STEP3.capabilities, 'inventory_risks'] });
      assert.equal(four.status, 400);
      assert.equal(four.body.fields.capabilities, 'Choose up to 3.');
      assert.equal(rowsFor('ike@ikeinks.com')[0].current_step, 3);

      const nobody = createClient(h.siteUrl);
      assert.equal((await nobody.call('PUT', 'steps/2', STEP2)).status, 401);
      assert.equal((await nobody.call('POST', 'submit', {})).status, 401);
      nobody.jar.set('rv_wl_session', 'x'.repeat(43));
      assert.equal((await nobody.call('PUT', 'steps/2', STEP2)).status, 401, 'guessed token rejected');
      assert.equal((await nobody.call('GET', 'status')).body.data.status, null);

      // Honeypot: looks like success, stores nothing, no session.
      const bot = createClient(h.siteUrl);
      const before = h.fake.rows.length;
      const trapped = await bot.call('POST', 'start', { ...step1For('bot@spam.com'), hp_field: 'filled' });
      assert.equal(trapped.status, 201);
      assert.equal(h.fake.rows.length, before);
      assert.equal(bot.jar.size, 0);

      // "Not you?" forgets the application in this browser only.
      const ended = await browser.call('DELETE', 'session');
      assert.equal(ended.status, 200);
      assert.equal(browser.jar.size, 0);
      assert.equal(rowsFor('ike@ikeinks.com').length, 1);

      // Secure flag behind HTTPS.
      // (On Render the platform's HTTPS proxy sets X-Forwarded-Proto; RENDER=true also forces it.)
      const secure = await fetch(`${h.backendUrl}/api/v1/waitlist/application/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Forwarded-Proto': 'https' },
        body: JSON.stringify(step1For('jide@jidejewels.com')),
      });
      assert.equal(secure.status, 201);
      assert.ok(secure.headers.getSetCookie().some((c) => c.startsWith('rv_wl_session=') && /;\s*Secure/i.test(c)));

      // Proxy: unknown actions, wrong methods, cross-site writes, foreign cookies.
      assert.equal((await browser.call('GET', 'stats')).status, 404);
      assert.equal((await browser.call('GET', 'start')).status, 405);
      const crossSite = createClient(h.siteUrl, { origin: 'https://evil.example' });
      assert.equal((await crossSite.call('POST', 'start', step1For('k@k.com'))).status, 403);
      const captured = [];
      const fakeRes = { setHeader() {}, status() { return this; }, json() { return this; } };
      const realFetch = global.fetch;
      global.fetch = async (url, init) => {
        captured.push(init.headers);
        return new Response('{"success":true}', { status: 200, headers: { 'set-cookie': 'other=1; Path=/' } });
      };
      try {
        await h.proxy({ method: 'GET', headers: { cookie: 'sb-access-token=secret; rv_wl_session=abc_DEF-123; theme=dark' }, query: { path: 'resume' } }, fakeRes);
      } finally {
        global.fetch = realFetch;
      }
      assert.equal(captured[0].Cookie, 'rv_wl_session=abc_DEF-123', 'only the application cookie is forwarded');
    }

    // Final census: one row per applicant, statuses only from the allowed set.
    const emails = h.fake.rows.map((row) => row.work_email);
    assert.equal(new Set(emails).size, emails.length, 'no duplicate applications');
    for (const row of h.fake.rows) {
      assert.ok(['in_progress', 'submitted'].includes(row.status));
      if (row.status === 'submitted') assert.equal(require('../../utils/waitlistApplication').firstIncompleteStep(row), null, 'submitted rows are complete');
    }
    const positions = h.fake.rows.filter((row) => row.status === 'submitted').map((row) => row.waitlist_position).sort((a, b) => a - b);
    assert.deepEqual(positions, positions.map((_, index) => index + 1), 'gap-free queue');

    console.log(`waitlist application e2e: ok (${h.fake.rows.length} applications, ${h.emails.length} emails)`);
  } finally {
    await h.close();
  }
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
