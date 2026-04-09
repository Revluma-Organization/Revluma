# Prisma Migration Resolution Guide

## Problem
Your deployment failed with error:
```
P3009: migrate found failed migrations in the target database, new migrations will not be applied.
The '20240408000000_add_pending_registration' migration started at 2026-04-08 23:28:27.897016 UTC failed
```

## Root Cause
The migration to create the `pending_registrations` table failed partway through in your production database. Prisma won't apply new migrations until failed ones are resolved.

## Solutions (Choose One)

### Option 1: Force Resolve (Recommended - Safest)
If the table was created successfully despite the error, mark the migration as completed:

```bash
# In your production environment (Render shell or SSH)
cd /opt/render/project/src/Backend
node force-resolve-migration.js
```

Then redeploy your application.

### Option 2: Database Reset (Destructive - Use Only If Necessary)
If you want to start fresh (⚠️ **THIS WILL DELETE ALL DATA**):

```bash
# In production environment
cd /opt/render/project/src/Backend
npx prisma migrate reset --force
```

### Option 3: Manual Database Check
Run the diagnostic script to see the current state:

```bash
# In production environment
cd /opt/render/project/src/Backend
node resolve-migration.js
```

This will tell you exactly what's wrong and what to do.

## What Was Fixed

1. **Made Migration Idempotent**: Added `IF NOT EXISTS` to all CREATE statements
2. **Updated Checksum**: Migration checksum updated to reflect changes
3. **Created Resolution Scripts**: Scripts to diagnose and fix the issue

## Prevention

For future deployments, consider:
- Testing migrations locally before deploying
- Using database backups before major changes
- Implementing proper CI/CD with migration testing

## Files Modified
- `prisma/migrations/20240408000000_add_pending_registration/migration.sql` - Made idempotent
- `prisma/migrations/20240408000000_add_pending_registration/migration.json` - Updated checksum
- `force-resolve-migration.js` - New resolution script
- `resolve-migration.js` - Diagnostic script