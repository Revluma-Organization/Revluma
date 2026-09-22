const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

function findTests(directory) {
  const files = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...findTests(target));
    else if (entry.name.endsWith('.test.js')) files.push(target);
  }
  return files;
}

const root = path.resolve(__dirname, '..');
const tests = findTests(path.join(root, 'src')).sort();
const env = {
  ...process.env,
  JWT_SECRET: process.env.JWT_SECRET || 'backend-test-jwt-secret-with-sufficient-length',
  COOKIE_SECRET: process.env.COOKIE_SECRET || 'backend-test-cookie-secret',
  SHOPIFY_TOKEN_ENCRYPTION_KEY: process.env.SHOPIFY_TOKEN_ENCRYPTION_KEY || '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
  SENDGRID_API_KEY: process.env.SENDGRID_API_KEY || 'SG.backend-test-key',
};

for (const test of tests) {
  const result = spawnSync(process.execPath, [test], { cwd: root, env, stdio: 'inherit' });
  if (result.status !== 0) process.exit(result.status || 1);
}

console.log(`Backend test files passed: ${tests.length}`);
