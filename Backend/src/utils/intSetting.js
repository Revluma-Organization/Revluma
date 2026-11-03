'use strict';

/**
 * Safe integer configuration parsing.
 *
 * A malformed environment variable is worse than a missing one, because NaN
 * fails silently in two different ways that both disable the scheduler instead
 * of reporting a configuration problem:
 *
 *   - `setInterval(fn, NaN)` is treated as 0 and fires every millisecond, which
 *     turns a configuration typo into a busy loop against Python and Postgres.
 *   - A NaN lock TTL is serialised as `null` in the Redis `SET key val EX ttl NX`
 *     command. The command then errors, the lock acquisition catches it and
 *     returns null, and the guarded job is skipped forever without ever
 *     recording why.
 *
 * So an unparsable, empty or out-of-range value is logged at error level and
 * replaced with the documented default, which is always a working value.
 *
 * Kept free of Prisma and service dependencies so it can be unit tested without
 * a generated client.
 */

const logger = require('./logger');

// The whole value must be an integer. `Number.parseInt` is deliberately lenient
// and stops at the first invalid character, so '60s and then some' parses to 60
// and '60.5' parses to 60 — a misconfiguration that would be accepted as though
// someone had configured it. Anchoring the pattern rejects those outright.
const INTEGER_PATTERN = /^[+-]?\d+$/;

/**
 * @param {string} name environment variable to read
 * @param {number|string} fallback documented default, used when unset or invalid
 * @param {number} [minimum=1] smallest acceptable value
 * @returns {number} a safe integer, never NaN
 */
function intSetting(name, fallback, minimum = 1) {
    const raw = process.env[name];
    const trimmed = raw === undefined || raw === null ? '' : String(raw).trim();

    const parsed = INTEGER_PATTERN.test(trimmed) ? Number.parseInt(trimmed, 10) : NaN;
    const fallbackText = String(fallback).trim();
    const fallbackNumber = INTEGER_PATTERN.test(fallbackText)
        ? Number.parseInt(fallbackText, 10)
        : NaN;
    const safeFallback = Number.isInteger(fallbackNumber)
        ? Math.max(fallbackNumber, minimum)
        : minimum;

    if (!Number.isInteger(parsed) || parsed < minimum) {
        // Only complain when something was actually configured: an unset
        // variable taking its documented default is normal, not an error.
        if (trimmed !== '') {
            logger.error('scheduler_setting_invalid', {
                setting: name,
                minimum,
                fallback: safeFallback,
            });
        }

        return safeFallback;
    }

    return parsed;
}

module.exports = { intSetting };
