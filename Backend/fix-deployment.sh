#!/bin/bash

echo "🔧 Revluma Production Deployment Fix Script"
echo "=========================================="

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

# Force resolve the failed migration
echo "🔧 Resolving failed migration..."
node force-resolve-migration.js

# Run database migrations
echo "📊 Running database migrations..."
npx prisma migrate deploy

echo "✅ Deployment fixes applied successfully!"
echo "🚀 Your application should now start properly."