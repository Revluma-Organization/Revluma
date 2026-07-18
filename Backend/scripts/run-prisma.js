const { spawn } = require('child_process');
const path = require('path');
const { config } = require('dotenv');

const envFile = path.resolve(process.cwd(), '.env.production');
config({ path: envFile, override: false });

if (!process.env.DIRECT_URL && process.env.DATABASE_URL) {
    process.env.DIRECT_URL = process.env.DATABASE_URL;
}

const args = process.argv.slice(2);
const command = process.platform === 'win32' ? 'cmd.exe' : 'sh';
const commandArgs = process.platform === 'win32'
    ? ['/c', `npx prisma ${args.map((arg) => (arg.includes(' ') ? `"${arg}"` : arg)).join(' ')}`]
    : ['-lc', `npx prisma ${args.map((arg) => (arg.includes(' ') ? `"${arg}"` : arg)).join(' ')}`];
const child = spawn(command, commandArgs, {
    stdio: 'inherit',
    env: process.env,
});

child.on('exit', (code) => {
    process.exit(code ?? 0);
});

child.on('error', (error) => {
    console.error(error);
    process.exit(1);
});
