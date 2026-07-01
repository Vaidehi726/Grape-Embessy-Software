# Automated LAN Server Test
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  LAN Server API Test" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# Get the local IP address
$localIP = (Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.InterfaceAlias -notlike "*Loopback*" -and $_.IPAddress -like "192.168.*" } | Select-Object -First 1).IPAddress

if (-not $localIP) {
    Write-Host "Error: Could not detect local IP address" -ForegroundColor Red
    exit 1
}

$serverUrl = "http://$localIP`:3333"
Write-Host "Server URL: $serverUrl" -ForegroundColor Green
Write-Host ""

# Check if server is running
Write-Host "Testing if LAN Server is running..." -ForegroundColor Yellow
Write-Host ""

try {
    $response = Invoke-WebRequest -Uri "$serverUrl/api/health" -Method GET -TimeoutSec 5 -UseBasicParsing
    
    if ($response.StatusCode -eq 200) {
        Write-Host "[SUCCESS] LAN Server is RUNNING" -ForegroundColor Green
        Write-Host ""
        Write-Host "Response:" -ForegroundColor Cyan
        Write-Host $response.Content -ForegroundColor White
        Write-Host ""
        
        # Test endpoints
        Write-Host "Testing data endpoints..." -ForegroundColor Yellow
        Write-Host ""
        
        $testEndpoints = @("/api/tables", "/api/menu-categories", "/api/menu-items", "/api/kitchens", "/api/floors")
        
        foreach ($endpoint in $testEndpoints) {
            $resp = Invoke-WebRequest -Uri "$serverUrl$endpoint" -Method GET -TimeoutSec 5 -UseBasicParsing
            $data = $resp.Content | ConvertFrom-Json
            $count = if ($data.data) { $data.data.Count } else { 0 }
            $name = $endpoint -replace "/api/",""
            Write-Host "  [OK] $name : $count records" -ForegroundColor Green
        }
        
        Write-Host ""
        Write-Host "========================================" -ForegroundColor Green
        Write-Host "  Server is working correctly!" -ForegroundColor Green
        Write-Host "========================================" -ForegroundColor Green
        Write-Host ""
        Write-Host "To test LAN Client:" -ForegroundColor Yellow
        Write-Host "  1. Start another instance: npm run dev:electron" -ForegroundColor White
        Write-Host "  2. Settings -> LAN Settings -> LAN Client" -ForegroundColor White
        Write-Host "  3. Server IP: $localIP" -ForegroundColor White
        Write-Host "  4. Port: 3333" -ForegroundColor White
        Write-Host "  5. Click Connect" -ForegroundColor White
        Write-Host ""
    }
} catch {
    Write-Host "[FAILED] LAN Server is NOT running" -ForegroundColor Red
    Write-Host ""
    Write-Host "Start the server:" -ForegroundColor Yellow
    Write-Host "  1. Run: npm run dev:electron" -ForegroundColor White
    Write-Host "  2. Settings -> LAN Settings -> LAN Server" -ForegroundColor White
    Write-Host ""
    Write-Host "Server will start at:" -ForegroundColor White
    Write-Host "  $serverUrl" -ForegroundColor Green
    Write-Host ""
}

Write-Host "Press any key to exit..."
$null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")
