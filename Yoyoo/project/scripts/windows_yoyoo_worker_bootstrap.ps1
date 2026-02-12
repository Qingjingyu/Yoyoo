param(
  [string]$Token = "",
  [int]$Port = 8088,
  [string]$TaskName = "YoyooWorker"
)

$ErrorActionPreference = "Stop"

function Assert-Admin {
  $current = [Security.Principal.WindowsIdentity]::GetCurrent()
  $principal = New-Object Security.Principal.WindowsPrincipal($current)
  if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw "Please run this script in an elevated (Administrator) PowerShell."
  }
}

function Ensure-Dir([string]$Path) {
  if (-not (Test-Path -LiteralPath $Path)) {
    New-Item -Path $Path -ItemType Directory -Force | Out-Null
  }
}

function Ensure-UrlAcl([int]$ListenPort) {
  $url = "http://+:$ListenPort/"
  $exists = netsh http show urlacl | Select-String -SimpleMatch $url -Quiet
  if (-not $exists) {
    & netsh http add urlacl url=$url user=Everyone | Out-Null
  }
}

function Ensure-Firewall([int]$ListenPort) {
  $ruleName = "YoyooWorker-$ListenPort"
  $exists = Get-NetFirewallRule -DisplayName $ruleName -ErrorAction SilentlyContinue
  if (-not $exists) {
    New-NetFirewallRule -DisplayName $ruleName -Direction Inbound -Action Allow -Protocol TCP -LocalPort $ListenPort | Out-Null
  }
}

Assert-Admin

$baseDir = "C:\ProgramData\YoyooWorker"
Ensure-Dir $baseDir

$tokenFile = Join-Path $baseDir "token.txt"
if ([string]::IsNullOrWhiteSpace($Token)) {
  if (-not (Test-Path $tokenFile)) {
    $Token = [Guid]::NewGuid().ToString("N")
    Set-Content -Path $tokenFile -Value $Token -Encoding UTF8
  } else {
    $Token = (Get-Content -Path $tokenFile -Raw).Trim()
  }
} else {
  Set-Content -Path $tokenFile -Value $Token -Encoding UTF8
}

$workerScript = @"
`$ErrorActionPreference = 'Continue'
`$port = $Port
`$base = 'C:\ProgramData\YoyooWorker'
`$tokenPath = Join-Path `$base 'token.txt'
`$logPath = Join-Path `$base 'worker.log'
`$token = ''
if (Test-Path `$tokenPath) { `$token = (Get-Content -Path `$tokenPath -Raw).Trim() }

if (`$token -eq '') {
  Add-Content -Path `$logPath -Value "[`$(Get-Date -Format o)] empty token, worker aborted"
  exit 1
}

`$listener = New-Object System.Net.HttpListener
`$listener.Prefixes.Add("http://+:`$port/")
`$listener.Start()
Add-Content -Path `$logPath -Value "[`$(Get-Date -Format o)] worker started on :`$port"

