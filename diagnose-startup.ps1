# RestroFlow Startup Diagnostic Script
# Run this to diagnose why the app won't open

Write-Host "=== RestroFlow Diagnostic Tool ===" -ForegroundColor Cyan
Write-Host ""

# Check 1: Look for stuck processes
Write-Host "1. Checking for stuck processes..." -ForegroundColor Yellow
$processes = Get-Process | Where-Object { $_.ProcessName -match 'RestroFlow|electron|postgres|pg_ctl' }
if ($processes) {
    Write-Host "   FOUND stuck processes:" -ForegroundColor Red
    $processes | ForEach-Object { Write-Host "   - $($_.ProcessName) (PID: $($_.Id))" -ForegroundColor Red }
    Write-Host ""
    $kill = Read-Host "   Kill these processes? (Y/N)"
    if ($kill -eq 'Y' -or $kill -eq 'y') {
        $processes | Stop-Process -Force
        Write-Host "   ✓ Processes killed" -ForegroundColor Green
    }
} else {
    Write-Host "   ✓ No stuck processes found" -ForegroundColor Green
}

Write-Host ""

# Check 2: Check AppData folder
Write-Host "2. Checking AppData folder..." -ForegroundColor Yellow
$appDataPath = "$env:APPDATA\RestroFlow"
if (Test-Path $appDataPath) {
    Write-Host "   Found: $appDataPath" -ForegroundColor Yellow
    $size = (Get-ChildItem $appDataPath -Recurse -ErrorAction SilentlyContinue | Measure-Object -Property Length -Sum).Sum / 1MB
    Write-Host "   Size: $([math]::Round($size, 2)) MB" -ForegroundColor Yellow
    
    # Check for locked files
    Write-Host "   Checking for locked files..." -ForegroundColor Yellow
    $dbFile = "$appDataPath\restroflow.db"
    if (Test-Path $dbFile) {
        try {
            $stream = [System.IO.File]::Open($dbFile, 'Open', 'ReadWrite')
            $stream.Close()
            Write-Host "   ✓ Database file is NOT locked" -ForegroundColor Green
        } catch {
            Write-Host "   ✗ Database file IS locked by another process" -ForegroundColor Red
            Write-Host "     You need to kill the process holding the lock" -ForegroundColor Red
        }
    }
    
    Write-Host ""
    $clean = Read-Host "   Delete AppData folder for clean start? (Y/N)"
    if ($clean -eq 'Y' -or $clean -eq 'y') {
        try {
            Remove-Item -Recurse -Force $appDataPath -ErrorAction Stop
            Write-Host "   ✓ AppData folder deleted" -ForegroundColor Green
        } catch {
            Write-Host "   ✗ Failed to delete: $_" -ForegroundColor Red
            Write-Host "     Try closing all processes first, then run this script again" -ForegroundColor Yellow
        }
    }
} else {
    Write-Host "   ✓ AppData folder doesn't exist (clean state)" -ForegroundColor Green
}

Write-Host ""

# Check 3: Check installation
Write-Host "3. Checking installation..." -ForegroundColor Yellow
$installPaths = @(
    "C:\Program Files\RestroFlow",
    "C:\Program Files (x86)\RestroFlow",
    "$env:LOCALAPPDATA\Programs\RestroFlow"
)

$found = $false
foreach ($path in $installPaths) {
    if (Test-Path "$path\RestroFlow.exe") {
        Write-Host "   ✓ Found at: $path" -ForegroundColor Green
        $found = $true
        Write-Host ""
        $run = Read-Host "   Try running RestroFlow.exe now? (Y/N)"
        if ($run -eq 'Y' -or $run -eq 'y') {
            Write-Host "   Launching..." -ForegroundColor Cyan
            Start-Process "$path\RestroFlow.exe"
            Write-Host "   ✓ Launched! Check if it opens" -ForegroundColor Green
        }
        break
    }
}

if (-not $found) {
    Write-Host "   ✗ RestroFlow not found in standard locations" -ForegroundColor Red
    Write-Host "   You may need to reinstall the application" -ForegroundColor Yellow
}

Write-Host ""
Write-Host "=== Diagnostic Complete ===" -ForegroundColor Cyan
Write-Host ""
Write-Host "If the app still won't open:" -ForegroundColor Yellow
Write-Host "1. Reinstall using the latest installer" -ForegroundColor White
Write-Host "2. Check Windows Event Viewer for crash logs" -ForegroundColor White
Write-Host "3. Run as Administrator to check for permission issues" -ForegroundColor White
Write-Host ""
Read-Host "Press Enter to exit"
