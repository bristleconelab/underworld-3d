#!/usr/bin/env bash
# Tell IndexNow search engines (Bing, Yandex, Seznam, Naver, Yep) that the sitemap URLs changed.
# Runs in CI after each deploy to main; HTTP 200/202 = accepted. The key file is public/125cd4f6bff036f744a493aace8c9aca.txt.
set -euo pipefail
SITE=https://underworld.bristleconelab.org
KEY=125cd4f6bff036f744a493aace8c9aca
URLS=$(curl -fsS "$SITE/sitemap.xml" | grep -o '<loc>[^<]*' | sed 's/<loc>//' | python3 -c 'import json,sys;print(json.dumps([l.strip() for l in sys.stdin if l.strip()]))')
curl -sS -o /dev/null -w "IndexNow HTTP %{http_code}\n" -H 'Content-Type: application/json; charset=utf-8' \
  -d "{\"host\":\"underworld.bristleconelab.org\",\"key\":\"$KEY\",\"keyLocation\":\"$SITE/$KEY.txt\",\"urlList\":$URLS}" \
  https://api.indexnow.org/indexnow
