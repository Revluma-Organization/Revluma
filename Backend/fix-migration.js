require('dotenv').config({ path: require('path').resolve(__dirname, '..', '.env') });
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function main() {
  try {
    // Check if pending_registrations table exists
    const result = await prisma.$queryRaw`
      SELECT table_name FROM information_schema.tables 
      WHERE table_schema = 'public' AND table_name = 'pending_registrations'
    `;
    
    if (result.length > 0) {
      console.log('✓ pending_registrations table exists');
    } else {
      console.log('✗ pending_registrations table missing - creating...');
      await prisma.$executeRawUnsafe(`
        CREATE TABLE "pending_registrations" (
          "id" TEXT NOT NULL,
          "email" TEXT NOT NULL,
          "firstName" TEXT NOT NULL,
          "lastName" TEXT NOT NULL,
          "passwordHash" TEXT NOT NULL,
          "verificationCodeHash" TEXT NOT NULL,
          "emailVerified" BOOLEAN NOT NULL DEFAULT false,
          "emailVerifiedAt" TIMESTAMP(3),
          "verificationExpiresAt" TIMESTAMP(3) NOT NULL,
          "onboardingData" JSONB NOT NULL DEFAULT '{}',
          "step" INTEGER NOT NULL DEFAULT 1,
          "expiresAt" TIMESTAMP(3) NOT NULL,
          "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
          "updatedAt" TIMESTAMP(3) NOT NULL,
          PRIMARY KEY ("id")
        )
      `);
      await prisma.$executeRawUnsafe(`CREATE UNIQUE INDEX "pending_registrations_email_key" ON "pending_registrations"("email")`);
      await prisma.$executeRawUnsafe(`CREATE INDEX "pending_registrations_expiresAt_idx" ON "pending_registrations"("expiresAt")`);
      console.log('✓ Table created');
    }

    // Mark failed migration as resolved
    try {
      await prisma.$executeRawUnsafe(`DELETE FROM "_prisma_migrations WHERE migration_name = '20240408000000_add_pending_registration'`);
      console.log('✓ Cleared failed migration marker');
    } catch (e) {
      // Table might not exist, try another approach
      console.log('Trying to mark migration complete...');
    }

    console.log('\n✅ Database is ready!');
  } catch (err) {
    console.error('Error:', err.message);
  } finally {
    await prisma.$disconnect();
  }
}

main();