// Founding Merchants application rules: normalisation, per-step validation,
// tokens and the public view. Pure functions, no database.
const assert = require('node:assert/strict');
const wl = require('../waitlistApplication');

const step1 = {
  full_name: '  Ada   Obi ',
  work_email: ' Ada@AdaThreads.COM ',
  store_name: ' Ada Threads ',
  store_url: 'HTTPS://ada-threads.myshopify.com/collections/all?x=1',
  phone: '+234 801 234 5678',
  store_age: '1_3y',
  monthly_orders: '101_500',
};

// Email
assert.equal(wl.normaliseEmail(' Ada@Shop.COM '), 'ada@shop.com');
for (const bad of ['', 'ada', 'ada@', '@shop.com', 'ada@shop', 'a b@shop.com', 'ada@shop.c0m', `${'a'.repeat(65)}@shop.com`, null, 42]) {
  assert.equal(wl.normaliseEmail(bad), null, String(bad));
}

// Shopify store address
const url = wl.normaliseShopifyUrl;
assert.equal(url('ada-threads.myshopify.com'), 'https://ada-threads.myshopify.com');
assert.equal(url('ada-threads'), 'https://ada-threads.myshopify.com');
assert.equal(url('https://admin.shopify.com/store/ada-threads/orders'), 'https://ada-threads.myshopify.com');
assert.equal(url('http://www.AdaThreads.co.uk:8080/shop?ref=1'), 'https://adathreads.co.uk');
assert.equal(url('adathreads.com.'), 'https://adathreads.com');
for (const bad of ['', 'a', '127.0.0.1', 'javascript:alert(1)', 'shop..com', '-a.com', 'x.myshopify.com.evil', 'a.b.myshopify.com', 'myshopify.com', 'shopify.com', 'user@evil.com', 'ab', null]) {
  assert.equal(url(bad), null, String(bad));
}

// Phone / WhatsApp
assert.equal(wl.normalisePhone('+234 801 234 5678'), '+2348012345678');
assert.equal(wl.normalisePhone('00 44 20 7946 0958'), '+442079460958');
assert.equal(wl.normalisePhone('(415) 555-0100'), '4155550100');
assert.equal(wl.normalisePhone(''), null);
assert.equal(wl.normalisePhone(undefined), null);
for (const bad of ['12345', '+1 234 567 890 123 456', 'call me', '+44 20 <b>']) assert.equal(wl.normalisePhone(bad), undefined, bad);

// Referral codes
assert.equal(wl.normaliseReferralCode(' rv-4f8a2b '), 'RV-4F8A2B');
assert.equal(wl.normaliseReferralCode('x'), null);
assert.equal(wl.normaliseReferralCode('<script>'), null);

// Step 1
let checked = wl.validateStep1(step1);
assert.equal(checked.ok, true);
assert.deepEqual(checked.data, {
  full_name: 'Ada Obi',
  work_email: 'ada@adathreads.com',
  store_name: 'Ada Threads',
  store_url: 'https://ada-threads.myshopify.com',
  phone: '+2348012345678',
  store_age: '1_3y',
  monthly_orders: '101_500',
});
assert.equal(wl.validateStep1({ ...step1, phone: '' }).data.phone, null);
checked = wl.validateStep1({});
assert.equal(checked.ok, false);
assert.deepEqual(Object.keys(checked.errors).sort(), ['full_name', 'monthly_orders', 'store_age', 'store_name', 'store_url', 'work_email']);
assert.ok(wl.validateStep1({ ...step1, store_age: '10y' }).errors.store_age);
assert.ok(wl.validateStep1({ ...step1, full_name: '<b>x</b>' }).errors.full_name);
assert.ok(wl.validateStep1({ ...step1, phone: 'abc' }).errors.phone);

// Step 2
checked = wl.validateStep2({ challenges: ['prioritization', 'cart_abandonment', 'cart_abandonment'], problem_discovery: 'manual' });
assert.equal(checked.ok, true);
assert.deepEqual(checked.data.challenges, ['cart_abandonment', 'prioritization'], 'deduplicated and in catalogue order');
assert.equal(checked.data.challenge_other, null);
checked = wl.validateStep2({ challenges: ['other'], challenge_other: '  Returns   eat our margin ', problem_discovery: 'no_process' });
assert.equal(checked.data.challenge_other, 'Returns eat our margin');
assert.equal(wl.validateStep2({ challenges: ['declining_sales'], challenge_other: 'ignored', problem_discovery: 'manual' }).data.challenge_other, null, 'other text only kept with Other');
assert.ok(wl.validateStep2({ challenges: [], problem_discovery: 'manual' }).errors.challenges);
assert.ok(wl.validateStep2({ challenges: ['made_up'], problem_discovery: 'manual' }).errors.challenges);
assert.ok(wl.validateStep2({ challenges: ['other'], challenge_other: 'x'.repeat(301), problem_discovery: 'manual' }).errors.challenge_other);
assert.ok(wl.validateStep2({ challenges: ['other'], problem_discovery: ['manual', 'no_process'] }).errors.problem_discovery, 'single choice');

