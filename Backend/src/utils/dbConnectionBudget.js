'use strict';

/*
 * Database connection budget for the Node service.
 *
 * Prisma sizes its pool as `2 * CPU + 1` unless the DSN says otherwise. That
 * makes the number of connections this service opens against the shared Supabase
 * database depend on the size of the Render instance, so it changes silently
 * whenever the instance type changes, while the database's own limit does not.
 *
 * Verified production figures on 2026-11-03 (project jblpgqmbgdlzitprudgt):
 *   max_connections = 60
 *   total_backends  = 27 at peak of the observed incident
 *   Python intelligence service pool = 12 (pool_size 8 + max_overflow 4)
 *
 * Node plus Python must stay comfortably under 60, leaving headroom for Supabase
 * internals, the management API, edge functions and a second replica of either
 * service.
 *
 * This module contains no Prisma or database import so it can be unit tested
 * without a generated client.
 */

const { intSetting } = require('./intSetting');

// Prisma's Postgres provider accepts both spellings.
const POSTGRES_SCHEMES = new Set(['postgres', 'postgresql']);

const PRISMA_CONNECTION_LIMIT = intSetting('PRISMA_CONNECTION_LIMIT', '10', 1);
const PRISMA_POOL_TIMEOUT_SECONDS = Math.max(
    1,
    Math.round(intSetting('PRISMA_POOL_TIMEOUT_MS', '30000', 1000) / 1000)
);

/**
 * Ensure a Prisma DSN carries an explicit connection limit and pool timeout.
 *
 * Values already present on the DSN always win, so an operator can override the
 * budget in the environment without a code change.
 *
 * @param {string|undefined|null} url
 * @returns {{url: string|undefined|null, applied: boolean, connectionLimit: number|null, poolTimeoutSeconds: number|null}}
 */
function applyConnectionBudget(url) {
    if (!url || typeof url !== 'string') {
        return { url, applied: false, connectionLimit: null, poolTimeoutSeconds: null };
    }

    try {
        const parsed = new URL(url);

        // Only Postgres DSNs understand these parameters. Prisma also supports
        // SQLite, MySQL and SQL Server, and appending `connection_limit` to a
        // `file:./dev.db` DSN would produce an invalid connection string for
        // those providers, so anything that is not Postgres is passed through.
        if (!POSTGRES_SCHEMES.has(parsed.protocol.replace(/:$/, ''))) {
            return { url, applied: false, connectionLimit: null, poolTimeoutSeconds: null };
        }

        let applied = false;

        if (!parsed.searchParams.has('connection_limit')) {
            parsed.searchParams.set('connection_limit', String(PRISMA_CONNECTION_LIMIT));
            applied = true;
        }

        // Prisma expresses pool_timeout in seconds.
        if (!parsed.searchParams.has('pool_timeout')) {
            parsed.searchParams.set('pool_timeout', String(PRISMA_POOL_TIMEOUT_SECONDS));
            applied = true;
        }

        return {
            url: parsed.toString(),
            applied,
            connectionLimit: Number.parseInt(parsed.searchParams.get('connection_limit'), 10),
            poolTimeoutSeconds: Number.parseInt(parsed.searchParams.get('pool_timeout'), 10),
        };
    } catch {
        // A DSN that is not a parseable URL is returned untouched rather than
        // rejected: refusing to start over pool tuning is a worse failure than
        // running with Prisma's defaults.
        return { url, applied: false, connectionLimit: null, poolTimeoutSeconds: null };
    }
}

module.exports = {
    applyConnectionBudget,
    PRISMA_CONNECTION_LIMIT,
    PRISMA_POOL_TIMEOUT_SECONDS,
};
