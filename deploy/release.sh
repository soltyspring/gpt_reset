#!/bin/bash
# 새 릴리스 설치: 의존성 설치 → current 교체 → API 재시작 → 상태 확인(실패 시 이전 릴리스로 복구)
set -euo pipefail
rel="$1"
base=/home/solty/dev/tibo
cd "$base/releases"
mkdir -p "$rel"
tar -xzf "$rel.tar.gz" -C "$rel"
prev_link=$(readlink "$base/current")
cp -a "$prev_link/node_modules" "$rel/" 2>/dev/null || true
cd "$rel"
PATH="$base/node/bin:$PATH" npm ci --omit=dev --ignore-scripts --no-audit --no-fund 2>&1 | tail -1
cd "$base"
# 발송 코드(콘솔 캠페인)
sed -i 's#^TOSS_RESET_TEMPLATE=.*#TOSS_RESET_TEMPLATE=tibo-reset#; s#^TOSS_PLAN_TEMPLATE=.*#TOSS_PLAN_TEMPLATE=tibo-plan#' .env
grep -E '^TOSS_(RESET|PLAN)_TEMPLATE=' .env
ln -sfn "$base/releases/$rel" current
systemctl --user restart tibo.service
ok=0
for i in $(seq 1 30); do sleep 1; if curl -sf http://127.0.0.1:18825/api/health >/dev/null; then ok=1; break; fi; done
if [ "$ok" != 1 ]; then
  ln -sfn "$prev_link" current
  systemctl --user restart tibo.service
  echo "ROLLED_BACK to $prev_link"
  exit 1
fi
echo "UP on $(readlink current) after ${i}s (previous: $prev_link)"
systemctl --user start tibo-poll.service
journalctl --user -u tibo-poll.service -n 3 --no-pager --output=cat