// Step 3: price has no default, capabilities are capped at three
const step3 = { price_willingness: 'usd_49', capabilities: ['revenue_leaks', 'checkout_cart', 'monitoring_improvement'], founding_interest: 'yes' };
assert.equal(wl.validateStep3(step3).ok, true);
assert.ok(wl.validateStep3({ ...step3, price_willingness: undefined }).errors.price_willingness);
assert.ok(wl.validateStep3({ ...step3, price_willingness: '49' }).errors.price_willingness);
assert.equal(wl.validateStep3({ ...step3, capabilities: [...step3.capabilities, 'inventory_risks'] }).errors.capabilities, 'Choose up to 3.');
assert.ok(wl.validateStep3({ ...step3, capabilities: [] }).errors.capabilities);
assert.ok(wl.validateStep3({ ...step3, founding_interest: 'sure' }).errors.founding_interest);
assert.equal(wl.OPTIONS.price_willingness.length, 10);
assert.deepEqual(wl.OPTIONS.price_willingness, ['free', 'usd_19', 'usd_29', 'usd_49', 'usd_79', 'usd_99', 'usd_149', 'usd_199', 'usd_299', 'usd_500_plus']);

// Column mapping and completeness
const row = {
  status: 'in_progress',
  current_step: 4,
  ...wl.stepColumns(1, wl.validateStep1(step1).data),
  ...wl.stepColumns(2, wl.validateStep2({ challenges: ['declining_sales'], problem_discovery: 'manual' }).data),
  ...wl.stepColumns(3, wl.validateStep3(step3).data),
};
assert.equal(row.company_name, 'Ada Threads');
assert.equal(row.monthly_order_volume, '101_500');
assert.equal(row.interested_in_beta, true);
assert.equal(wl.stepColumns(3, { ...step3, founding_interest: 'not_now' }).interested_in_beta, false);
assert.equal(wl.firstIncompleteStep(row), null);
assert.equal(wl.firstIncompleteStep({ ...row, problem_discovery: null }), 2);
assert.equal(wl.firstIncompleteStep({ ...row, store_age: null }), 1);

// Public view: answers back in form field names, nothing internal
const view = wl.publicView({ ...row, id: 'secret-id', resume_token_hash: 'h', ip_address: '1.2.3.4', lead_score: 9, waitlist_position: 7, referral_code: 'RV-1' });
assert.equal(view.answers.store_name, 'Ada Threads');
assert.equal(view.queue_position, null, 'no queue position before submission');
assert.equal(view.referral_code, null);
const json = JSON.stringify(view);
for (const leak of ['secret-id', '1.2.3.4', 'resume_token', 'lead_score', 'ip_address']) assert.equal(json.includes(leak), false, leak);
const submitted = wl.publicView({ ...row, status: 'submitted', submitted_at: new Date('2026-11-18T10:00:00Z'), waitlist_position: 7, referral_code: 'RV-1' });
assert.equal(submitted.queue_position, 7);
assert.equal(submitted.current_step, 4);
assert.equal(submitted.submitted_at, '2026-11-18T10:00:00.000Z');

// Tokens: 256-bit, URL-safe, only the hash is stored
const token = wl.newResumeToken();
assert.equal(wl.isWellFormedToken(token), true);
assert.notEqual(wl.newResumeToken(), token);
assert.match(wl.hashToken(token), /^[0-9a-f]{64}$/);
assert.equal(wl.isWellFormedToken('short'), false);
assert.equal(wl.isWellFormedToken(`${token}x`), false);
assert.equal(wl.isWellFormedIdempotencyKey('3f2a1c9e-4b7d-4e2a-9c1f-6d5e4b3a2c1f'), true);
assert.equal(wl.isWellFormedIdempotencyKey('x'), false);
const code = wl.newResumeCode();
assert.match(code, /^\d{6}$/);
const codeHash = wl.hashResumeCode(code, 'app-1', 'secret');
assert.equal(wl.safeEqualHex(codeHash, wl.hashResumeCode(code, 'app-1', 'secret')), true);
assert.equal(wl.safeEqualHex(codeHash, wl.hashResumeCode(code, 'app-2', 'secret')), false, 'bound to the application');
assert.equal(wl.safeEqualHex(codeHash, 'abc'), false);

console.log('waitlistApplication rules: ok');
