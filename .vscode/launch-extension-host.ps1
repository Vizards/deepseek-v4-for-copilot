param(
  [Parameter(Mandatory = $true)]
  [ValidateSet("stable", "insiders")]
  [string] $Quality,

  [Parameter(Mandatory = $true)]
  [int] $Port,

  [Parameter(Mandatory = $true)]
  [string] $Workspace
)

$ErrorActionPreference = "Stop"

switch ($Quality) {
  "stable" {
    $cli = "code"
    $installHint = "Shell Command: Install 'code' command in PATH"
  }
  "insiders" {
    $cli = "code-insiders"
    $installHint = "Shell Command: Install 'code-insiders' command in PATH"
  }
}

if (-not (Get-Command $cli -ErrorAction SilentlyContinue)) {
  [Console]::Error.WriteLine("Missing '$cli' in PATH.`nInstall it from the target VS Code Command Palette:`n  $installHint`nThen restart the terminal and try again.")
  exit 127
}

function Get-ProcessCommandLine {
  param([int] $ProcessId)

  try {
    $processInfo = Get-CimInstance Win32_Process -Filter "ProcessId = $ProcessId"
    return $processInfo.CommandLine
  } catch {
    return ""
  }
}

try {
  $connections = @(Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue)
} catch {
  Write-Warning "Get-NetTCPConnection is unavailable; skipping stale inspector cleanup for port $Port."
  $connections = @()
}

$processIds = @($connections | ForEach-Object { $_.OwningProcess } | Where-Object { $_ } | Sort-Object -Unique)

foreach ($processId in $processIds) {
  $commandLine = Get-ProcessCommandLine -ProcessId $processId

  if ([string]::IsNullOrWhiteSpace($commandLine)) {
    continue
  }

  $isExtensionHost = $commandLine -like "*--inspect=127.0.0.1:$Port*" `
    -or $commandLine -like "*--inspect-brk=127.0.0.1:$Port*" `
    -or $commandLine -like "*--inspect=localhost:$Port*" `
    -or $commandLine -like "*--inspect-brk=localhost:$Port*"

  if ($isExtensionHost) {
    Stop-Process -Id $processId -Force -ErrorAction SilentlyContinue
    continue
  }

  [Console]::Error.WriteLine("Port $Port is already used by PID $processId, but it does not look like a VS Code extension host:`n$commandLine`nRefusing to stop it automatically.")
  exit 1
}

& $cli `
  --new-window `
  "--inspect-extensions=$Port" `
  "--extensionDevelopmentPath=$Workspace" `
  $Workspace

if ($LASTEXITCODE) {
  exit $LASTEXITCODE
}
