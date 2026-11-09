$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $PSScriptRoot
Set-Location $projectRoot

Write-Host "📦 [1/3] Building production bundle with Vite..." -ForegroundColor Cyan
npm run build

# สร้าง .nojekyll และ 404.html สำหรับ GitHub Pages SPA
New-Item -Path (Join-Path $projectRoot "dist\.nojekyll") -ItemType File -Force | Out-Null
Copy-Item -Path (Join-Path $projectRoot "dist\index.html") -Destination (Join-Path $projectRoot "dist\404.html") -Force

Write-Host "🗜️  [2/3] Packaging assets into zip..." -ForegroundColor Cyan
npm run package

Write-Host "🚀 [3/3] Deploying to GitHub Pages (gh-pages branch)..." -ForegroundColor Cyan
$tempDeployDir = Join-Path $env:TEMP "mix-prompt-gh-pages-$(Get-Random)"
New-Item -Path $tempDeployDir -ItemType Directory -Force | Out-Null

try {
    Copy-Item -Path (Join-Path $projectRoot "dist\*") -Destination $tempDeployDir -Recurse -Force
    Copy-Item -Path (Join-Path $projectRoot "dist\.nojekyll") -Destination $tempDeployDir -Force

    Push-Location $tempDeployDir
    git init -b gh-pages | Out-Null
    git config user.name "MIX NATTANON"
    git config user.email "mixim@users.noreply.github.com"
    git add -A
    git commit -m "deploy: update GitHub Pages production build" | Out-Null
    git remote add origin "https://github.com/woon-miximage/mix-image-prompt-vault.git"
    git push -f origin gh-pages
    Pop-Location

    Write-Host "✅ Deployed to GitHub Pages successfully!" -ForegroundColor Green
    Write-Host "🌐 Live GitHub URL: https://woon-miximage.github.io/mix-image-prompt-vault/" -ForegroundColor Yellow
} finally {
    if (Test-Path $tempDeployDir) {
        Remove-Item -Path $tempDeployDir -Recurse -Force -ErrorAction SilentlyContinue
    }
}
