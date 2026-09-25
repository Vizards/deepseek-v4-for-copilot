param(
  [Parameter(Mandatory = $true)]
  [ValidateSet("stable", "insiders")]
  [string] $Quality,

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

# `npm run package` runs the `vscode:prepublish` script, which shells out to bash
# (.github/scripts/prepare-marketplace-readme.sh). Windows does not ship bash, so
# fall back to the interpreter bundled with Git for Windows.
if (-not (Get-Command bash -ErrorAction SilentlyContinue)) {
  $candidates = @()

  if ($env:ProgramFiles) {
    $candidates += (Join-Path $env:ProgramFiles "Git\bin")
  }

  if (${env:ProgramFiles(x86)}) {
    $candidates += (Join-Path ${env:ProgramFiles(x86)} "Git\bin")
  }

  if ($env:LOCALAPPDATA) {
    $candidates += (Join-Path $env:LOCALAPPDATA "Programs\Git\bin")
  }

  $gitBash = $candidates | Where-Object { Test-Path (Join-Path $_ "bash.exe") } | Select-Object -First 1

  if (-not $gitBash) {
    [Console]::Error.WriteLine("Missing 'bash' in PATH and Git for Windows was not found.`nInstall Git for Windows, or run 'npm run package' from a shell that has bash.")
    exit 127
  }

  $env:PATH = "$env:PATH;$gitBash"
}

Push-Location $Workspace

try {
  # npm and the VS Code CLI write progress and warnings to stderr, and PowerShell 5.1
  # surfaces native stderr as errors while $ErrorActionPreference is 'Stop'. Relax it
  # for these two invocations and rely on their exit codes instead.
  $previousErrorAction = $ErrorActionPreference
  $ErrorActionPreference = "Continue"

  try {
    & npm run package

    if ($LASTEXITCODE) {
      exit $LASTEXITCODE
    }

    $manifest = Get-Content (Join-Path $Workspace "package.json") -Raw -Encoding utf8 | ConvertFrom-Json
    $vsix = Join-Path $Workspace ("dist\{0}-{1}.vsix" -f $manifest.name, $manifest.version)

    if (-not (Test-Path $vsix)) {
      [Console]::Error.WriteLine("Expected package output was not produced: $vsix")
      exit 1
    }

    # --force replaces an already-installed copy of the same version with this build.
    $installOutput = & $cli --install-extension $vsix --force 2>&1
    $installExitCode = $LASTEXITCODE

    if ($installExitCode) {
      $installOutput | Write-Host
      exit $installExitCode
    }
  } finally {
    $ErrorActionPreference = $previousErrorAction
  }

  Write-Host ""
  Write-Host "Installed $($manifest.publisher).$($manifest.name) $($manifest.version) into $Quality VS Code."
  Write-Host "Run 'Developer: Reload Window' in that window to activate the new build."
} finally {
  Pop-Location
}
