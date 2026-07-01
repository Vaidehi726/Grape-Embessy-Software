# LAN Client Test Script
# This script tests the LAN client functionality

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  LAN Client Functionality Test" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# Get the local IP address
$localIP = (Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.InterfaceAlias -notlike "*Loopback*" -and $_.IPAddress -like "192.168.*" -or $_.IPAddress -like "10.*" } | Select-Object -First 1).IPAddress

if (-not $localIP) {
    $localIP = (Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.InterfaceAlias -notlike "*Loopback*" } | Select-Object -First 1).IPAddress
}

Write-Host "Your Local IP: $localIP" -ForegroundColor Green
Write-Host ""

# Instructions for testing
Write-Host "========================================" -ForegroundColor Yellow
Write-Host "  STEP 1: Start LAN Server" -ForegroundColor Yellow
Write-Host "========================================" -ForegroundColor Yellow
Write-Host ""
Write-Host "On the MAIN PC (Server), run:" -ForegroundColor White
Write-Host "  npm run dev:electron" -ForegroundColor Green
Write-Host ""
Write-Host "Then in the app:" -ForegroundColor White
Write-Host "  1. Go to Settings → LAN Settings" -ForegroundColor White
Write-Host "  2. Select 'LAN Server' mode" -ForegroundColor White
Write-Host "  3. Note the server IP shown (should be: $localIP)" -ForegroundColor White
Write-Host ""
Write-Host "Press any key to continue..." -ForegroundColor Yellow
$null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")
Write-Host ""

Write-Host "========================================" -ForegroundColor Yellow
Write-Host "  STEP 2: Start LAN Client" -ForegroundColor Yellow
Write-Host "========================================" -ForegroundColor Yellow
Write-Host ""
Write-Host "On the CLIENT PC (or same PC in new window), run:" -ForegroundColor White
Write-Host "  npm run dev:electron" -ForegroundColor Green
Write-Host ""
Write-Host "Then in the app:" -ForegroundColor White
Write-Host "  1. Go to Settings → LAN Settings" -ForegroundColor White
Write-Host "  2. Select 'LAN Client' mode" -ForegroundColor White
Write-Host "  3. Enter Server IP: $localIP" -ForegroundColor White
Write-Host "  4. Enter Server Port: 3333 (default)" -ForegroundColor White
Write-Host "  5. Click 'Connect'" -ForegroundColor White
Write-Host ""
Write-Host "Press any key to continue..." -ForegroundColor Yellow
$null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")
Write-Host ""

Write-Host "========================================" -ForegroundColor Yellow
Write-Host "  STEP 3: Test Functionality" -ForegroundColor Yellow
Write-Host "========================================" -ForegroundColor Yellow
Write-Host ""
Write-Host "Test the following on the LAN Client:" -ForegroundColor White
Write-Host ""
Write-Host "  ✓ 1. Can you see the dashboard?" -ForegroundColor Green
Write-Host "  ✓ 2. Can you view tables and floors?" -ForegroundColor Green
Write-Host "  ✓ 3. Can you create orders?" -ForegroundColor Green
Write-Host "  ✓ 4. Are orders syncing to server?" -ForegroundColor Green
Write-Host "  ✓ 5. Can you process payments?" -ForegroundColor Green
Write-Host "  ✓ 6. Can you view reports?" -ForegroundColor Green
Write-Host ""
Write-Host "Expected Behavior:" -ForegroundColor Cyan
Write-Host "  - Client has NO local database" -ForegroundColor White
Write-Host "  - All data reads from Server's SQLite" -ForegroundColor White
Write-Host "  - All writes go to Server's SQLite" -ForegroundColor White
Write-Host "  - Real-time sync between Server and Client" -ForegroundColor White
Write-Host ""

Write-Host "========================================" -ForegroundColor Yellow
Write-Host "  Quick Test Commands" -ForegroundColor Yellow
Write-Host "========================================" -ForegroundColor Yellow
Write-Host ""
Write-Host "Test Server API (run in browser on Client PC):" -ForegroundColor White
Write-Host "  http://$localIP`:3333/api/health" -ForegroundColor Green
Write-Host "  http://$localIP`:3333/api/tables" -ForegroundColor Green
Write-Host "  http://$localIP`:3333/api/menu-items" -ForegroundColor Green
Write-Host ""
Write-Host "Expected Response:" -ForegroundColor Cyan
Write-Host "  {\"status\":\"ok\",\"message\":\"LAN Server running\"}" -ForegroundColor White
Write-Host ""

Write-Host "========================================" -ForegroundColor Yellow
Write-Host "  Troubleshooting" -ForegroundColor Yellow
Write-Host "========================================" -ForegroundColor Yellow
Write-Host ""
Write-Host "If connection fails:" -ForegroundColor White
Write-Host "  1. Check Windows Firewall allows port 3001" -ForegroundColor Yellow
Write-Host "  2. Verify both PCs are on same network" -ForegroundColor Yellow
Write-Host "  3. Ping the server: ping $localIP" -ForegroundColor Yellow
Write-Host "  4. Check server console for errors" -ForegroundColor Yellow
Write-Host ""
Write-Host "Open firewall port (run as Administrator):" -ForegroundColor White
Write-Host "  netsh advfirewall firewall add rule name=`"TableFlow LAN`" dir=in action=allow protocol=TCP localport=3333" -ForegroundColor Green
Write-Host ""

Write-Host "Press any key to exit..." -ForegroundColor Yellow
$null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")