while (`$listener.IsListening) {
  try {
    `$ctx = `$listener.GetContext()
    `$req = `$ctx.Request
    `$res = `$ctx.Response
    `$path = `$req.Url.AbsolutePath.ToLowerInvariant()

    if (`$path -eq '/health') {
      `$payload = @{ ok = `$true; service = 'yoyoo-worker'; time = (Get-Date).ToString('o') } | ConvertTo-Json -Compress
      `$bytes = [Text.Encoding]::UTF8.GetBytes(`$payload)
      `$res.StatusCode = 200
      `$res.ContentType = 'application/json'
      `$res.OutputStream.Write(`$bytes, 0, `$bytes.Length)
      `$res.Close()
      continue
    }

    if (`$path -eq '/exec') {
      `$auth = `$req.Headers['Authorization']
      `$xToken = `$req.Headers['X-Yoyoo-Token']
      `$bearer = ''
      if (`$auth -and `$auth.StartsWith('Bearer ')) { `$bearer = `$auth.Substring(7) }

      if ((`$xToken -ne `$token) -and (`$bearer -ne `$token)) {
        `$payload = @{ ok = `$false; error = 'unauthorized' } | ConvertTo-Json -Compress
        `$bytes = [Text.Encoding]::UTF8.GetBytes(`$payload)
        `$res.StatusCode = 401
        `$res.ContentType = 'application/json'
        `$res.OutputStream.Write(`$bytes, 0, `$bytes.Length)
        `$res.Close()
        continue
      }

      `$reader = New-Object System.IO.StreamReader(`$req.InputStream, `$req.ContentEncoding)
      `$raw = `$reader.ReadToEnd()
      `$reader.Close()
      `$body = if (`$raw) { `$raw | ConvertFrom-Json } else { `$null }
      `$cmd = if (`$body -and `$body.command) { [string]`$body.command } else { '' }

      if (`$cmd -eq '') {
        `$payload = @{ ok = `$false; error = 'empty_command' } | ConvertTo-Json -Compress
        `$bytes = [Text.Encoding]::UTF8.GetBytes(`$payload)
        `$res.StatusCode = 400
        `$res.ContentType = 'application/json'
        `$res.OutputStream.Write(`$bytes, 0, `$bytes.Length)
        `$res.Close()
        continue
      }

      Add-Content -Path `$logPath -Value "[`$(Get-Date -Format o)] exec: `$cmd"
      `$output = cmd /c `$cmd 2>&1 | Out-String
      `$code = `$LASTEXITCODE
      `$payload = @{ ok = (`$code -eq 0); code = `$code; output = `$output.TrimEnd(); command = `$cmd } | ConvertTo-Json -Compress
      `$bytes = [Text.Encoding]::UTF8.GetBytes(`$payload)
      `$res.StatusCode = 200
      `$res.ContentType = 'application/json'
      `$res.OutputStream.Write(`$bytes, 0, `$bytes.Length)
      `$res.Close()
      continue
    }

    `$payload = @{ ok = `$false; error = 'not_found' } | ConvertTo-Json -Compress
    `$bytes = [Text.Encoding]::UTF8.GetBytes(`$payload)
    `$res.StatusCode = 404
    `$res.ContentType = 'application/json'
    `$res.OutputStream.Write(`$bytes, 0, `$bytes.Length)
    `$res.Close()
  } catch {
    Add-Content -Path `$logPath -Value "[`$(Get-Date -Format o)] error: `$($_.Exception.Message)"
    Start-Sleep -Milliseconds 500
  }
}
"@

$workerPath = Join-Path $baseDir "worker.ps1"
Set-Content -Path $workerPath -Value $workerScript -Encoding UTF8

Ensure-UrlAcl -ListenPort $Port
Ensure-Firewall -ListenPort $Port

$action = New-ScheduledTaskAction -Execute "powershell.exe" -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$workerPath`""
$trigger = New-ScheduledTaskTrigger -AtStartup
$settings = New-ScheduledTaskSettingsSet -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) -StartWhenAvailable

Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Settings $settings -User "SYSTEM" -RunLevel Highest -Force | Out-Null

# Start one local background worker immediately (for current session),
# while scheduled task guarantees auto-start on reboot.
$cmdLinePattern = "*$workerPath*"
$existingWorker = Get-CimInstance Win32_Process -ErrorAction SilentlyContinue `
  | Where-Object { $_.Name -match "^powershell(.exe)?$" -and $_.CommandLine -like $cmdLinePattern }
if (-not $existingWorker) {
  Start-Process -FilePath "powershell.exe" `
    -ArgumentList "-NoProfile -ExecutionPolicy Bypass -File `"$workerPath`"" `
    -WindowStyle Hidden | Out-Null
}

$healthUri = "http://127.0.0.1:$Port/health"
$health = $null
for ($i = 0; $i -lt 30; $i++) {
  try {
    $health = Invoke-RestMethod -Uri $healthUri -TimeoutSec 2
    if ($health) { break }
  } catch {
    Start-Sleep -Seconds 1
  }
}

if (-not $health) {
  $taskInfo = Get-ScheduledTaskInfo -TaskName $TaskName -ErrorAction SilentlyContinue
  $logTail = ""
  $logPath = Join-Path $baseDir "worker.log"
  if (Test-Path $logPath) {
    $logTail = (Get-Content -Path $logPath -Tail 40 -ErrorAction SilentlyContinue) -join "`n"
  }
  $portState = (netstat -ano | Select-String -Pattern (":$Port\\s")) -join "`n"
  throw ("worker health check failed after 30s.`nTaskInfo=" + ($taskInfo | ConvertTo-Json -Compress) + "`nPortState=`n" + $portState + "`nWorkerLogTail=`n" + $logTail)
}

Write-Host "OK: YoyooWorker started"
Write-Host "Port: $Port"
Write-Host "Task: $TaskName"
Write-Host "Token: $Token"
Write-Host "Health: $($health | ConvertTo-Json -Compress)"
