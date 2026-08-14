#!/usr/bin/env bash
set -euo pipefail
archive="${1:?zip archive required}"
target="${2:?target directory required}"
command -v zipinfo >/dev/null 2>&1 || { echo "zipinfo required" >&2; exit 1; }
while IFS= read -r entry; do
  case "$entry" in
    /*|[A-Za-z]:*|../*|*/../*|*/..|*\\*) echo "unsafe zip entry: $entry" >&2; exit 1 ;;
  esac
done < <(zipinfo -1 "$archive")
if zipinfo -l "$archive" | grep -Eq '^l'; then echo "symbolic links are not allowed in evidence archives" >&2; exit 1; fi
mkdir -p "$target"
unzip -q "$archive" -d "$target"
if find "$target" -type l -print -quit | grep -q .; then echo "symbolic links are not allowed in extracted evidence" >&2; exit 1; fi
