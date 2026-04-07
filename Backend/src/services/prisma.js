// ============================================================
// Prisma Client Service
// Production-ready database access layer
// ============================================================

const { PrismaClient } = require('@prisma/client');

// Create a single PrismaClient instance
const prisma = new PrismaClient({
  log: process.env.NODE_ENV === 'development' ? ['query', 'error', 'warn'] : ['error'],
});

// Handle connection errors
prisma.$on('error', (e) => {
  console.error('[Prisma] Error:', e.message);
});

prisma.$on('warn', (e) => {
  console.warn('[Prisma] Warning:', e.message);
});

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
};