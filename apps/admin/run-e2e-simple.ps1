# Simple E2E Test Runner for Windows
# Uses Playwright's global setup (which handles containers, migrations, backend)
# but starts Vite manually to avoid Corepack issues

# Determine script directory and navigate to admin folder
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $scriptDir

Write-Host "Starting Vite dev server for E2E tests..." -ForegroundColor Cyan

# Set environment variables
$env:BASE_URL = "http://localhost:4001"
$env:API_URL = "http://localhost:4000"
$env:VITE_API_URL = "http://localhost:4000"
$env:PORT = "4001"

# Start Vite in background
$viteJob = Start-Job -ScriptBlock {
    param($workDir)
    Set-Location $workDir
    $env:PORT = "4001"
    $env:VITE_API_URL = "http://localhost:4000"
    pnpm dev
} -ArgumentList $scriptDir

# Wait for Vite to be ready with health check
Write-Host "Waiting for Vite to be ready..." -ForegroundColor Yellow
$maxAttempts = 60
$attempt = 0
$viteReady = $false

while ($attempt -lt $maxAttempts -and -not $viteReady) {
    try {
        $response = Invoke-WebRequest -Uri "http://localhost:4001" -Method Get -TimeoutSec 1 -ErrorAction Stop
        if ($response.StatusCode -eq 200) {
            $viteReady = $true
            Write-Host "Vite is ready!" -ForegroundColor Green
        }
    } catch {
        $attempt++
        if ($attempt -lt $maxAttempts) {
            Start-Sleep -Milliseconds 500
        }
    }
}

if (-not $viteReady) {
    Write-Host "Vite failed to start after 30 seconds" -ForegroundColor Red
    Stop-Job -Job $viteJob -ErrorAction SilentlyContinue
    Remove-Job -Job $viteJob -ErrorAction SilentlyContinue
    exit 1
}

# Run Playwright tests (global setup handles PostgreSQL, Redis, backend, worker)
Write-Host "Running E2E tests (global setup handles backend and database)..." -ForegroundColor Cyan
$testArgs = if ($args) { $args -join " " } else { "" }

try {
    if ($testArgs) {
        pnpm exec playwright test $testArgs
    } else {
        pnpm exec playwright test
    }
    $testExitCode = $LASTEXITCODE
} catch {
    $testExitCode = 1
}

# Cleanup
Write-Host "Stopping Vite..." -ForegroundColor Cyan
if ($viteJob) {
    Stop-Job -Job $viteJob -ErrorAction SilentlyContinue
    Remove-Job -Job $viteJob -ErrorAction SilentlyContinue
}

if ($testExitCode -eq 0) {
    Write-Host "E2E tests passed!" -ForegroundColor Green
} else {
    Write-Host "E2E tests failed" -ForegroundColor Red
}

exit $testExitCode
