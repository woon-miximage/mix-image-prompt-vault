$ErrorActionPreference = "Stop"

Write-Host "📦 [1/3] Building production bundle with Vite..." -ForegroundColor Cyan
npm run build

Write-Host "🗜️  [2/3] Packaging assets into zip..." -ForegroundColor Cyan
npm run package

Write-Host "🚀 [3/3] Uploading to Netlify (miximageprompt.netlify.app)..." -ForegroundColor Cyan
$token = "nfc_z7qJFxg2zSLNT6uQXXNsbRwPDPC3ST8S1cc6"
$siteId = "982df11f-4390-4986-89e6-04ed5805bb8a"
$zipPath = Join-Path $PSScriptRoot "..\dist-deploy.zip"

$headers = @{
    Authorization = "Bearer $token"
    "Content-Type" = "application/zip"
}

$response = Invoke-RestMethod -Uri "https://api.netlify.com/api/v1/sites/$siteId/deploys" -Method Post -Headers $headers -InFile $zipPath

Write-Host "✅ Deployed successfully!" -ForegroundColor Green
Write-Host "🌐 Live URL: https://miximageprompt.netlify.app" -ForegroundColor Yellow
Write-Host "🆔 Deploy ID: $($response.id) ($($response.state))" -ForegroundColor Gray
