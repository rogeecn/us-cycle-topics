#!/usr/bin/env bash
set -euo pipefail

if [[ ! -f ".env" ]]; then
  echo "[smoke] missing .env file (copy from .env.example first)" >&2
  exit 1
fi

echo "[smoke] running preflight"
npm run preflight

echo "[smoke] applying migrations"
npm run migrate

echo "[smoke] seeding deterministic sample content"
npm run seed:sample -- --count=3

echo "[smoke] starting scheduler for one run"
timeout 30s npm run scheduler || true

echo "[smoke] completed"
