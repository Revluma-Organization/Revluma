'use strict';

// Rev conversation titles.
//
// How the big chat products do it (studied for this change): ChatGPT and
// Claude save a placeholder when the first message arrives, then, after the
// first exchange, ask a small model for a short title (about 3 - 6 words, in
// the conversation's language, sentence case, conversation text treated as
// data) and swap it in. The title is never just the first words of the
// message, so ten chats that all start with "Hello" do not all read "Hello".
//
// Rev follows the same two stages:
//   1. draftConversationTitle(): instant, deterministic, no model. Written when
//      the first turn is persisted, so a title always exists. Small talk gets a
//      varied, human title ("Friendly hello", "Quick check-in"), picked stably
//      per conversation so identical openers still get different titles; store
//      questions get a topical title ("Why revenue dropped this week").
//   2. The model title (python /rev/title), requested by the dashboard after
//      the first answer. It replaces the draft only while the title is still
//      automatic (never a merchant's own rename). sanitizeModelTitle() is the
//      last guard on whatever the model returns.

const crypto = require('crypto');

const MAX_TITLE_LENGTH = 60;
const MAX_TITLE_WORDS = 7;

const POOLS = {
  greeting: [
    'Friendly hello', 'Saying hello', 'Friendly greetings', 'A warm hello', 'Quick hello',
    'Hello there', 'Opening hellos', 'A friendly wave', 'Warm welcome', 'Hello and welcome',
  ],
  wellbeing: [
    'Quick check-in', 'Friendly catch-up', 'How things are going', 'Checking in with Rev',
    'A casual catch-up', 'Small talk with Rev', 'Friendly check-in', 'Catching up',
  ],
  thanks: ['A quick thank you', 'Words of thanks', 'Thanks and appreciation', 'Grateful note'],
  goodbye: ['Signing off', 'Saying goodbye', 'Wrapping up', 'Until next time'],
  identity: ['Getting to know Rev', 'Meeting Rev', 'What Rev can do', 'Introducing Rev'],
  help: ['Getting started with Rev', 'First steps with Rev', 'Where to begin'],
  casual: ['Casual conversation', 'Friendly chat', 'Easy conversation', 'A relaxed chat'],
};

const SMALL_TALK_INTENTS = new Set(['greeting', 'casual', 'social', 'feedback', 'identity', 'capability']);

