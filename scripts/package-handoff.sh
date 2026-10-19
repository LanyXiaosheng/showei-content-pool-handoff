#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

STAMP="$(date +%Y-%m-%d)"
NAME="shiwei-content-pool-handoff-${STAMP}"
STAGE="$(mktemp -d)"
TARGET="$(pwd)/${NAME}.zip"
trap 'rm -rf "$STAGE"' EXIT

mkdir -p "$STAGE/$NAME"
rsync -a \
  --exclude '.env' \
  --exclude '.env.docker' \
  --exclude '.local-credentials.txt' \
  --exclude '.git/' \
  --exclude '.pnpm-store/' \
  --exclude 'node_modules/' \
  --exclude 'dist/' \
  --exclude 'data/' \
  --exclude '/screenshots/' \
  --exclude '*.zip' \
  --exclude '.DS_Store' \
  ./ "$STAGE/$NAME/"

# Never let a secret accidentally slip into a handoff archive.
if find "$STAGE/$NAME" -type f \( -name '.env' -o -name '.env.docker' -o -name '.local-credentials.txt' \) | grep -q .; then
  echo 'Refusing to package: secret file detected.' >&2
  exit 1
fi
if grep -RqE 'sk-[A-Za-z0-9_-]{16,}|ENCRYPTION_KEY=[A-Za-z0-9+/=]{20,}' "$STAGE/$NAME" 2>/dev/null; then
  echo 'Refusing to package: possible live API key or encryption secret detected.' >&2
  exit 1
fi

mkdir -p "$STAGE/$NAME/docs"
(
  cd "$STAGE/$NAME"
  find . -type f ! -name SHA256SUMS -print0 \
    | sort -z \
    | xargs -0 shasum -a 256 > SHA256SUMS
)

rm -f "$TARGET"
(cd "$STAGE" && zip -q -r "$TARGET" "$NAME")

echo "Created: $TARGET"
shasum -a 256 "$TARGET"
