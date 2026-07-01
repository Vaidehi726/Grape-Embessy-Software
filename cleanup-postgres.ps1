# Cleanup PostgreSQL Dependencies
# Run this after removing PostgreSQL code

Write-Host "=== Cleaning up PostgreSQL dependencies ===" -ForegroundColor Cyan
Write-Host ""

Write-Host "1. Removing node_modules..." -ForegroundColor Yellow
if (Test-Path "node_modules") {
    Remove-Item -Recurse -Force "node_modules" -ErrorAction SilentlyContinue
    Write-Host "   ✓ node_modules removed" -ForegroundColor Green
} else {
    Write-Host "   ✓ node_modules not found" -ForegroundColor Green
}

Write-Host ""
Write-Host "2. Removing package-lock.json..." -ForegroundColor Yellow
if (Test-Path "package-lock.json") {
    Remove-Item -Force "package-lock.json" -ErrorAction SilentlyContinue
    Write-Host "   ✓ package-lock.json removed" -ForegroundColor Green
} else {
    Write-Host "   ✓ package-lock.json not found" -ForegroundColor Green
}

Write-Host ""
Write-Host "3. Reinstalling dependencies (SQLite only)..." -ForegroundColor Yellow
Write-Host "   This may take a few minutes..." -ForegroundColor Gray
npm install

Write-Host ""
Write-Host "=== Cleanup complete! ===" -ForegroundColor Cyan
Write-Host ""
Write-Host "PostgreSQL packages removed:" -ForegroundColor Yellow
Write-Host "  - @embedded-postgres/windows-x64" -ForegroundColor White
Write-Host "  - embedded-postgres" -ForegroundColor White
Write-Host "  - pg" -ForegroundColor White
Write-Host "  - @types/pg" -ForegroundColor White
Write-Host ""
Write-Host "Remaining database: SQLite (better-sqlite3)" -ForegroundColor Green
Write-Host ""
Read-Host "Press Enter to exit"
