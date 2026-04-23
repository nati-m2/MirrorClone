Write-Host "🚀 Building Nati-Backup..." -ForegroundColor Cyan

Write-Host "📦 Installing frontend dependencies..." -ForegroundColor Yellow
Set-Location frontend
npm install

Write-Host "🔨 Building frontend..." -ForegroundColor Yellow
npm run build

Set-Location ..

Write-Host "🐳 Building Docker image..." -ForegroundColor Yellow
docker-compose build

Write-Host "✅ Build complete!" -ForegroundColor Green
Write-Host ""
Write-Host "To start the application, run:" -ForegroundColor Cyan
Write-Host "  docker-compose up -d" -ForegroundColor White
Write-Host ""
Write-Host "Then open http://localhost:8000 in your browser" -ForegroundColor Cyan
