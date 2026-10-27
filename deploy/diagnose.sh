#!/bin/bash
# 알림 등록 진단: 구독자 수, 최근 /tibo/api 요청(메서드·경로·상태), API 오류 로그
cd /home/solty/dev/tibo/current
set -a; . /home/solty/dev/tibo/.env; set +a
echo "== stats"
/home/solty/dev/tibo/node/bin/node node_modules/tsx/dist/cli.mjs scripts/admin.ts stats 2>&1 | grep -v -e ExperimentalWarning -e trace-warnings
echo "== sessions/subscribers"
/home/solty/dev/tibo/node/bin/node -e "
const {DatabaseSync}=require('node:sqlite');const d=new DatabaseSync(process.env.TIBO_DB_PATH);
console.log('sessions', d.prepare('select count(*) n from sessions').get().n);
console.log('subscribers', JSON.stringify(d.prepare('select substr(anon_key,1,6) k, reset, planned, active, created_at from subscribers').all()));
" 2>&1 | grep -v -e ExperimentalWarning -e trace-warnings
echo "== api log (last 20)"
journalctl --user -u tibo.service --since '-2h' --no-pager --output=cat | tail -n 20
echo "== nginx /tibo/api non-GET (last 30)"
sudo -n grep -h '/tibo/api/' /var/log/nginx/access.log 2>/dev/null | grep -v '"GET ' | tail -n 30 | awk '{print $4, $6, $7, $9, $12, $13}' || echo '(no sudo -n)'
