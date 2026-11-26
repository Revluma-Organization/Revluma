'use strict';

/**
 * In-memory stand-in for the slice of Prisma the waitlist controllers use.
 * Enforces the same unique keys as the database (work_email, referral_code,
 * resume_token_hash, start_key_hash) so duplicate-safety is actually tested,
 * and models the CHECK constraints from the migration.
 */

const UNIQUE = ['id', 'work_email', 'referral_code', 'resume_token_hash', 'start_key_hash'];
const STATUSES = ['in_progress', 'submitted', 'reviewed', 'accepted', 'rejected'];

function clone(row) {
  return row ? JSON.parse(JSON.stringify(row), (key, value) => (/_at$/.test(key) && typeof value === 'string' ? new Date(value) : value)) : row;
}

function uniqueError(field) {
  return Object.assign(new Error(`Unique constraint failed on ${field}`), { code: 'P2002', meta: { target: [field] } });
}

function matches(row, where = {}) {
  return Object.entries(where).every(([key, condition]) => {
    const value = row[key];
    if (condition && typeof condition === 'object' && !(condition instanceof Date) && !Array.isArray(condition)) {
      if ('lt' in condition) return value !== null && value !== undefined && value < condition.lt;
      if ('not' in condition) return condition.not === null ? value !== null && value !== undefined : value !== condition.not;
      return false;
    }
    return value === condition;
  });
}

function select(row, fields) {
  if (!row || !fields) return clone(row);
  return Object.fromEntries(Object.keys(fields).filter((key) => fields[key]).map((key) => [key, clone(row)[key]]));
}

// Like a PrismaPromise: nothing runs until it is awaited, so an array passed
// to $transaction executes inside the transaction (and rolls back together).
function lazy(run) {
  let promise = null;
  const start = () => (promise ||= Promise.resolve().then(run));
  return {
    then: (onFulfilled, onRejected) => start().then(onFulfilled, onRejected),
    catch: (onRejected) => start().catch(onRejected),
    finally: (onFinally) => start().finally(onFinally),
  };
}

function createFakePrisma() {
  const rows = [];
  const calls = { creates: 0, updates: 0, txLocks: 0 };
  let failNext = null;

  function checkConstraints(row) {
    if (!STATUSES.includes(row.status)) throw new Error('waitlist_users_status_check');
    if (row.status !== 'in_progress' && !row.submitted_at) throw new Error('waitlist_users_submitted_at_check');
    if (row.current_step < 1 || row.current_step > 4) throw new Error('waitlist_users_current_step_check');
    if ((row.valuable_capabilities || []).length > 3) throw new Error('waitlist_users_capabilities_check');
  }

  function checkUnique(candidate, selfId) {
    for (const field of UNIQUE) {
      const value = candidate[field];
      if (value === null || value === undefined) continue;
      if (rows.some((row) => row.id !== selfId && row[field] === value)) throw uniqueError(field);
    }
  }

  function applyData(row, data) {
    const next = { ...row };
    for (const [key, value] of Object.entries(data)) {
      if (value && typeof value === 'object' && 'increment' in value) next[key] = next[key] === null || next[key] === undefined ? null : next[key] + value.increment;
      else next[key] = value instanceof Date ? new Date(value) : Array.isArray(value) ? [...value] : value;
    }
    return next;
  }

  function maybeFail(op) {
    if (failNext && failNext.op === op) {
      const error = failNext.error;
      failNext = null;
      throw error;
    }
  }

  const ops = {
    async findUnique({ where, select: fields }) {
      const [[key, value]] = Object.entries(where);
      const row = rows.find((candidate) => candidate[key] === value && value !== null && value !== undefined);
      return row ? select(row, fields) : null;
    },
    async findFirst({ where = {}, orderBy, select: fields }) {
      let found = rows.filter((row) => matches(row, where));
      if (orderBy) {
        const [[key, direction]] = Object.entries(orderBy);
        found = found.sort((a, b) => (direction === 'desc' ? (b[key] ?? -1) - (a[key] ?? -1) : (a[key] ?? -1) - (b[key] ?? -1)));
      }
      return found[0] ? select(found[0], fields) : null;
    },
    async create({ data }) {
      maybeFail('create');
      // Yield first, like a real round trip, so concurrent requests interleave.
      await new Promise((resolve) => setImmediate(resolve));
      const row = {
        status: 'in_progress',
        current_step: 1,
        challenges: [],
        valuable_capabilities: [],
        resume_code_attempts: 0,
        referral_code: null,
        waitlist_position: null,
        submitted_at: null,
        ...applyData({}, data),
      };
      checkUnique(row, null);
      checkConstraints(row);
      rows.push(row);
      calls.creates += 1;
      return clone(row);
    },
    async update({ where, data }) {
      maybeFail('update');
      const index = rows.findIndex((row) => matches(row, where));
      if (index === -1) throw Object.assign(new Error('Record not found'), { code: 'P2025' });
      const next = applyData(rows[index], data);
      checkUnique(next, rows[index].id);
      checkConstraints(next);
      rows[index] = next;
      calls.updates += 1;
      return clone(next);
    },
    async updateMany({ where, data }) {
      maybeFail('updateMany');
      let count = 0;
      for (let index = 0; index < rows.length; index += 1) {
        if (!matches(rows[index], where)) continue;
        const next = applyData(rows[index], data);
        checkUnique(next, rows[index].id);
        checkConstraints(next);
        rows[index] = next;
        count += 1;
      }
      calls.updates += count;
      return { count };
    },
  };

  const waitlist_users = Object.fromEntries(Object.entries(ops).map(([name, run]) => [name, (args) => lazy(() => run(args))]));

  // Transactions: callback form runs against the same client with a simple
  // mutex standing in for pg_advisory_xact_lock; array form runs in order.
  let lock = Promise.resolve();
  const prisma = {
    waitlist_users,
    async $executeRaw() {
      calls.txLocks += 1;
      return 1;
    },
    async $transaction(operation) {
      if (Array.isArray(operation)) {
        const snapshot = rows.map((row) => ({ ...row }));
        try {
          const results = [];
          for (const pending of operation) results.push(await pending);
          return results;
        } catch (error) {
          rows.splice(0, rows.length, ...snapshot);
          throw error;
        }
      }
      const previous = lock;
      let release;
      lock = new Promise((resolve) => {
        release = resolve;
      });
      await previous;
      try {
        return await operation(prisma);
      } finally {
        release();
      }
    },
  };

  return {
    prisma,
    rows,
    calls,
    failNextOperation(op, error = Object.assign(new Error('connection reset'), { code: 'P1001' })) {
      failNext = { op, error };
    },
  };
}

module.exports = { createFakePrisma };
