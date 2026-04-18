const { Queue, Worker } = require('bullmq');
const IORedis = require('ioredis');

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';

const connection = new IORedis(REDIS_URL, {
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
});

const QUEUE_NAMES = {
  SYNC_HISTORICAL: 'revluma:sync:historical',
  WEBHOOKS_INGEST: 'revluma:webhooks:ingest',
  EVENTS_INTERNAL: 'revluma:events:internal',
  RECOVERY_TRIGGERS: 'revluma:recovery:triggers',
  HEALTH_CHECKS: 'revluma:health:checks',
};

function createQueue(name, options = {}) {
  return new Queue(name, {
    connection,
    defaultJobOptions: {
      attempts: 3,
      backoff: {
        type: 'exponential',
        delay: 1000,
      },
      removeOnComplete: {
        age: 3600,
        count: 1000,
      },
      removeOnFail: {
        age: 86400,
      },
      ...options,
    },
    ...options,
  });
}

const syncQueue = createQueue(QUEUE_NAMES.SYNC_HISTORICAL, {
  defaultJobOptions: {
    attempts: 5,
    backoff: {
      type: 'exponential',
      delay: 1000,
      maxDelay: 300000,
    },
  },
});

const webhookQueue = createQueue(QUEUE_NAMES.WEBHOOKS_INGEST, {
  defaultJobOptions: {
    attempts: 2,
    backoff: {
      type: 'fixed',
      delay: 500,
    },
  },
});

const eventsQueue = createQueue(QUEUE_NAMES.EVENTS_INTERNAL, {
  defaultJobOptions: {
    attempts: 3,
  },
});

const recoveryQueue = createQueue(QUEUE_NAMES.RECOVERY_TRIGGERS, {
  defaultJobOptions: {
    attempts: 1,
    removeOnComplete: {
      age: 86400,
    },
  },
});

const healthQueue = createQueue(QUEUE_NAMES.HEALTH_CHECKS, {
  defaultJobOptions: {
    attempts: 3,
    backoff: {
      type: 'exponential',
      delay: 60000,
    },
    repeat: {
      every: 300000,
    },
  },
});

async function addSyncJob(storeId, platform, resource, options = {}) {
  return syncQueue.add('sync', {
    storeId,
    platform,
    resource,
    ...options,
  }, {
    ...options,
    jobId: `${storeId}:${resource}`,
  });
}

async function addWebhookJob(storeId, platform, topic, rawBody, headers) {
  return webhookQueue.add('webhook', {
    storeId,
    platform,
    topic,
    rawBody: typeof rawBody === 'string' ? rawBody : JSON.stringify(rawBody),
    headers,
    receivedAt: new Date().toISOString(),
  });
}

async function addInternalEvent(event) {
  return eventsQueue.add('event', event);
}

async function addRecoveryTrigger(checkoutId, channel, sequence) {
  return recoveryQueue.add('trigger', {
    checkoutId,
    channel,
    sequence,
    scheduledFor: new Date().toISOString(),
  });
}

function createWorker(name, processor, options = {}) {
  return new Worker(name, processor, {
    connection,
    concurrency: options.concurrency || 5,
    limiter: options.limiter,
    settings: {
      backoffStrategy: (attemptsMade) =>
        Math.min(1000 * Math.pow(2, attemptsMade), 300000),
    },
  });
}

const workers = {
  sync: createWorker(QUEUE_NAMES.SYNC_HISTORICAL, null, { concurrency: 5 }),
  webhook: createWorker(QUEUE_NAMES.WEBHOOKS_INGEST, null, { concurrency: 50 }),
  events: createWorker(QUEUE_NAMES.EVENTS_INTERNAL, null, { concurrency: 20 }),
  recovery: createWorker(QUEUE_NAMES.RECOVERY_TRIGGERS, null, { concurrency: 10 }),
  health: createWorker(QUEUE_NAMES.HEALTH_CHECKS, null, { concurrency: 1 }),
};

async function closeAll() {
  await Promise.all([
    syncQueue.close(),
    webhookQueue.close(),
    eventsQueue.close(),
    recoveryQueue.close(),
    healthQueue.close(),
    ...Object.values(workers).map(w => w?.close()),
  ]);
  await connection.quit();
}

module.exports = {
  connection,
  QUEUE_NAMES,
  queues: {
    sync: syncQueue,
    webhook: webhookQueue,
    events: eventsQueue,
    recovery: recoveryQueue,
    health: healthQueue,
  },
  workers,
  createQueue,
  createWorker,
  addSyncJob,
  addWebhookJob,
  addInternalEvent,
  addRecoveryTrigger,
  closeAll,
};