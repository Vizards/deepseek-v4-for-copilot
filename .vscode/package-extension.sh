#!/usr/bin/env bash
set -euo pipefail

quality="${1:?usage: package-extension.sh <stable|insiders> <workspace>}"
workspace="${2:?usage: package-extension.sh <stable|insiders> <workspace>}"

case "$quality" in
  stable) cli="code" ;;
  insiders) cli="code-insiders" ;;
  *)
    echo "Unknown quality: $quality" >&2
    exit 2
    ;;
esac

if ! command -v "$cli" >/dev/null 2>&1; then
  echo "Missing '$cli' in PATH." >&2
  echo "Install it from the target VS Code Command Palette: Shell Command: Install '$cli' command in PATH" >&2
  exit 127
fi

cd "$workspace"

npm run package

name=$(node -p "require('./package.json').name")
version=$(node -p "require('./package.json').version")
vsix="dist/${name}-${version}.vsix"

if [ ! -f "$vsix" ]; then
  echo "Expected package output was not produced: $vsix" >&2
  exit 1
fi

# --force replaces an already-installed copy of the same version with this build.
"$cli" --install-extension "$vsix" --force

echo
echo "Installed ${name} ${version} into $quality VS Code."
echo "Run 'Developer: Reload Window' in that window to activate the new build."
