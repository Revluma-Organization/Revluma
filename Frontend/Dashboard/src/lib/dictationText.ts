// Live formatting for dictated speech.
//
// The browser's speech recognition returns raw words with no punctuation
// ("hello um what's going on and how are you doing"). Speech models like the
// one behind ChatGPT voice input return written text instead. This module
// gets close to that on the device, instantly, while the merchant speaks:
//
// - drops filler sounds (um, uh, erm, hmm) and stutters ("I I'm" -> "I'm")
// - honours spoken punctuation: "comma", "question mark", "full stop",
//   "exclamation mark" / "exclamation point"
// - each recognised phrase (the recogniser splits at pauses) becomes a
//   sentence: capitalised, ending in "?" when it opens like a question and
//   "." otherwise; a phrase that starts with "and / but / so..." continues
//   the previous sentence after a comma instead
// - a greeting or interjection that opens a sentence gets a comma
//   ("Hello, what's going on?"), and "i" is always "I"
//
// When dictation finishes, the text is also sent for a model polish (see
// useDictation `polish`), which can fix sentence breaks inside long phrases.
// These rules are the instant layer and the fallback when that is unavailable.

const FILLER = /(^|[\s,])(?:u+m+|u+h+m*|e+r+m+|h+m+|m{3,}|uh-huh)(?=[\s,.?!]|$)[,]?/gi;

// Unambiguous spoken punctuation only. "period", "dot" and "new line" are left
// alone: merchants say "this period" and "a new line of products".
const SPOKEN_PUNCTUATION: Array<[RegExp, string]> = [
  [/\s*\bquestion mark\b/gi, "?"],
  [/\s*\bexclamation (?:mark|point)\b/gi, "!"],
  [/\s*\bfull stop\b/gi, "."],
  [/\s*\bcomma\b/gi, ","],
];

// Words that legitimately repeat ("had had", "that that", "very very").
const REPEAT_OK = new Set(["had", "that", "very", "so", "no", "bye", "ha", "really", "many", "much", "more", "is"]);

const QUESTION_WORDS = new Set([
  "what", "what's", "whats", "why", "how", "how's", "hows", "when", "where", "where's", "who", "who's",
  "which", "whose", "whom", "is", "isn't", "are", "aren't", "am", "can", "can't", "could", "couldn't",
  "do", "does", "doesn't", "did", "didn't", "will", "won't", "would", "wouldn't", "should",
  "shouldn't", "have", "haven't", "has", "hasn't", "may", "might", "shall", "was", "wasn't", "were", "weren't",
]);

// Openers that take a comma when more words follow ("Hey Rev, ...").
const OPENER_WORDS = "(?:hello|hi|hey|hiya|good (?:morning|afternoon|evening)|okay|ok|so|well|yes|yeah|yep|no|nope|alright|right|thanks|thank you)(?: (?:rev|there|chat|team|everyone))?";
// "Hello there" alone is one greeting, not "Hello, there".
const OPENER = new RegExp(`^(${OPENER_WORDS})(?=\\s+\\S)(?!,)(?!\\s+(?:rev|there|chat|team|everyone)[.?!,]?$)`, "i");
const OPENER_PREFIX = new RegExp(`^${OPENER_WORDS}[,\\s]+`, "i");
// A sentence that is only a greeting ("Hello.") joins the next one with a comma.
const BARE_OPENER_END = new RegExp(`(^|[.?!]\\s+)(${OPENER_WORDS})[.]$`, "i");

const CONJUNCTION = /^(and|but|so|or|because|then|plus|also)\b/i;

