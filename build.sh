#!/bin/bash

echo "🚀 Building Nati-Backup..."

echo "📦 Installing frontend dependencies..."
cd frontend
npm install

echo "🔨 Building frontend..."
npm run build

cd ..

echo "🐳 Building Docker image..."
docker-compose build

echo "✅ Build complete!"
echo ""
echo "To start the application, run:"
echo "  docker-compose up -d"
echo ""
echo "Then open http://localhost:8000 in your browser"
