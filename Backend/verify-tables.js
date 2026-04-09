require('dotenv').config({ path: require('path').resolve(__dirname, '..', '.env') });
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function main() {
  try {
    const tenants = await prisma.tenant.count();
    const users = await prisma.user.count();
    const pending = await prisma.pendingRegistration.count();
    console.log('tenants:', tenants);
    console.log('users:', users);
    console.log('pending_registrations:', pending);
  } catch (err) {
    console.error('Table check error:', err.message);
  } finally {
    await prisma.$disconnect();
  }
}

main();