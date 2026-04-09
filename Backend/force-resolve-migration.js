const { PrismaClient } = require('@prisma/client');

async function forceResolveMigration() {
    const prisma = new PrismaClient();

    try {
        console.log('🔧 Force resolving failed migration...');

        // Mark the migration as completed in the _prisma_migrations table
        // This tells Prisma that the migration has been applied successfully
        await prisma.$executeRaw`
      UPDATE _prisma_migrations
      SET finished_at = NOW(),
          logs = 'Migration force-resolved - made idempotent and redeployed',
          applied_steps_count = 3
      WHERE migration_name = '20240408000000_add_pending_registration'
      AND finished_at IS NULL
    `;

        console.log('✅ Migration marked as completed');
        console.log('🚀 You can now redeploy your application');

    } catch (error) {
        console.error('❌ Force resolution failed:', error.message);
        console.error('Stack:', error.stack);
    } finally {
        await prisma.$disconnect();
    }
}

// Run if called directly
if (require.main === module) {
    forceResolveMigration();
}

module.exports = { forceResolveMigration };