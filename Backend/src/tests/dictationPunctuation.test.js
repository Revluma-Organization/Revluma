'use strict';

const assert = require('node:assert/strict');
const { isFaithfulPunctuation, sanitizePunctuated } = require('../services/dictationPunctuation');

const RAW = "hello um what's currently going on and um how are you doing I I'm";

// ── 1. Formatting-only changes pass ─────────────────────────────────────────
assert.equal(isFaithfulPunctuation(RAW, "Hello, what's currently going on? And how are you doing? I'm"), true);
assert.equal(isFaithfulPunctuation('the the store is up', 'The store is up.'), true);
assert.equal(isFaithfulPunctuation('which products sell best', 'Which products sell best?'), true);
assert.equal(isFaithfulPunctuation('whats new', "What's new?"), true);

// ── 2. Changed, added, dropped or reordered words fail ──────────────────────
assert.equal(isFaithfulPunctuation('why did revenue drop', 'Why did sales drop?'), false);
assert.equal(isFaithfulPunctuation('why did revenue drop', 'Why did my revenue drop?'), false);
assert.equal(isFaithfulPunctuation('revenue went up then down', 'Revenue went down then up.'), false);
assert.equal(isFaithfulPunctuation('we were growing', 'Were growing.'), false);
assert.equal(isFaithfulPunctuation('how are you doing', "I'm doing great, thanks for asking!"), false);
assert.equal(isFaithfulPunctuation('show me orders', ''), false);

// ── 3. Sanitizer ─────────────────────────────────────────────────────────────
assert.equal(sanitizePunctuated('Formatted text: "Hello, how are you?"'), 'Hello, how are you?');
assert.equal(sanitizePunctuated('Sales rose \u2014 nicely .'), 'Sales rose, nicely.');
assert.equal(sanitizePunctuated('<transcript>Hi.</transcript>'), 'Hi.');
assert.equal(sanitizePunctuated(null), null);

// ── 4. Wiring ────────────────────────────────────────────────────────────────
const fs = require('node:fs');
const path = require('node:path');
const route = fs.readFileSync(path.join(__dirname, '../route/revRoute.js'), 'utf8');
assert.match(route, /router\.post\('\/dictation\/punctuate',\s*authenticateToken, dictationLimiter, revController\.punctuateDictation\)/);
const controller = fs.readFileSync(path.join(__dirname, '../controller/revController.js'), 'utf8');
assert.match(controller, /isFaithfulPunctuation\(text, punctuated\)/);
assert.match(controller, /PUNCTUATION_UNAVAILABLE/);

console.log('dictationPunctuation tests passed');
