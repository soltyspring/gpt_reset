#!/bin/bash
# 등록된 첫 구독자에게 캠페인 테스트 메시지를 보내고, 채널별 결과만 출력해요(식별키는 출력하지 않아요).
# 사용: bash send-test.sh <deploymentId> [templateSetCode...]
set -euo pipefail
dep="$1"; shift
codes=("${@:-tibo-reset tibo-plan}")
base=/home/solty/dev/tibo
set -a; . "$base/.env"; set +a
anon=$("$base/node/bin/node" -e "
const {DatabaseSync}=require('node:sqlite');const d=new DatabaseSync(process.env.TIBO_DB_PATH);
const r=d.prepare('select anon_key from subscribers where active=1 order by created_at desc limit 1').get();
process.stdout.write(r?r.anon_key:'');" 2>/dev/null)
[ -n "$anon" ] || { echo 'NO_SUBSCRIBER'; exit 1; }
for code in ${codes[@]}; do
  body=$(printf '{"templateSetCode":"%s","deploymentId":"%s","context":{"title":"GPT 사용량이 리셋됐어요","summary":"테스트","scope":"모든 사용자","postedAt":"지금"}}' "$code" "$dep")
  res=$(curl -s --max-time 20 --cert "$TOSS_MTLS_CERT" --key "$TOSS_MTLS_KEY" -H 'content-type: application/json' -H "x-anon-key: $anon" \
    -d "$body" https://apps-in-toss-api.toss.im/api-partner/v1/apps-in-toss/messenger/send-test-message -w '\nHTTP %{http_code}')
  echo "== $code"
  echo "$res" | "$base/node/bin/node" -e '
let s="";process.stdin.on("data",c=>s+=c).on("end",()=>{const [j,h]=s.split("\nHTTP ");let o;try{o=JSON.parse(j)}catch{console.log("HTTP",h,j.slice(0,300));return}
const r=o.success??o;const pick=x=>x&&Object.fromEntries(Object.entries(x).map(([k,v])=>[k,Array.isArray(v)?v.map(e=>e.reachedFailReason||"ok"):v]));
console.log("HTTP",h,"resultType",o.resultType??"-");
if(o.error)console.log("error",JSON.stringify(o.error));
console.log("counts",JSON.stringify({msg:r.msgCount,push:r.sentPushCount,inbox:r.sentInboxCount,sms:r.sentSmsCount}));
if(r.detail)console.log("detail",JSON.stringify(pick(r.detail)));
if(r.fail)console.log("fail",JSON.stringify(pick(r.fail)));});'
done
