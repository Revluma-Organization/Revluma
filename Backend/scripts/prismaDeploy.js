const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient({
  log: ['error', 'warn'],
});

const migrationsPath = path.join(__dirname, '..', 'prisma', 'migrations');

function runCommand(command) {
  try {
    console.log(`\n▶ Running: ${command}`);
    execSync(command, { stdio: 'inherit', timeout: 60000 });
  } catch (err) {
    console.error(`❌ Command failed: ${command}`);
    throw err;
  }
}

async function tableExists(tableName) {
  try {
    const result = await prisma.$queryRaw`
      SELECT to_regclass(${tableName})::text AS table_exists
    `;
    return result?.[0]?.table_exists !== null;
  } catch (err) {
    console.error('❌ tableExists check failed:', err.message);
    throw err;
  }
}

async function countPublicTables() {
  try {
    const result = await prisma.$queryRaw`
      SELECT COUNT(*)::int AS count 
      FROM pg_tables 
      WHERE schemaname = 'public'
    `;
    return result?.[0]?.count ?? 0;
  } catch (err) {
    console.error('❌ countPublicTables failed:', err.message);
    throw err;
  }
}

function getInitialMigrationName() {
  if (!fs.existsSync(migrationsPath)) {
    throw new Error(`Migrations directory not found: ${migrationsPath}`);
  }

  const migrationDirs = fs
    .readdirSync(migrationsPath)
    .filter((entry) =>
      fs.statSync(path.join(migrationsPath, entry)).isDirectory()
    )
    .sort();

  if (migrationDirs.length === 0) {
    throw new Error('No migrations found in prisma/migrations');
  }

  return migrationDirs[0];
}

async function main() {
  try {
    console.log('🔌 Connecting to database...');
    await prisma.$connect();

    const migrationsTableExists = await tableExists('_prisma_migrations');
    const publicTableCount = await countPublicTables();

    console.log(`📊 Public tables: ${publicTableCount}`);
    console.log(`📦 Migrations table exists: ${migrationsTableExists}`);

    if (!migrationsTableExists) {
      if (publicTableCount === 0) {
        console.log('🆕 Empty database detected. Applying migrations...');
        runCommand('npx prisma migrate deploy');
      } else {
        const initialMigration = getInitialMigrationName();
        console.log('⚠️ Existing schema detected without migration history.');
        console.log(`📌 Baselining with: ${initialMigration}`);

        runCommand(`npx prisma migrate resolve --applied ${initialMigration}`);
        runCommand('npx prisma migrate deploy');
      }
    } else {
      console.log('✅ Migration table exists. Running normal deploy...');
      runCommand('npx prisma migrate deploy');
    }

    console.log('🎉 Prisma migration step completed successfully.');
    process.exit(0);
  } catch (error) {
    console.error('🔥 Prisma deployment helper failed:');
    console.error(error.message);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main();