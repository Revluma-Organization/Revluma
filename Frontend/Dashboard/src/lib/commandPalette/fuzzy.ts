/**
 * Fuzzy matching + weighted ranking engine for the command palette.
 *
 * This is a lightweight, dependency-free scorer designed for client-side
 * indexes in the hundreds-to-low-thousands of items. It combines:
 *  1. Exact / prefix substring matching (highest confidence)
 *  2. Subsequence ("fuzzy") matching with position + contiguity bonuses
 *  3. Keyword/alias matching (synonyms, abbreviations)
 *  4. Token-level typo tolerance via bounded Levenshtein distance
 *
 * It returns both a score (for ranking) and the matched character indices
 * in the title (for highlighting).
 */

export interface FuzzyMatch {
  score: number;
  /** Indices into the title string that matched the query, for highlighting */
  titleIndices: number[];
}

function normalize(s: string): string {
  return s.toLowerCase().trim();
}

/** Bounded Levenshtein — bails out early past `max` for performance. */
function boundedLevenshtein(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  const dp: number[] = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = dp[0];
    dp[0] = i;
    let rowMin = dp[0];
    for (let j = 1; j <= b.length; j++) {
      const tmp = dp[j];
      dp[j] = a[i - 1] === b[j - 1]
        ? prev
        : 1 + Math.min(prev, dp[j], dp[j - 1]);
      prev = tmp;
      rowMin = Math.min(rowMin, dp[j]);
    }
    if (rowMin > max) return max + 1;
  }
  return dp[b.length];
}

/**
 * Subsequence fuzzy match: every character of `query` must appear in
 * `target` in order (not necessarily contiguous). Score rewards
 * contiguous runs and early matches, penalizes gaps.
 */
function subsequenceMatch(query: string, target: string): FuzzyMatch | null {
  if (!query) return null;
  let qi = 0;
  const indices: number[] = [];
  let score = 0;
  let lastMatch = -1;
  let contiguousRun = 0;

  for (let ti = 0; ti < target.length && qi < query.length; ti++) {
    if (target[ti] === query[qi]) {
      indices.push(ti);
      const gap = lastMatch === -1 ? 0 : ti - lastMatch - 1;
      if (gap === 0 && lastMatch !== -1) {
        contiguousRun += 1;
        score += 6 + contiguousRun * 2; // reward runs increasingly
      } else {
        contiguousRun = 0;
        score += Math.max(1, 4 - gap * 0.5); // penalize larger gaps
      }
      if (ti === 0 || target[ti - 1] === ' ') score += 3; // word-boundary bonus
      lastMatch = ti;
      qi++;
    }
  }

  if (qi < query.length) return null; // not all query chars matched
  // Slight preference for shorter targets (more specific match)
  score -= target.length * 0.05;
  return { score, titleIndices: indices };
}

/**
 * Scores a single (already-normalized, single-token-or-phrase) query
 * against a command. Returns null if there's no reasonable match.
 */
function scoreToken(q: string, item: Scorable, title: string): FuzzyMatch | null {
  let best: FuzzyMatch | null = null;

  // 1. Exact / prefix / substring match on title — strongest signal
  const idx = title.indexOf(q);
  if (idx !== -1) {
    const prefixBonus = idx === 0 ? 40 : 0;
    const exactBonus = title === q ? 30 : 0;
    const lengthPenalty = (title.length - q.length) * 0.3;
    const score = 60 + prefixBonus + exactBonus - lengthPenalty;
    const titleIndices = Array.from({ length: q.length }, (_, i) => idx + i);
    best = { score, titleIndices };
  }

  // 2. Subsequence fuzzy match on title
  const sub = subsequenceMatch(q, title);
  if (sub && (!best || sub.score > best.score)) best = sub;

  // 3. Keyword / alias matching (slightly lower weight than title matches)
  const keywordSources = [...(item.keywords ?? []), ...(item.aliases ?? [])];
  for (const kw of keywordSources) {
    const nkw = normalize(kw);
    if (nkw === q) {
      const score = 55;
      if (!best || score > best.score) best = { score, titleIndices: best?.titleIndices ?? [] };
    } else if (nkw.includes(q) || q.includes(nkw)) {
      const score = 42 - (nkw.length - q.length) * 0.2;
      if (!best || score > best.score) best = { score, titleIndices: best?.titleIndices ?? [] };
    } else if (q.length >= 4) {
      // Typo tolerance on keyword tokens — only for words long enough that a
      // distance-of-1/2 edit is still meaningfully "close", avoiding short-word
      // false positives (e.g. "labs" vs "pass" are distance-2 but unrelated).
      const maxAllowed = nkw.length <= 5 ? 1 : 2;
      const dist = boundedLevenshtein(q, nkw, maxAllowed);
      if (dist <= maxAllowed) {
        const score = dist === 1 ? 34 : 22;
        if (!best || score > best.score) best = { score, titleIndices: best?.titleIndices ?? [] };
      }
    }
  }

  // 4. Description substring match
  if (item.description) {
    const ndesc = normalize(item.description);
    if (ndesc.includes(q)) {
      const score = 20;
      if (!best || score > best.score) best = { score, titleIndices: best?.titleIndices ?? [] };
    }
  }

  // 5. Category match (e.g. typing "integrations")
  if (normalize(item.category).includes(q)) {
    const score = 15;
    if (!best || score > best.score) best = { score, titleIndices: best?.titleIndices ?? [] };
  }

  // 6. Word-level typo tolerance and prefix matching against the title itself
  for (const word of title.split(/\s+/)) {
    const prefixMatch = word.startsWith(q) || q.startsWith(word);
    if (prefixMatch) {
      const score = 35;
      if (!best || score > best.score) best = { score, titleIndices: best?.titleIndices ?? [] };
      continue;
    }
    if (q.length < 4 || word.length < 4) continue;
    const maxAllowed = word.length <= 5 ? 1 : 2;
    const dist = boundedLevenshtein(q, word, maxAllowed);
    if (dist <= maxAllowed) {
      const score = dist === 1 ? 32 : 20;
      if (!best || score > best.score) best = { score, titleIndices: best?.titleIndices ?? [] };
    }
  }

  return best;
}

export interface Scorable {
  title: string;
  description?: string;
  category: string;
  keywords?: string[];
  aliases?: string[];
}

/**
 * Scores a command against a full search query. Handles both:
 *  - Direct phrase matching ("change password" as one string)
 *  - Natural-language multi-word queries, where any single meaningful
 *    word in the query ("change my password" → "password") can surface
 *    a match, the way "forgot password" and "password" should return
 *    the same result even though the phrasing differs.
 *
 * Returns null if there's no reasonable match at all (used to filter out
 * irrelevant results).
 */
export function scoreCommand(query: string, item: Scorable): FuzzyMatch | null {
  const q = normalize(query);
  if (!q) return { score: 0, titleIndices: [] };

  const title = normalize(item.title);
  let best = scoreToken(q, item, title);

  const words = q.split(/\s+/).filter((w) => w.length >= 3);
  if (words.length > 1) {
    for (const w of words) {
      const m = scoreToken(w, item, title);
      if (!m) continue;
      // Slight discount vs. a full-phrase match, since this only matched part of what was typed.
      const adjusted: FuzzyMatch = { score: m.score * 0.82, titleIndices: m.titleIndices };
      if (!best || adjusted.score > best.score) best = adjusted;
    }
  }

  return best;
}