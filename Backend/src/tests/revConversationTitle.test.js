'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  draftConversationTitle, isAutomaticTitle, sanitizeModelTitle, legacyTitle, POOLS,
} = require('../services/revConversationTitle');

// ── 1. Draft titles are never just the opening words ─────────────────────────
for (const opener of ['Hello chat', 'hello chat', 'Hey!', 'Good morning Rev', 'hi there']) {
  const title = draftConversationTitle(opener, 'conv-1');
  assert.ok(POOLS.greeting.includes(title), `"${opener}" gets a greeting title, got "${title}"`);
  assert.notEqual(title.toLowerCase(), opener.toLowerCase().replace(/[!?.]/g, ''));
}

// Ten conversations that all open with "Hello chat" do not all share one title.
const helloTitles = new Set(Array.from({ length: 10 }, (_, i) => draftConversationTitle('Hello chat', `conv-${i}`)));
assert.ok(helloTitles.size >= 4, `identical openers get varied titles (${[...helloTitles].join(', ')})`);

// ...and each conversation keeps its own title across retries.
assert.equal(draftConversationTitle('Hello chat', 'conv-7'), draftConversationTitle('Hello chat', 'conv-7'));

assert.ok(POOLS.wellbeing.includes(draftConversationTitle('Nothing much yet, how are you doing?', 'c')));
assert.ok(POOLS.thanks.includes(draftConversationTitle('Thanks!', 'c')));
assert.ok(POOLS.identity.includes(draftConversationTitle('Who are you?', 'c')));
assert.ok(POOLS.goodbye.includes(draftConversationTitle('bye for now', 'c')));

// ── 2. Store questions get a topical title ───────────────────────────────────
assert.equal(draftConversationTitle('Why did my revenue drop this week?', 'c'), 'Why revenue dropped this week');
assert.equal(draftConversationTitle('How can I grow my average order value?', 'c'), 'Ways to grow order value');
assert.equal(draftConversationTitle('Compare orders last month vs this month', 'c'), 'Orders comparison');
assert.equal(draftConversationTitle('How do I reduce cart abandonment on mobile?', 'c'), 'Reducing checkout drop-off');
assert.match(draftConversationTitle('Show me my top selling products', 'c'), /^Product performance (snapshot|overview|breakdown|check|review)$/);
assert.equal(draftConversationTitle('Write me a product description for blue socks', 'c'), 'Product description for blue socks');
assert.equal(draftConversationTitle('Can you explain what a cohort analysis is?', 'c'), 'Understanding cohort analysis');

// Unknown topics: cleaned, short, never ending on a dangling word.
const generic = draftConversationTitle('Tell me about the history of the Roman empire and its fall', 'c');
assert.equal(generic, 'History of the Roman empire');
assert.ok(generic.split(' ').length <= 6);

// Small-talk intent from the model upgrades an unmatched message.
assert.ok(POOLS.casual.includes(draftConversationTitle('lol', 'c', 'casual')));

// No em dashes in any title the drafts can produce.
for (const pool of Object.values(POOLS)) for (const title of pool) assert.ok(!/[\u2014\u2013]/.test(title), title);

// ── 3. Only automatic titles may be replaced ─────────────────────────────────
assert.equal(isAutomaticTitle(null, 'Hello chat', 'c'), true);
assert.equal(isAutomaticTitle('  ', 'Hello chat', 'c'), true);
assert.equal(isAutomaticTitle(draftConversationTitle('Hello chat', 'c'), 'Hello chat', 'c'), true);
assert.equal(isAutomaticTitle('Hello chat', 'Hello chat', 'c'), true, 'legacy first-words titles are automatic');
assert.equal(isAutomaticTitle(legacyTitle('Can you show revenue for last week please'), 'Can you show revenue for last week please', 'c'), true);
assert.equal(isAutomaticTitle('Holiday launch plan', 'Hello chat', 'c'), false, 'a merchant rename is never replaced');

// ── 4. Model output is sanitized before it is stored ─────────────────────────
assert.equal(sanitizeModelTitle('Title: "Friendly greetings."'), 'Friendly greetings');
assert.equal(sanitizeModelTitle('**Revenue dip \u2014 this week**\nmore'), 'Revenue dip - this week');
assert.equal(sanitizeModelTitle('one two three four five six seven eight'), 'One two three four five six seven');
assert.equal(sanitizeModelTitle('   '), null);
assert.equal(sanitizeModelTitle('!!'), null);
assert.equal(sanitizeModelTitle(42), null);

// ── 5. Controller contract ───────────────────────────────────────────────────
const controller = fs.readFileSync(path.join(__dirname, '..', 'controller', 'revController.js'), 'utf8');
const route = fs.readFileSync(path.join(__dirname, '..', 'route', 'revRoute.js'), 'utf8');
assert.ok(!/_generateTitle\(/.test(controller), 'the first-words title rule is gone');
assert.match(controller, /titleHint: draftConversationTitle\(validated\.message, activeConvId/);
const start = controller.indexOf('exports.generateConversationTitle');
assert.ok(start > 0, 'generateConversationTitle handler exists');
const handler = controller.slice(start, controller.indexOf('\n};', start));
assert.match(handler, /verifyConversationOwnership\(id, org\.id\)/, 'organization-scoped');
assert.match(handler, /isAutomaticTitle\(current, firstMessage, id, intent\)/, 'renames are protected');
assert.match(handler, /AND \(title IS NULL OR btrim\(title\) = '' OR title = \$\{current \?\? ''\}\)/, 'conditional update guards a concurrent rename');
assert.match(handler, /sanitizeModelTitle\(generated\.data\.title\)/, 'model output is sanitized');
assert.match(handler, /modelTitle \|\| draft/, 'falls back to the draft title');
assert.match(route, /router\.post\('\/conversation\/:id\/title\/generate',\s*authenticateToken, chatLimiter,\s*revController\.generateConversationTitle\)/);

console.log('revConversationTitle tests passed');
