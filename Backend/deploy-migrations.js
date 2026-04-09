require('dotenv').config({ path: require('path').resolve(__dirname, '..', '.env') });

const { PrismaClient } = require('@prisma/client');
const fs = require('fs');
const path = require('path');

const prisma = new PrismaClient();

async function runSQL(sql) {
  const statements = sql.split(';').filter(s => s.trim());
  for (const stmt of statements) {
    if (stmt.trim()) {
      try {
        await prisma.$executeRawUnsafe(stmt);
      } catch (err) {
        if (!err.message.includes('already exists') && !err.message.includes('duplicate')) {
          throw err;
        }
      }
    }
  }
}

async function main() {
  console.log('Loading migrations...');
  
  const migrationsDir = path.join(__dirname, 'prisma/migrations');
  const migrationFolders = fs.readdirSync(migrationsDir).filter(f => f.startsWith('20'));
  
  for (const folder of migrationFolders.sort()) {
    const sqlFile = path.join(migrationsDir, folder, 'migration.sql');
    if (fs.existsSync(sqlFile)) {
      console.log(`Running migration: ${folder}`);
      const sql = fs.readFileSync(sqlFile, 'utf-8');
      
      try {
        await runSQL(sql);
        console.log(`✓ ${folder} completed`);
      } catch (err) {
        if (err.message.includes('already exists') || err.message.includes('duplicate')) {
          console.log(`✓ ${folder} already applied`);
        } else {
          console.error(`✗ ${folder} failed:`, err.message);
        }
      }
    }
  }
  await prisma.$disconnect();
  console.log('All migrations complete!');
}

main().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect();
  process.exit(1);
});