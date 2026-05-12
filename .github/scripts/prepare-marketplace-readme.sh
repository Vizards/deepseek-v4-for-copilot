#!/usr/bin/env bash
set -euo pipefail

source_path="${1:-README.md}"
output_path="${2:-dist/README.marketplace.md}"

mkdir -p "$(dirname "$output_path")"

awk '
  /<!-- marketplace-readme:remove-start -->/ {
    if (removing) {
      print "Nested marketplace-readme remove block." > "/dev/stderr"
      exit 1
    }
    removing = 1
    removed += 1
    next
  }

  /<!-- marketplace-readme:remove-end -->/ {
    if (!removing) {
      print "Unexpected marketplace-readme remove end marker." > "/dev/stderr"
      exit 1
    }
    removing = 0
    next
  }

  !removing {
    print
  }

  END {
    if (removing) {
      print "Unclosed marketplace-readme remove block." > "/dev/stderr"
      exit 1
    }
    if (removed != 1) {
      printf "Expected 1 marketplace-readme remove block, found %d.\n", removed > "/dev/stderr"
      exit 1
    }
  }
' "$source_path" > "$output_path"
