$ErrorActionPreference = "Stop"

$appName = "MIX Image Prompt Archive"
$installDir = Join-Path $env:LOCALAPPDATA "Programs\MIXPromptVault"
$sourceExe = Join-Path $PSScriptRoot "..\dist-desktop\MIX-Prompt-Vault.exe"

# If standalone isn't built yet, try lite or prompt build
if (!(Test-Path $sourceExe)) {
    $sourceExe = Join-Path $PSScriptRoot "..\dist-desktop-lite\MIX-Prompt-Vault.exe"
}

if (!(Test-Path $sourceExe)) {
    Write-Host "⚠️ ไม่พบไฟล์ MIX-Prompt-Vault.exe กำลังคอมไพล์..." -ForegroundColor Yellow
    Push-Location (Join-Path $PSScriptRoot "..\desktop-app")
    dotnet publish -c Release -r win-x64 --self-contained true -p:PublishSingleFile=true -p:EnableCompressionInSingleFile=true -o (Join-Path $PSScriptRoot "..\dist-desktop")
    Pop-Location
}

# Create destination folder
if (!(Test-Path $installDir)) {
    New-Item -ItemType Directory -Path $installDir -Force | Out-Null
}

Write-Host "📦 กำลังติดตั้ง $appName ไปที่ $installDir..." -ForegroundColor Cyan
Copy-Item (Join-Path (Split-Path $sourceExe) "*") -Destination $installDir -Recurse -Force

$targetExe = Join-Path $installDir "MIX-Prompt-Vault.exe"
$iconPath = Join-Path $installDir "app.ico"

# Create Desktop Shortcut
$desktopPath = [Environment]::GetFolderPath("Desktop")
$shortcutDesktop = Join-Path $desktopPath "$appName.lnk"
$wsh = New-Object -ComObject WScript.Shell
$sc1 = $wsh.CreateShortcut($shortcutDesktop)
$sc1.TargetPath = $targetExe
$sc1.WorkingDirectory = $installDir
$sc1.IconLocation = "$targetExe,0"
$sc1.Description = "MIX Image Prompt Archive — คลังรวมพรอมต์ AI ส่วนตัว"
$sc1.Save()

# Create Start Menu Shortcut
$startMenuPath = [Environment]::GetFolderPath("Programs")
$shortcutStart = Join-Path $startMenuPath "$appName.lnk"
$sc2 = $wsh.CreateShortcut($shortcutStart)
$sc2.TargetPath = $targetExe
$sc2.WorkingDirectory = $installDir
$sc2.IconLocation = "$targetExe,0"
$sc2.Description = "MIX Image Prompt Archive — คลังรวมพรอมต์ AI ส่วนตัว"
$sc2.Save()

Write-Host "✅ ติดตั้งเรียบร้อยแล้ว!" -ForegroundColor Green
Write-Host "🖥️  สร้าง Shortcut บนหน้าจอ Desktop แล้ว: $shortcutDesktop" -ForegroundColor Yellow
Write-Host "📌 สร้าง Shortcut บน Start Menu แล้ว: $shortcutStart" -ForegroundColor Yellow
Write-Host "🚀 สามารถเปิดใช้งานได้จากหน้าจอ Desktop หรือค้นหาใน Start Menu ได้ทันทีครับ" -ForegroundColor Cyan
