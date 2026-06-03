// ============================================================
// Prisma Client Service
// Production-ready database access layer
// ============================================================

const { PrismaClient } = require('@prisma/client');
const logger = require('../utils/logger');

const prisma = new PrismaClient({
  log: process.env.NODE_ENV === 'development' ? ['query', 'error', 'warn'] : ['error'],
});

// Warn on queries taking >5s so slow DB calls surface in logs
prisma.$use(async (params, next) => {
  const start = Date.now();
  const result = await next(params);
  const ms = Date.now() - start;
  if (ms > 5000) {
    logger.warn('Slow Prisma operation detected', {
      model: params.model,
      action: params.action,
      ms,
      args: params.args
    });
  }
  return result;
});

prisma.$on('error', (e) => {
  logger.error('[Prisma] Runtime error', { message: e.message });
});

prisma.$on('warn', (e) => {
  logger.warn('[Prisma] Runtime warning', { message: e.message });
});

// Apply connection pooling and timeout settings via URL query params
const prismaUrl = process.env.DATABASE_URL || process.env.DIRECT_URL;
if (prismaUrl) {
  try {
    const url = new URL(prismaUrl);
    url.searchParams.set('connection_limit', '10');
    url.searchParams.set('pool_timeout', '30000');
    url.searchParams.set('connect_timeout', '15000');
    url.searchParams.set('idle_in_transaction_session_timeout', '30000');
    // Override the env var so Prisma picks up the modified URL on connect
    process.env.DATABASE_URL = url.toString();
    if (process.env.DIRECT_URL) {
      process.env.DIRECT_URL = url.toString();
    }
    logger.info('[Prisma] Connection timeout params applied', { url: url.toString().replace(/\/\/.*@/, '//***@') });
  } catch (e) {
    logger.warn('[Prisma] Could not parse DATABASE_URL for timeout config', { error: e.message });
  }
}

// ============================================================
// Database Health Check
// ============================================================

async function checkConnection() {
  try {
    await prisma.$connect();
    console.log('[Prisma] ✓ Database connected');
    return true;
  } catch (error) {
    console.error('[Prisma] ✗ Database connection failed:', error.message);
    return false;
  }
}

// ============================================================
// Graceful Shutdown
// ============================================================

async function closeConnection() {
  await prisma.$disconnect();
  console.log('[Prisma] Disconnected');
}

process.on('SIGINT', async () => {
  await closeConnection();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  await closeConnection();
  process.exit(0);
});

// ============================================================
// Transaction Helper
// ============================================================

async function transaction(callback) {
  return await prisma.$transaction(callback);
}

// ============================================================
// Exports
// ============================================================

module.exports = {
  prisma,
  checkConnection,
  closeConnection,
  transaction,
  // Re-export for convenience
  Tenant: prisma.tenant,
  User: prisma.user,
  TenantProfile: prisma.tenantProfile,
  EmailVerificationCode: prisma.emailVerificationCode,
  PasswordResetToken: prisma.passwordResetToken,
  PasswordHistory: prisma.passwordHistory,
  UserSession: prisma.userSession,
  AbandonedCart: prisma.abandonedCart,
  RecoveryEvent: prisma.recoveryEvent,
  Benchmark: prisma.benchmark,
  CustomerCrm: prisma.customerCrm,
  LtvSegment: prisma.ltvSegment,
  ChurnEvent: prisma.churnEvent,
  AutomationTask: prisma.automationTask,
  NewsletterSubscriber: prisma.newsletterSubscriber,
  NewsletterSend: prisma.newsletterSend,
  NewsletterSendEvent: prisma.newsletterSendEvent,
  PendingRegistration: prisma.pendingRegistration,
};