export function cleanSpoken(raw: string): string {
  let text = ` ${raw} `;
  for (const [pattern, mark] of SPOKEN_PUNCTUATION) text = text.replace(pattern, mark);
  text = text.replace(FILLER, "$1");
  // "I I'm" / "we we're": a word stuttered into its contraction.
  text = text.replace(/\b(\w+)\s+(?=\1'\w+\b)/gi, "");
  // Immediate repeats ("the the"), except words that legitimately double.
  text = text.replace(/\b(\w+)(\s+\1\b)+/gi, (match, word: string) => (REPEAT_OK.has(word.toLowerCase()) ? match : word));
  // "Rev" is the assistant's name.
  text = text.replace(/\brev\b/g, "Rev");
  text = text.replace(/\bi\b/g, "I").replace(/\bi'(m|ve|ll|d)\b/gi, (_m, tail: string) => `I'${tail.toLowerCase()}`);
  text = text.replace(/\s+([,.?!])/g, "$1").replace(/([,.?!])(?=[^\s,.?!'"])/g, "$1 ");
  text = text.replace(/,\s*([.?!])/g, "$1").replace(/([.?!]),/g, "$1").replace(/,{2,}/g, ",");
  return text.replace(/\s+/g, " ").replace(/^[\s,.]+/, "").trim();
}

const endsSentence = (text: string) => !text.trim() || /[.?!]["')\]]?\s*$/.test(text) || /\n\s*$/.test(text);

function capitalize(text: string): string {
  return text.replace(/^(\s*["'(]?)([a-z])/, (_m, lead: string, ch: string) => lead + ch.toUpperCase());
}

/** The sentence a phrase belongs to, used to decide "?" vs ".". */
function looksLikeQuestion(sentence: string): boolean {
  const body = sentence.trim().replace(OPENER_PREFIX, "").replace(/^(?:and|but|so|or|then|also)\s+/i, "").toLowerCase();
  const first = body.split(/\s+/)[0]?.replace(/[^a-z']/g, "") ?? "";
  return QUESTION_WORDS.has(first);
}

function currentSentence(text: string): string {
  const parts = text.split(/[.?!]\s+|\n/);
  return parts[parts.length - 1] ?? "";
}

/**
 * Appends one finished phrase to the text, as written prose. `existing` may be
 * text the merchant typed; a phrase continues it when it has no ending yet.
 */
export function appendPhrase(existing: string, rawPhrase: string): string {
  let phrase = cleanSpoken(rawPhrase);
  if (!phrase) return existing;
  const startsFresh = endsSentence(existing);
  let base = existing.replace(/\s+$/, "");

  if (!startsFresh) {
    // Continue the merchant's or previous unfinished sentence as recognised
    // (the recogniser already capitalises names and "I").
  } else if (base && BARE_OPENER_END.test(base)) {
    // "Hello." + "how are you" -> "Hello, how are you?"
    base = base.replace(/[.]$/, ",");
  } else if (base && /[.]$/.test(base) && CONJUNCTION.test(phrase)) {
    // "...this week." + "and why" -> "...this week, and why"
    base = base.replace(/[.]$/, ",");
    phrase = phrase.charAt(0).toLowerCase() + phrase.slice(1);
  } else {
    phrase = capitalize(phrase.replace(OPENER, "$1,"));
  }

  const joined = base ? `${base}${/\n$/.test(existing) ? "" : " "}${phrase}` : phrase;
  if (/[.?!,]$/.test(phrase)) return joined.replace(/,$/, ".");
  return `${joined}${looksLikeQuestion(currentSentence(joined)) ? "?" : "."}`;
}

/** Close an unfinished last sentence ("...doing" -> "...doing?" / "."). */
export function finishSentence(text: string): string {
  const trimmed = text.replace(/\s+$/, "");
  if (!trimmed || /[.?!,;:]$/.test(trimmed) || !/[\p{L}\p{N}'")\]]$/u.test(trimmed)) return text;
  return `${trimmed}${looksLikeQuestion(currentSentence(trimmed)) ? "?" : "."}`;
}

/** Text shown while a phrase is still being recognised (no ending added yet). */
export function appendInterim(existing: string, rawInterim: string): string {
  let words = cleanSpoken(rawInterim);
  if (!words) return existing;
  if (endsSentence(existing)) words = capitalize(words.replace(OPENER, "$1,"));
  const base = existing.replace(/\s+$/, "");
  return base ? `${base}${/\n$/.test(existing) ? "" : " "}${words}` : words;
}
