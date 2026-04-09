const { PrismaClient } = require('@prisma/client');

async function resolveFailedMigration() {
    const prisma = new PrismaClient();

    try {
        console.log('🔧 Resolving failed migration: 20240408000000_add_pending_registration');

        // Check if the table exists
        const tableExists = await prisma.$queryRaw`
      SELECT EXISTS (
        SELECT 1
        FROM information_schema.tables
        WHERE table_schema = 'public'
        AND table_name = 'pending_registrations'
      )
    `;

        const exists = tableExists[0].exists;
        console.log('📋 pending_registrations table exists:', exists);

        if (exists) {
            // Check if table structure is correct
            const columns = await prisma.$queryRaw`
        SELECT column_name, data_type, is_nullable::boolean as is_nullable,
               column_default, udt_name
        FROM information_schema.columns
        WHERE table_schema = 'public'
        AND table_name = 'pending_registrations'
        ORDER BY ordinal_position
      `;

            console.log('📊 Checking table structure...');

            // Expected columns from migration
            const expectedColumns = {
                id: { type: 'text', nullable: false },
                email: { type: 'text', nullable: false },
                firstName: { type: 'text', nullable: false },
                lastName: { type: 'text', nullable: false },
                passwordHash: { type: 'text', nullable: false },
                verificationCodeHash: { type: 'text', nullable: false },
                emailVerified: { type: 'boolean', nullable: false },
                emailVerifiedAt: { type: 'timestamp', nullable: true },
                verificationExpiresAt: { type: 'timestamp', nullable: false },
                onboardingData: { type: 'jsonb', nullable: false },
                step: { type: 'integer', nullable: false },
                expiresAt: { type: 'timestamp', nullable: false },
                createdAt: { type: 'timestamp', nullable: false },
                updatedAt: { type: 'timestamp', nullable: false }
            };

            let structureOk = true;
            for (const [colName, expected] of Object.entries(expectedColumns)) {
                const actual = columns.find(c => c.column_name === colName);
                if (!actual) {
                    console.log(`❌ Missing column: ${colName}`);
                    structureOk = false;
                    continue;
                }

                const typeMatch = actual.udt_name === expected.type ||
                    (expected.type === 'timestamp' && actual.udt_name === 'timestamptz') ||
                    (expected.type === 'text' && actual.udt_name === 'varchar');

                if (!typeMatch) {
                    console.log(`❌ Wrong type for ${colName}: expected ${expected.type}, got ${actual.udt_name}`);
                    structureOk = false;
                }

                if (actual.is_nullable !== expected.nullable) {
                    console.log(`❌ Wrong nullable for ${colName}: expected ${expected.nullable}, got ${actual.is_nullable}`);
                    structureOk = false;
                }
            }

            if (structureOk) {
                console.log('✅ Table structure is correct');

                // Check indexes
                const indexes = await prisma.$queryRaw`
          SELECT indexname, indexdef
          FROM pg_indexes
          WHERE tablename = 'pending_registrations'
        `;

                const hasEmailIndex = indexes.some(idx => idx.indexname.includes('email_key'));
                const hasExpiresIndex = indexes.some(idx => idx.indexname.includes('expiresAt_idx'));

                console.log('🔗 Email unique index exists:', hasEmailIndex);
                console.log('🔗 ExpiresAt index exists:', hasExpiresIndex);

                if (hasEmailIndex && hasExpiresIndex) {
                    console.log('✅ All indexes exist');

                    // Mark migration as completed
                    console.log('📝 Marking migration as completed...');

                    await prisma.$executeRaw`
            UPDATE _prisma_migrations
            SET finished_at = NOW(),
                logs = 'Migration resolved manually - table and indexes already exist',
                applied_steps_count = 3
            WHERE migration_name = '20240408000000_add_pending_registration'
          `;

                    console.log('✅ Migration marked as completed');
                    console.log('🚀 You can now run: npx prisma migrate deploy');

                } else {
                    console.log('❌ Missing indexes. Migration needs to be reapplied.');
                    console.log('💡 Run: npx prisma migrate reset (CAUTION: This will reset your database)');
                }

            } else {
                console.log('❌ Table structure is incorrect. Migration needs to be reapplied.');
                console.log('💡 Run: npx prisma migrate reset (CAUTION: This will reset your database)');
            }

        } else {
            console.log('❌ Table does not exist. Migration failed completely.');
            console.log('💡 Try redeploying or run: npx prisma migrate reset');
        }

    } catch (error) {
        console.error('❌ Resolution failed:', error.message);
        console.error('Stack:', error.stack);
    } finally {
        await prisma.$disconnect();
    }
}

resolveFailedMigration();