#!/usr/bin/env bash
# verify-menu-deploy.sh — proves what code is actually serving on the VPS.
#
# Use when the responsive menu fix keeps "not working" on phone — it
# answers whether the running build has Phase 16 (commit 6d81193) or
# something older.
#
# Run on the VPS as the deploy user:
#   ssh deploy@148.230.66.124
#   cd /opt/restaurant-manager
#   bash scripts/verify-menu-deploy.sh

set -u

cd "$(dirname "$0")/.."

GREEN='\033[0;32m'; RED='\033[0;31m'; YELLOW='\033[1;33m'; NC='\033[0m'

echo "════════════════════════════════════════════════════════"
echo "Flavrly menu responsive fix — deployment verification"
echo "════════════════════════════════════════════════════════"

# 1. What commit is in the local clone right now?
echo
echo "── 1. Current commit on disk:"
COMMIT=$(git log -1 --format='%h %s')
echo "    $COMMIT"
LATEST=$(git log -1 --format='%h')

# 2. Does the menu-item-card source contain the Phase 16 grid template?
echo
echo "── 2. Phase 16 grid template in source?"
if grep -q "grid-cols-\[minmax(0,1fr)_80px\]" apps/web/src/app/\(customer\)/menu/menu-item-card.tsx 2>/dev/null; then
  echo -e "    ${GREEN}YES${NC} — source has the Phase 16 grid-cols class."
  SOURCE_OK=1
else
  echo -e "    ${RED}NO${NC} — source missing the grid-cols class. git pull then bash scripts/fix-prod.sh."
  SOURCE_OK=0
fi

# 3. Does the BUILT Next.js output contain the compiled grid class?
#    Tailwind compiles arbitrary values into CSS class names that include
#    the value, e.g. `grid-cols-\[minmax\(0\\,1fr\)_80px\]`. We grep the
#    built CSS files in .next/static/css.
echo
echo "── 3. Phase 16 grid class in BUILT CSS?"
if [ -d apps/web/.next/static/css ]; then
  if grep -ql "minmax(0,1fr)" apps/web/.next/static/css/*.css 2>/dev/null; then
    echo -e "    ${GREEN}YES${NC} — compiled CSS includes the grid template."
    BUILD_OK=1
  else
    echo -e "    ${RED}NO${NC} — build did NOT compile the new grid class."
    echo "    Run: cd apps/web && npm run build && pm2 restart rm-web"
    BUILD_OK=0
  fi
else
  echo -e "    ${YELLOW}WARN${NC} — apps/web/.next/static/css/ doesn't exist yet."
  echo "    Run: cd apps/web && npm run build"
  BUILD_OK=0
fi

# 4. What is pm2 actually serving?
echo
echo "── 4. pm2 process status:"
pm2 list 2>/dev/null | grep -E "rm-web|name|status" || echo "    pm2 not running or not installed."

# 5. What does the public site return for the layout's overflow class?
echo
echo "── 5. Public site test — fetching / for the html overflow clamp:"
HTML=$(curl -sS --max-time 10 https://flavrly.in/ | head -c 4000 || true)
if echo "$HTML" | grep -q 'overflow-x-hidden'; then
  echo -e "    ${GREEN}YES${NC} — production HTML has overflow-x-hidden."
else
  echo -e "    ${RED}NO${NC} — production HTML missing overflow-x-hidden."
  echo "    The browser is fetching a stale build. pm2 restart may not be enough;"
  echo "    try: cd apps/web && rm -rf .next && npm run build && pm2 restart rm-web"
fi

# 6. Summary.
echo
echo "════════════════════════════════════════════════════════"
if [ "${SOURCE_OK:-0}" = "1" ] && [ "${BUILD_OK:-0}" = "1" ]; then
  echo -e "${GREEN}Source + build look good.${NC} If your phone still shows the old"
  echo "layout, the browser is caching. On the phone:"
  echo "  • Safari: Settings → Safari → Clear History & Website Data"
  echo "  • Or: open https://flavrly.in/ in Private Browsing"
  echo "  • If you installed the PWA, uninstall it and re-add to home screen"
else
  echo -e "${RED}One of: source / build is out of date.${NC} Run:"
  echo "  cd /opt/restaurant-manager"
  echo "  git pull"
  echo "  cd apps/web"
  echo "  rm -rf .next"
  echo "  npm run build"
  echo "  pm2 restart rm-web"
fi
echo "════════════════════════════════════════════════════════"
