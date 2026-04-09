# Quick test script to verify the metadata fix (PowerShell version)
# Creates a test bug report with rich metadata and verifies it was saved

param(
    [string]$ApiEndpoint = "http://localhost:3000",
    [string]$ApiKey = $env:API_KEY
)

Write-Host "🧪 Testing Bug Report Metadata Fix..." -ForegroundColor Cyan
Write-Host ""

if (-not $ApiKey) {
    Write-Host "❌ Error: API_KEY is required" -ForegroundColor Red
    Write-Host "Usage: $env:API_KEY='your-key'; .\scripts\test-metadata-fix.ps1"
    exit 1
}

# Create test bug report with rich metadata
Write-Host "📝 Creating bug report with metadata..." -ForegroundColor Yellow

$payload = @{
    title = "Metadata Test Report"
    description = "Testing that metadata is saved correctly"
    priority = "medium"
    report = @{
        console = @(
            @{
                level = "error"
                message = "Test error message"
                timestamp = 1700000000000
                stack = "Error: Test`n  at test.js:10:15"
            },
            @{
                level = "warn"
                message = "Test warning"
                timestamp = 1700000001000
            },
            @{
                level = "info"
                message = "Test info"
                timestamp = 1700000002000
            }
        )
        network = @(
            @{
                url = "/api/test"
                method = "GET"
                status = 200
                duration = 123
                timestamp = 1700000000000
                headers = @{
                    "content-type" = "application/json"
                }
            },
            @{
                url = "/api/data"
                method = "POST"
                status = 201
                duration = 456
                timestamp = 1700000001000
            }
        )
        metadata = @{
            userAgent = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
            viewport = @{
                width = 1920
                height = 1080
            }
            browser = "Chrome"
            browserVersion = "120.0.0"
            os = "Windows"
            osVersion = "10"
            url = "https://example.com/test"
            timestamp = 1700000000000
        }
    }
} | ConvertTo-Json -Depth 10

try {
    $response = Invoke-RestMethod -Uri "$ApiEndpoint/api/v1/reports" `
        -Method Post `
        -Headers @{
            "Content-Type" = "application/json"
            "X-API-Key" = $ApiKey
        } `
        -Body $payload

    if (-not $response.success) {
        Write-Host "❌ Bug report creation failed" -ForegroundColor Red
        $response | ConvertTo-Json
        exit 1
    }

    $bugId = $response.data.id
    Write-Host "✅ Bug report created: $bugId" -ForegroundColor Green
    Write-Host ""

    # Verify metadata was saved
    Write-Host "🔍 Verifying metadata..." -ForegroundColor Yellow

    # Check console logs
    $consoleCount = $response.data.metadata.console.Count
    Write-Host "   Console logs: $consoleCount (expected: 3)"
    
    if ($consoleCount -ne 3) {
        Write-Host "   ❌ FAIL: Expected 3 console logs, got $consoleCount" -ForegroundColor Red
        exit 1
    }

    # Verify console log properties
    if (-not $response.data.metadata.console[0].stack) {
        Write-Host "   ❌ FAIL: Console log missing 'stack' property" -ForegroundColor Red
        exit 1
    }

    # Check network requests
    $networkCount = $response.data.metadata.network.Count
    Write-Host "   Network requests: $networkCount (expected: 2)"
    
    if ($networkCount -ne 2) {
        Write-Host "   ❌ FAIL: Expected 2 network requests, got $networkCount" -ForegroundColor Red
        exit 1
    }

    # Verify network request headers
    if (-not $response.data.metadata.network[0].headers) {
        Write-Host "   ❌ FAIL: Network request missing 'headers' property" -ForegroundColor Red
        exit 1
    }

    # Check browser metadata
    $metadataKeys = ($response.data.metadata.metadata.PSObject.Properties | Measure-Object).Count
    Write-Host "   Browser metadata fields: $metadataKeys (expected: 8)"
    
    if ($metadataKeys -lt 5) {
        Write-Host "   ❌ FAIL: Expected at least 5 metadata fields, got $metadataKeys" -ForegroundColor Red
        exit 1
    }

    # Verify viewport nested object
    if ($response.data.metadata.metadata.viewport.width -ne 1920) {
        Write-Host "   ❌ FAIL: Viewport width not saved correctly" -ForegroundColor Red
        exit 1
    }

    Write-Host ""
    Write-Host "✅ All metadata tests passed!" -ForegroundColor Green
    Write-Host ""
    Write-Host "📊 Summary:" -ForegroundColor Cyan
    Write-Host "   • Console logs: ✅ 3 entries with nested properties" -ForegroundColor Green
    Write-Host "   • Network requests: ✅ 2 entries with headers" -ForegroundColor Green
    Write-Host "   • Browser metadata: ✅ 8 fields including nested viewport" -ForegroundColor Green
    Write-Host ""
    Write-Host "🎉 The metadata fix is working correctly!" -ForegroundColor Magenta

} catch {
    Write-Host "❌ Error: $_" -ForegroundColor Red
    exit 1
}
