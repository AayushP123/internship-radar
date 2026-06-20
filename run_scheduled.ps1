$ErrorActionPreference = "Continue"
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$python = "C:\Users\Aayush.Pandey\AppData\Local\Programs\Python\Python313\python.exe"
$log = Join-Path $root "monitor.log"
$secrets = Join-Path $root "local-secrets.ps1"

if (Test-Path $secrets) {
    . $secrets
}

if ((Test-Path $log) -and (Get-Item $log).Length -gt 2MB) {
    Move-Item -Force $log "$log.old"
}

$timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
& $python (Join-Path $root "monitor.py") 2>&1 |
    ForEach-Object { "[$timestamp] $_" } |
    Add-Content -Path $log
