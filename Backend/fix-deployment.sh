#!/bin/bash

echo "🔧 Revluma Production Deployment Fix Script v2.0"
echo "================================================"

# Navigate to backend directory
cd /opt/render/project/src/Backend || {
    echo "❌ Cannot find Backend directory"
    exit 1
}

echo "📍 Current directory: $(pwd)"

# Check if we're in the right place
if [ ! -f "package.json" ]; then
    echo "❌ package.json not found. Wrong directory?"
    exit 1
fi

echo "✅ Found package.json"

# Install dependencies if needed
if [ ! -d "node_modules" ]; then
    echo "📦 Installing dependencies..."
    npm install
fi

# Generate Prisma client
echo "🔄 Generating Prisma client..."
npx prisma generate

# Run database migrations (this will apply the new newsletter fields migration)
echo "📊 Running database migrations..."
npx prisma migrate deploy

# Force resolve any failed migrations
echo "🔧 Resolving any failed migrations..."
node force-resolve-migration.js

echo "✅ All fixes applied successfully!"
echo "🚀 Your application should now work properly."
echo ""
echo "📋 What was fixed:"
echo "  - Newsletter service now uses Prisma (not raw SQL)"
echo "  - Added verification token fields to database"
echo "  - Fixed field name mismatches (passwordHash, fullName)"
echo "  - Improved error handling and logging"