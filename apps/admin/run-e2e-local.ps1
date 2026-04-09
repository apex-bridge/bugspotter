# Local E2E Test Runner for Windows
# Workaround for Corepack issues by running migrations directly

Write-Host "Starting local E2E test environment..." -ForegroundColor Cyan

# Start PostgreSQL container
Write-Host "Starting PostgreSQL container..." -ForegroundColor Cyan
docker run -d `
  --name bugspotter-e2e-postgres `
  -e POSTGRES_DB=bugspotter_e2e_test `
  -e POSTGRES_USER=postgres `
  -e POSTGRES_PASSWORD=testpass `
  -p 5433:5432 `
  postgres:16 | Out-Null

# Start Redis container
Write-Host "Starting Redis container..." -ForegroundColor Cyan
docker run -d `
  --name bugspotter-e2e-redis `
  -p 6380:6379 `
  redis:7-alpine | Out-Null

# Wait for PostgreSQL to be ready
Write-Host "Waiting for PostgreSQL..." -ForegroundColor Yellow
Start-Sleep -Seconds 5

# Set environment variables
$env:DATABASE_URL = "postgresql://postgres:testpass@localhost:5433/bugspotter_e2e_test"
$env:REDIS_URL = "redis://localhost:6380"
$env:JWT_SECRET = "test-jwt-secret-for-e2e-tests-min-32-chars-required-here-now"
$env:ENCRYPTION_KEY = "test-encryption-key-for-e2e-tests-32chars+"
$env:JWT_EXPIRES_IN = "1h"
$env:JWT_REFRESH_EXPIRES_IN = "7d"
$env:NODE_ENV = "test"
$env:LOG_LEVEL = "error"
$env:API_URL = "http://localhost:4000"
$env:BASE_URL = "http://localhost:4001"
$env:VITE_API_URL = "http://localhost:4000"
$env:DB_POOL_MIN = "5"
$env:DB_POOL_MAX = "20"
$env:SETUP_MODE = "full"
$env:STORAGE_BACKEND = "local"
$env:STORAGE_BASE_DIR = "..\..\packages\backend\data\e2e-uploads"
$env:STORAGE_BASE_URL = "http://localhost:4000/uploads"

# Run migrations
Write-Host "Running database migrations..." -ForegroundColor Cyan
Push-Location ..\..\packages\backend
try {
    npx tsx src/db/migrations/migrate.ts
    if ($LASTEXITCODE -ne 0) {
        throw "Migration failed with exit code $LASTEXITCODE"
    }
} catch {
    Write-Host "Migration failed" -ForegroundColor Red
    Pop-Location
    docker stop bugspotter-e2e-postgres bugspotter-e2e-redis | Out-Null
    docker rm bugspotter-e2e-postgres bugspotter-e2e-redis | Out-Null
    exit 1
}
Pop-Location

# Start backend server in background
Write-Host "Starting backend server..." -ForegroundColor Cyan
$env:PORT = "4000"
$env:CORS_ORIGINS = "http://localhost:4001,http://localhost:4000"
Push-Location ..\..\packages\backend
$backendJob = Start-Job -ScriptBlock {
    param($envVars)
    foreach ($key in $envVars.Keys) {
        Set-Item "env:$key" -Value $envVars[$key]
    }
    npx tsx src/api/index.ts
} -ArgumentList @{
    DATABASE_URL = $env:DATABASE_URL
    REDIS_URL = $env:REDIS_URL
    JWT_SECRET = $env:JWT_SECRET
    ENCRYPTION_KEY = $env:ENCRYPTION_KEY
    PORT = "4000"
    CORS_ORIGINS = "http://localhost:4001,http://localhost:4000"
    NODE_ENV = "test"
    LOG_LEVEL = "error"
    DB_POOL_MIN = "5"
    DB_POOL_MAX = "20"
    SETUP_MODE = "full"
    STORAGE_BACKEND = "local"
    STORAGE_BASE_DIR = $env:STORAGE_BASE_DIR
    STORAGE_BASE_URL = $env:STORAGE_BASE_URL
}
Pop-Location

# Wait for backend to be ready
Write-Host "Waiting for backend to be ready..." -ForegroundColor Yellow
$retries = 0
$maxRetries = 30
$ready = $false

while ($retries -lt $maxRetries) {
    try {
        $response = Invoke-WebRequest -Uri "http://localhost:4000/health" -Method Get -TimeoutSec 2 -ErrorAction SilentlyContinue
        if ($response.StatusCode -eq 200) {
            Write-Host "Backend server is ready" -ForegroundColor Green
            $ready = $true
            break
        }
    } catch {
        # Server not ready yet
    }
    Start-Sleep -Seconds 1
    $retries++
}

if (-not $ready) {
    Write-Host "Backend failed to start" -ForegroundColor Red
    if ($backendJob) { Stop-Job -Job $backendJob -ErrorAction SilentlyContinue; Remove-Job -Job $backendJob -ErrorAction SilentlyContinue }
    docker stop bugspotter-e2e-postgres bugspotter-e2e-redis 2>$null | Out-Null
    docker rm bugspotter-e2e-postgres bugspotter-e2e-redis 2>$null | Out-Null
    exit 1
}

# Start worker in background
Write-Host "Starting worker..." -ForegroundColor Cyan
Push-Location ..\..\packages\backend
$workerJob = Start-Job -ScriptBlock {
    param($envVars, $workDir)
    foreach ($key in $envVars.Keys) {
        Set-Item "env:$key" -Value $envVars[$key]
    }
    Set-Location $workDir
    npx tsx src/worker.ts
} -ArgumentList @{
    DATABASE_URL = $env:DATABASE_URL
    REDIS_URL = $env:REDIS_URL
    JWT_SECRET = $env:JWT_SECRET
    ENCRYPTION_KEY = $env:ENCRYPTION_KEY
    NODE_ENV = "test"
    LOG_LEVEL = "error"
    STORAGE_BACKEND = "local"
    STORAGE_BASE_DIR = $env:STORAGE_BASE_DIR
    STORAGE_BASE_URL = $env:STORAGE_BASE_URL
}, (Get-Location).Path
Pop-Location

Start-Sleep -Seconds 2

# Run E2E tests
Write-Host "Running E2E tests..." -ForegroundColor Cyan
$testArgs = $args -join " "
$testCommand = if ($testArgs) { "npx playwright test $testArgs" } else { "npx playwright test" }

try {
    Invoke-Expression $testCommand
    $testExitCode = $LASTEXITCODE
} catch {
    $testExitCode = 1
}

# Cleanup
Write-Host "Cleaning up..." -ForegroundColor Cyan
if ($backendJob) { Stop-Job -Job $backendJob -ErrorAction SilentlyContinue; Remove-Job -Job $backendJob -ErrorAction SilentlyContinue }
if ($workerJob) { Stop-Job -Job $workerJob -ErrorAction SilentlyContinue; Remove-Job -Job $workerJob -ErrorAction SilentlyContinue }
docker stop bugspotter-e2e-postgres bugspotter-e2e-redis 2>$null | Out-Null
docker rm bugspotter-e2e-postgres bugspotter-e2e-redis 2>$null | Out-Null

if ($testExitCode -eq 0) {
    Write-Host "E2E tests passed!" -ForegroundColor Green
} else {
    Write-Host "E2E tests failed" -ForegroundColor Red
}

exit $testExitCode
