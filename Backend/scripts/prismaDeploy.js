const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();
const migrationsPath = path.join(__dirname, '..', 'prisma', 'migrations');

function runCommand(command) {
    console.log(`Running: ${command}`);
    execSync(command, { stdio: 'inherit' });
}

async function tableExists(tableName) {
  const result = await prisma.$queryRaw`
    SELECT to_regclass(${tableName})::text AS table_exists
  `;
  return result?.[0]?.table_exists !== null;

async function countPublicTables() {
  const result = await prisma.$queryRaw`
    SELECT COUNT(*)::int AS count FROM pg_tables WHERE schemaname = 'public'
  `;
  return result?.[0]?.count ?? 0;

function getInitialMigrationName() {
    if (!fs.existsSync(migrationsPath)) {
        throw new Error(`Migrations directory not found: ${migrationsPath}`);
    }

    const migrationDirs = fs.readdirSync(migrationsPath)
        .filter((entry) => fs.statSync(path.join(migrationsPath, entry)).isDirectory())
        .sort();

    if (migrationDirs.length === 0) {
        throw new Error('No migrations found in prisma/migrations');
    }

    return migrationDirs[0];
}

async function main() {
    try {
        const migrationsTableExists = await tableExists('_prisma_migrations');
        const publicTableCount = await countPublicTables();

        if (!migrationsTableExists) {
            if (publicTableCount === 0) {
                console.log('No schema detected. Applying migrations to empty database.');
                runCommand('npx prisma migrate deploy');
            } else {
                const initialMigration = getInitialMigrationName();
                console.log('Existing schema detected without Prisma migration history.');
                console.log(`Baselining using migration: ${initialMigration}`);
                runCommand(`npx prisma migrate resolve --applied ${initialMigration}`);
                runCommand('npx prisma migrate deploy');
            }
        } else {
            console.log('Prisma migrations table already exists. Deploying migrations normally.');
            runCommand('npx prisma migrate deploy');
        }

        console.log('Prisma migration step completed successfully.');
        process.exit(0);
    } catch (error) {
        console.error('Prisma deployment helper failed:', error.message);
        process.exit(1);
    } finally {
        await prisma.$disconnect();
    }
}

main();
