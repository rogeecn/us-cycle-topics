#!/usr/bin/env bash
set -euo pipefail

if [[ ! -f "scripts/eval-dataset.json" ]]; then
  echo "[eval] missing scripts/eval-dataset.json" >&2
  exit 1
fi

echo "[eval] running producer smoke-style checks"

jq -c '.[]' scripts/eval-dataset.json | while read -r row; do
  topic=$(echo "$row" | jq -r '.input.topic')
  city=$(echo "$row" | jq -r '.input.city')
  keyword=$(echo "$row" | jq -r '.input.keyword')
  language=$(echo "$row" | jq -r '.input.language // "en"')

  echo "[eval] topic=$topic city=$city"
  npm run producer -- --topic "$topic" --city "$city" --keyword "$keyword" --language "$language"
done

echo "[eval] completed"
