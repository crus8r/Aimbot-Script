#!/usr/bin/env bash
# Runs the headless simulation tests. Needs the `luau` CLI on PATH, or set
# LUAU=/path/to/luau. Grab one from https://github.com/luau-lang/luau/releases
set -euo pipefail

cd "$(dirname "$0")/.."

LUAU="${LUAU:-luau}"
if ! command -v "$LUAU" >/dev/null 2>&1 && [ ! -x "$LUAU" ]; then
	echo "luau not found; set LUAU=/path/to/luau" >&2
	exit 1
fi

BUNDLE="$(mktemp -t tentacle-wars-XXXXXX.luau)"
trap 'rm -f "$BUNDLE"' EXIT

python3 tests/bundle.py "$BUNDLE" >/dev/null

# Parse-check everything, including the Roblox-only files the bundle skips.
FAILED=0
while IFS= read -r file; do
	if ! "$LUAU-ast" "$file" >/dev/null 2>/tmp/tw-parse-err; then
		echo "parse error in $file"
		cat /tmp/tw-parse-err
		FAILED=1
	fi
done < <(find src -name '*.luau')
[ "$FAILED" -eq 0 ] || exit 1

"$LUAU" "$BUNDLE"
