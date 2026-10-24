$appName = "MIX Image Prompt Archive"
$installDir = Join-Path $env:LOCALAPPDATA "Programs\MIXPromptVault"
$desktopPath = [Environment]::GetFolderPath("Desktop")
$startMenuPath = [Environment]::GetFolderPath("Programs")

$shortcutDesktop = Join-Path $desktopPath "$appName.lnk"
$shortcutStart = Join-Path $startMenuPath "$appName.lnk"

if (Test-Path $shortcutDesktop) { Remove-Item $shortcutDesktop -Force }
if (Test-Path $shortcutStart) { Remove-Item $shortcutStart -Force }
if (Test-Path $installDir) { Remove-Item $installDir -Recurse -Force }

Write-Host "✅ ถอนการติดตั้ง $appName ออกจากเครื่องเรียบร้อยแล้ว" -ForegroundColor Green
