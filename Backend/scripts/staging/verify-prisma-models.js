'use strict';
// Assert that every model in prisma/schema.prisma has a real table in the
// connected database, and that the database holds no application table that the
// schema does not describe. This is a readability layer over
// `prisma migrate diff --exit-code`: the diff proves column/index/FK/enum
// equality, this proves the model-to-table mapping the backend actually uses.
//
//   DATABASE_URL=... node scripts/staging/verify-prisma-models.js

const fs = require('fs');
const path = require('path');
const { prisma } = require('../../src/configs/database');

const schemaPath = path.resolve(__dirname, '..', '..', 'prisma', 'schema.prisma');

function parseModels(schema) {
  const models = new Map();
  const modelPattern = /^model\s+(\w+)\s*\{([\s\S]*?)^\}/gm;
  let match;
  while ((match = modelPattern.exec(schema)) !== null) {
    const [, name, body] = match;
    const mapMatch = body.match(/@@map\("([^"]+)"\)/);
    models.set(name, mapMatch ? mapMatch[1] : name);
  }
  return models;
}

async function main() {
  const schema = fs.readFileSync(schemaPath, 'utf8');
  const models = parseModels(schema);
  if (models.size === 0) throw new Error('no models parsed from schema.prisma');

  const rows = await prisma.$queryRawUnsafe(
    `SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public' AND table_type = 'BASE TABLE'`,
  );
  const tables = new Set(rows.map((row) => row.table_name));

  const missing = [...models.entries()].filter(([, table]) => !tables.has(table));
  const expected = new Set(models.values());
  const unexpected = [...tables].filter((table) => table !== '_prisma_migrations' && !expected.has(table));

  console.log(`prisma models: ${models.size}`);
  console.log(`public tables: ${tables.size}`);

  if (missing.length) {
    console.error('missing tables:', missing.map(([model, table]) => `${model} -> ${table}`).join(', '));
  }
  if (unexpected.length) {
    console.error('tables not described by schema.prisma:', unexpected.join(', '));
  }
  await prisma.$disconnect();

  if (missing.length || unexpected.length) {
    process.exitCode = 1;
    return;
  }
  console.log('PASS: every Prisma model has a table and the database has no unexplained table');
}

main().catch(async (error) => {
  console.error('model verification failed:', error.message);
  process.exitCode = 1;
  await prisma.$disconnect().catch(() => {});
});