const GREETING = /^(hi+|hello+|hey+|hiya|howdy|yo|greetings|sup|good (morning|afternoon|evening|day)|morning|evening)( (there|chat|rev|team|everyone|all|friend|buddy|mate|again))*$/;
const WELLBEING = /\b(how (are|r) (you|u|things)|how('s| is) (it going|your day|everything|life)|how (have|ve) you been|what('s| is) up|whats up|how do you do)\b/;
const THANKS = /^(thanks|thank you|thx|ty|cheers|appreciate it|much appreciated|great thanks|ok thanks|okay thanks)\b/;
const GOODBYE = /^(bye|goodbye|see you|see ya|good night|later|talk soon|catch you later)\b/;
const IDENTITY = /\b(who are you|what are you|what can you do|what is rev|what's rev|your name|introduce yourself|what do you do)\b/;
const HELP = /^(help|help me|can you help( me)?|i need help)$/;

// Ordered: the first matching topic wins.
const TOPICS = [
  { re: /\b(checkout|cart abandon\w*|abandon\w* (cart|checkout)s?|abandonment)\b/, noun: 'checkout drop-off', drop: 'Checkout drop-off review' },
  { re: /\b(refunds?|returns?|chargebacks?)\b/, noun: 'refunds and returns' },
  { re: /\b(aov|average order value|order value|basket size)\b/, noun: 'order value' },
  { re: /\b(revenue|sales|income|gmv|turnover|earnings)\b/, noun: 'revenue' },
  { re: /\b(churn|retention|repeat (buyers?|customers?|purchases?)|loyal\w*)\b/, noun: 'customer retention' },
  { re: /\b(customers?|shoppers?|buyers?)\b/, noun: 'customers' },
  { re: /\b(best ?sell\w*|top ?sell\w*|products?|skus?|catalog\w*)\b/, noun: 'product performance' },
  { re: /\b(conversion rate|traffic|visitors?|sessions?)\b/, noun: 'traffic and conversion' },
  { re: /\b(email|newsletters?|klaviyo)\b/, noun: 'email marketing' },
  { re: /\b(marketing|ads?|campaigns?|roas|facebook|meta ads|google ads|tiktok)\b/, noun: 'marketing performance' },
  { re: /\b(discounts?|coupons?|promos?|promotions?|black friday|bfcm)\b/, noun: 'discounts and promotions' },
  { re: /\b(inventory|stock|restock\w*)\b/, noun: 'inventory' },
  { re: /\b(pric(e|es|ing))\b/, noun: 'pricing strategy' },
  { re: /\b(orders?)\b/, noun: 'orders' },
  { re: /\b(shopify|integration|connect\w*|sync\w*)\b/, noun: 'store connection' },
  { re: /\b(findings?|alerts?|anomal\w*)\b/, noun: 'findings' },
];

const DECLINE = /\b(drop\w*|down|declin\w*|fall\w*|fell|dip\w*|decreas\w*|lower|worse|lost|losing|slump\w*|tank\w*)\b/;
const GROWTH = /\b(grow\w*|increas\w*|boost\w*|improv\w*|scale|scaling|raise|more)\b/;
const REDUCE = /\b(reduc\w*|cut\w*|fix\w*|prevent\w*|stop\w*|minimi[sz]\w*|recover\w*)\b/;
const COMPARE = /\b(compare\w*|comparison|vs|versus)\b/;

const PERIODS = [
  { re: /\btoday\b/, prefix: "Today's", suffix: 'today' },
  { re: /\byesterday\b/, prefix: "Yesterday's", suffix: 'yesterday' },
  { re: /\bthis week\b/, prefix: "This week's", suffix: 'this week' },
  { re: /\blast week\b/, prefix: "Last week's", suffix: 'last week' },
  { re: /\bthis month\b/, prefix: "This month's", suffix: 'this month' },
  { re: /\blast month\b/, prefix: "Last month's", suffix: 'last month' },
  { re: /\bthis year\b/, prefix: "This year's", suffix: 'this year' },
  { re: /\blast year\b/, prefix: "Last year's", suffix: 'last year' },
  { re: /\b(last|past) 7 days\b/, prefix: '7-day', suffix: 'over 7 days' },
  { re: /\b(last|past) 30 days\b/, prefix: '30-day', suffix: 'over 30 days' },
];

// Writing and how-to requests are about the thing being written, not a store
// metric, so they keep their own words ("Product description for blue socks").
const WRITING = /^((can|could|would) you |please |help me )?(write|draft|create|generate|compose|rewrite|brainstorm|come up with|suggest)\b/;
const DEFINITION = /\bwhat (?:a |an |the )?([\p{L}\p{N}' -]{3,40}?) (?:is|are|means)\b/u;
const TRAILING_STOP = /\s+(a|an|the|and|or|of|for|to|in|on|with|my|your|is|are|that|this|at|by|from)$/i;

const OVERVIEW_WORDS = ['snapshot', 'overview', 'breakdown', 'check', 'review'];

const LEADING_FILLER = /^((hi|hello|hey|ok|okay|so|um|please|rev|chat)[,!.\s]+)*((can|could|would|will) you|i want to|i'd like to|i would like to|i need to|i need|please|tell me|show me|help me|let me know|give me|explain|write me|write|draft|create|generate|compose|come up with|what is|what's|what are|is there|are there|about|a|an|the)\s+/i;

function hashIndex(seed, length) {
  const digest = crypto.createHash('sha256').update(String(seed)).digest();
  return digest.readUInt32BE(0) % length;
}

function pick(pool, seed) {
  return pool[hashIndex(seed, pool.length)];
}

function normalise(message) {
  return String(message || '')
    .toLowerCase()
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[^\p{L}\p{N}'\s-]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function sentenceCase(text) {
  const trimmed = text.trim();
  return trimmed ? trimmed.charAt(0).toUpperCase() + trimmed.slice(1) : trimmed;
}

function clampWords(text, maxWords = 6) {
  const words = text.split(/\s+/).filter(Boolean);
  let out = '';
  for (const word of words.slice(0, maxWords)) {
    if ((out ? `${out} ${word}` : word).length > MAX_TITLE_LENGTH) break;
    out = out ? `${out} ${word}` : word;
  }
  // Never end a shortened title on a dangling "for", "the", "and" ...
  if (words.length > maxWords || out.length < words.join(' ').length) {
    let previous;
    do { previous = out; out = out.replace(TRAILING_STOP, ''); } while (out !== previous);
  }
  return out;
}

function smallTalkKind(text) {
  if (!text) return null;
  if (IDENTITY.test(text)) return 'identity';
  if (HELP.test(text)) return 'help';
  if (WELLBEING.test(text)) return 'wellbeing';
  if (GREETING.test(text)) return 'greeting';
  if (THANKS.test(text)) return 'thanks';
  if (GOODBYE.test(text)) return 'goodbye';
  return null;
}

function topicalTitle(text, seed) {
  const topic = TOPICS.find(entry => entry.re.test(text));
  if (!topic) return null;
  const period = PERIODS.find(entry => entry.re.test(text)) || null;
  if (REDUCE.test(text)) return sentenceCase(`${/^(fix|recover)/.test(text.match(REDUCE)[1]) ? 'Fixing' : 'Reducing'} ${topic.noun}`);
  if (DECLINE.test(text)) {
    if (topic.drop) return period ? `${topic.drop} ${period.suffix}` : topic.drop;
    return `Why ${topic.noun} dropped${period ? ` ${period.suffix}` : ''}`;
  }
  if (COMPARE.test(text)) return sentenceCase(`${topic.noun} comparison`);
  if (GROWTH.test(text)) return `Ways to grow ${topic.noun}`;
  const word = pick(OVERVIEW_WORDS, `${seed}:${topic.noun}`);
  return period ? `${period.prefix} ${topic.noun} ${word}` : sentenceCase(`${topic.noun} ${word}`);
}

function cleanedQuestion(message) {
  let text = String(message || '').replace(/\s+/g, ' ').trim();
  for (let i = 0; i < 3; i += 1) {
    const next = text.replace(LEADING_FILLER, '').trim();
    if (next === text) break;
    text = next;
  }
  text = text.replace(/[?!.,;:\s]+$/g, '').replace(/^["'`]+|["'`]+$/g, '');
  return sentenceCase(clampWords(text));
}

/**
 * Instant, deterministic title for a new conversation. `seed` (the
 * conversation id) varies small-talk titles between conversations while
 * keeping each conversation's title stable across retries.
 */
function draftConversationTitle(message, seed = '', intent = null) {
  const text = normalise(message);
  const kind = smallTalkKind(text);
  if (kind) return pick(POOLS[kind], `${seed}:${kind}`);
  if (WRITING.test(text)) {
    const cleaned = cleanedQuestion(message);
    if (cleaned.replace(/[^\p{L}\p{N}]/gu, '').length >= 3) return cleaned;
  }
  const definition = text.match(DEFINITION);
  if (definition && definition[1].split(' ').length <= 4) return `Understanding ${definition[1].trim()}`;
  const topical = topicalTitle(text, seed);
  if (topical) return clampWords(topical, MAX_TITLE_WORDS);
  if (intent && SMALL_TALK_INTENTS.has(String(intent).toLowerCase())) return pick(POOLS.casual, `${seed}:casual`);
  const cleaned = cleanedQuestion(message);
  if (cleaned.replace(/[^\p{L}\p{N}]/gu, '').length >= 3) return cleaned;
  return pick(POOLS.casual, `${seed}:casual`);
}

/** The pre-2026-11 title rule (first words of the message), kept so older
 *  automatic titles are still recognised as automatic. */
function legacyTitle(message) {
  const msg = String(message || '').trim();
  const stripped = msg
    .replace(/^(hi|hello|hey|good morning|morning|thanks|thank you|ok|okay|can you|could you|i want to|i need|please|can we)\s+/i, '')
    .trim();
  const title = stripped.length > 5 ? stripped : msg;
  let out = '';
  for (const w of title.split(' ')) {
    if ((`${out} ${w}`).length > 55) break;
    out = out ? `${out} ${w}` : w;
  }
  return out.charAt(0).toUpperCase() + out.slice(1);
}

/** True while the stored title is still one Rev wrote, not a merchant rename. */
function isAutomaticTitle(current, firstMessage, seed = '', intent = null) {
  if (current === null || current === undefined) return true;
  const value = String(current).trim();
  if (!value) return true;
  const first = String(firstMessage || '').trim();
  return value === draftConversationTitle(first, seed, intent)
    || value === draftConversationTitle(first, seed)
    || value === legacyTitle(first)
    || value === first.slice(0, 100);
}

/**
 * Last guard on a model-written title: one line, no quotes, labels, markdown,
 * emoji-only or trailing punctuation, at most 7 words / 60 characters.
 * Returns null when nothing usable is left.
 */
function sanitizeModelTitle(raw) {
  if (typeof raw !== 'string') return null;
  let text = raw.split(/\r?\n/).map(line => line.trim()).find(Boolean) || '';
  text = text
    .replace(/^(title|conversation title|chat title)\s*[:\-]\s*/i, '')
    .replace(/[*_#`]+/g, '')
    .replace(/^["'\u201C\u201D\u2018\u2019\s]+|["'\u201C\u201D\u2018\u2019\s]+$/g, '')
    .replace(/\u2014|\u2013/g, ' - ')
    .replace(/\s+/g, ' ')
    .replace(/[.!?,;:\s]+$/g, '')
    .trim();
  if (!text || text.replace(/[^\p{L}\p{N}]/gu, '').length < 2) return null;
  const words = text.split(' ');
  if (words.length > MAX_TITLE_WORDS) text = words.slice(0, MAX_TITLE_WORDS).join(' ');
  if (text.length > MAX_TITLE_LENGTH) text = clampWords(text, MAX_TITLE_WORDS);
  return text ? sentenceCase(text) : null;
}

module.exports = {
  draftConversationTitle,
  isAutomaticTitle,
  sanitizeModelTitle,
  legacyTitle,
  POOLS,
  MAX_TITLE_LENGTH,
};
