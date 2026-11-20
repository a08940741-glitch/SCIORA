#!/usr/bin/env bash
# SCIORA secret scan. Fails (exit 1) if anything that looks like a secret is
# staged or tracked. Run before every commit: npm run secret-scan
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

fail=0
# Files that git would include: tracked + staged + untracked-but-not-ignored.
mapfile -t files < <(git ls-files --cached --others --exclude-standard | grep -v '^node_modules/' || true)

for f in "${files[@]}"; do
  base="$(basename "$f")"
  if [[ "$base" == .env* && "$base" != ".env.example" ]]; then
    echo "SECRET-SCAN: environment file would be committed: $f"; fail=1
  fi
done

# Patterns: Anthropic keys, Google OAuth client secrets, private keys, generic assignments with long values.
patterns=(
  'sk-ant-[A-Za-z0-9_-]{10,}'
  'GOCSPX-[A-Za-z0-9_-]{10,}'
  '-----BEGIN [A-Z ]*PRIVATE KEY-----'
  '(ANTHROPIC_API_KEY|SCIORA_TOKEN_SECRET)=[^[:space:]#]{8,}'
)
for p in "${patterns[@]}"; do
  if ((${#files[@]})); then
    if hits=$(grep -EnI -- "$p" "${files[@]}" 2>/dev/null | grep -v '^scripts/secret-scan.sh:'); then
      echo "SECRET-SCAN: possible secret matching /$p/:"; echo "$hits" | sed -E 's/(sk-ant-|GOCSPX-)[A-Za-z0-9_-]+/\1****/g'; fail=1
    fi
  fi
done

if ((fail)); then echo "SECRET-SCAN: FAILED"; exit 1; fi
echo "SECRET-SCAN: OK (${#files[@]} files checked)"
