const { PrismaClient } = require('@prisma/client');

async function checkDatabase() {
  const prisma = new PrismaClient();

  try {
    console.log('🔍 Checking database state...');

    // Check if pending_registrations table exists
    const tableExists = await prisma.$queryRaw`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
      AND table_name = 'pending_registrations'
    `;

    console.log('📋 pending_registrations table exists:', tableExists.length > 0);

    if (tableExists.length > 0) {
      // Check table structure
      const columns = await prisma.$queryRaw`
        SELECT column_name, data_type, is_nullable, column_default
        FROM information_schema.columns
        WHERE table_schema = 'public'
        AND table_name = 'pending_registrations'
        ORDER BY ordinal_position
      `;

      console.log('📊 Table columns:');
      columns.forEach(col => {
        console.log(`  - ${col.column_name}: ${col.data_type} ${col.is_nullable === 'YES' ? 'NULL' : 'NOT NULL'} ${col.column_default ? `DEFAULT ${col.column_default}` : ''}`);
      });

      // Check indexes
      const indexes = await prisma.$queryRaw`
        SELECT indexname, indexdef
        FROM pg_indexes
        WHERE tablename = 'pending_registrations'
      `;

      console.log('🔗 Table indexes:');
      indexes.forEach(idx => {
        console.log(`  - ${idx.indexname}: ${idx.indexdef}`);
      });
    }

    // Check migration history
    const migrations = await prisma.$queryRaw`
      SELECT migration_name, started_at, finished_at, logs
      FROM _prisma_migrations
      WHERE migration_name = '20240408000000_add_pending_registration'
    `;

    console.log('📈 Migration status:');
    if (migrations.length > 0) {
      const migration = migrations[0];
      console.log(`  - Name: ${migration.migration_name}`);
      console.log(`  - Started: ${migration.started_at}`);
      console.log(`  - Finished: ${migration.finished_at || 'NOT FINISHED'}`);
      console.log(`  - Logs: ${migration.logs || 'No logs'}`);
    } else {
      console.log('  - Migration not found in history');
    }

  } catch (error) {
    console.error('❌ Database check failed:', error.message);
    console.error('Stack:', error.stack);
  } finally {
    await prisma.$disconnect();
  }
}

checkDatabase();