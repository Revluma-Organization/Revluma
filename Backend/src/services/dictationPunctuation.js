'use strict';

// Dictation punctuation guard (Node side of POST /api/v1/rev/dictation/punctuate).
//
// The dashboard's voice input sends raw recognised words; python /rev/punctuate
// asks a fast model to add punctuation, capitals and sentence breaks. This
// module is the last check before that text reaches the composer: the output
// must keep the original words in the same order. Only filler sounds and
// stutters may be dropped. Mirrors python/src/agents/dictation_punctuation.py.

const MAX_DICTATION_CHARS = 2000;
const FILLERS = new Set(['um', 'umm', 'uhm', 'uh', 'uhh', 'er', 'erm', 'hmm', 'hm', 'mm', 'mmm', 'ah', 'eh']);
const CONTRACTION_TAILS = new Set(['m', 've', 'll', 'd', 're', 's']);

function rawTokens(text) {
  return String(text || '').toLowerCase().replace(/\u2019/g, "'")
    .split(/[^a-z0-9']+/).map(t => t.replace(/^'+|'+$/g, '')).filter(Boolean);
}
const key = token => token.replace(/'/g, '');

function isFaithfulPunctuation(original, output) {
  const rawSrc = rawTokens(original);
  const src = rawSrc.map(key);
  const out = rawTokens(output).map(key);
  if (!out.length) return false;
  let i = 0;
  for (let index = 0; index < src.length; index += 1) {
    const word = src[index];
    if (i < out.length && out[i] === word) { i += 1; continue; }
    const next = src[index + 1] || '';
    const prev = src[index - 1] || '';
    const nextRaw = rawSrc[index + 1] || '';
    const [head, tail] = nextRaw.includes("'") ? nextRaw.split(/'(.*)/s) : ['', ''];
    const stutter = head === word && CONTRACTION_TAILS.has(tail);
    if (FILLERS.has(word) || word === next || word === prev || stutter) continue;
    return false;
  }
  return i === out.length;
}

function sanitizePunctuated(raw) {
  if (typeof raw !== 'string') return null;
  let text = raw.replace(/<\/?\s*transcript\s*>/gi, ' ').trim();
  text = text.replace(/^(formatted text|formatted|text|transcript)\s*:\s*/i, '').trim();
  if (text.length >= 2 && text[0] === text[text.length - 1] && `"'\``.includes(text[0])) text = text.slice(1, -1).trim();
  text = text.replace(/\s*[\u2014\u2013]\s*/g, ', ').replace(/[ \t]+/g, ' ').replace(/\s+([,.?!;:])/g, '$1');
  return text || null;
}

module.exports = { isFaithfulPunctuation, sanitizePunctuated, MAX_DICTATION_CHARS };
