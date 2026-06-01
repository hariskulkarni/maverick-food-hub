#!/usr/bin/env bash
# nuke-and-pave.sh — total-rebuild deploy with proof at every step.
# Run on the VPS. Prints a numbered transcript so we can see exactly
# where the deploy is getting stuck.
#
# Usage:  bash scripts/nuke-and-pave.sh

set -u
cd /opt/restaurant-manager || { echo "FATAL: /opt/restaurant-manager not found"; exit 1; }

G='\033[0;32m'; R='\033[0;31m'; Y='\033[1;33m'; B='\033[1;34m'; NC='\033[0m'
step() { echo; echo -e "${B}══ STEP $1: $2 ══${NC}"; }
ok()   { echo -e "    ${G}✓${NC} $1"; }
warn() { echo -e "    ${Y}!${NC} $1"; }
fail() { echo -e "    ${R}✗${NC} $1"; }

# ─────────────────────────────────────────────────────────────────────
step 1 "Git state — what's on disk RIGHT NOW"
BEFORE_HEAD=$(git rev-parse --short HEAD 2>/dev/null || echo "no-git")
echo "    HEAD on disk before pull: $BEFORE_HEAD"
git log -1 --format='    %h  %s' || true

# ─────────────────────────────────────────────────────────────────────
step 2 "Stash anything local that would block the pull"
if [ -n "$(git status --porcelain 2>/dev/null)" ]; then
  warn "Local changes present — stashing"
  git stash push -u -m "nuke-and-pave $(date +%s)" 2>&1 | sed 's/^/      /' || true
else
  ok "Working tree clean"
fi

# ─────────────────────────────────────────────────────────────────────
step 3 "Pull from GitHub"
PULL_OUTPUT=$(git pull --rebase 2>&1)
echo "$PULL_OUTPUT" | sed 's/^/    /'
AFTER_HEAD=$(git rev-parse --short HEAD)
echo "    HEAD on disk after pull:  $AFTER_HEAD"

if [ "$BEFORE_HEAD" = "$AFTER_HEAD" ]; then
  warn "NO new commits pulled. Either Mac didn't push, or this VPS was already up to date."
  echo "    On your Mac, run:  cd ~/Documents/Claude/Projects/Restaurant\\ Manager && git push origin main"
  echo "    Then re-run this script."
else
  ok "Pulled $(echo $PULL_OUTPUT | grep -c '|') file changes"
fi

# ─────────────────────────────────────────────────────────────────────
step 4 "Confirm Phase 18 SW kill switch is in source"
if grep -q "self.registration.unregister" apps/web/public/sw.js 2>/dev/null; then
  ok "sw.js contains the unregister() call (Phase 18)"
else
  fail "sw.js does NOT contain unregister()."
  echo "    The git pull didn't bring the Phase 18 commit. Either:"
  echo "      a) Mac didn't push e4c3fac.  Run on Mac:  git log --oneline -3"
  echo "      b) git pull errored above."
  exit 1
fi

# ─────────────────────────────────────────────────────────────────────
step 5 "Confirm Phase 17 menu-card source change"
if grep -q "md:hidden" apps/web/src/app/\(customer\)/menu/menu-item-card.tsx 2>/dev/null; then
  ok "menu-item-card.tsx contains the md:hidden split layout"
else
  fail "menu-item-card.tsx is missing the md:hidden split."
  exit 1
fi

# ─────────────────────────────────────────────────────────────────────
step 6 "Nuke .next and node_modules/.cache — leave no stale build artefact"
cd apps/web
rm -rf .next node_modules/.cache
ok "Removed .next and node_modules/.cache"

# ─────────────────────────────────────────────────────────────────────
step 7 "Generate Prisma client + run Next.js build"
echo "    Running: npx prisma generate && npm run build"
BUILD_OUTPUT=$(npx prisma generate 2>&1 && npm run build 2>&1)
BUILD_EXIT=$?
echo "$BUILD_OUTPUT" | tail -40 | sed 's/^/    /'
if [ $BUILD_EXIT -ne 0 ]; then
  fail "Build FAILED with exit code $BUILD_EXIT — pm2 will not be restarted."
  exit 1
fi
ok "Build succeeded"

# ─────────────────────────────────────────────────────────────────────
step 8 "Confirm Phase 17 grid class compiled into CSS"
CSS_FILES=$(find .next/static/css -name '*.css' 2>/dev/null | head -3)
if [ -z "$CSS_FILES" ]; then
  fail ".next/static/css/*.css not found — build produced no CSS"
  exit 1
fi
echo "    CSS files: $CSS_FILES"
if grep -l "100vw" $CSS_FILES > /dev/null 2>&1; then
  ok "Compiled CSS contains the overflow-x clamp"
else
  warn "100vw not present in compiled CSS — the new layout classes may not have compiled"
fi

# ─────────────────────────────────────────────────────────────────────
step 9 "pm2 restart — full restart, not reload"
cd /opt/restaurant-manager
pm2 restart rm-web --update-env 2>&1 | sed 's/^/    /'
sleep 2
pm2 list 2>&1 | grep -E "rm-web|name" | sed 's/^/    /'

# ─────────────────────────────────────────────────────────────────────
step 10 "Verify production HTML — fetch / and look for the SW kill code"
sleep 2
HTML=$(curl -sSL --max-time 12 https://flavrly.in/ 2>/dev/null || echo "")
if [ -z "$HTML" ]; then
  fail "Couldn't fetch https://flavrly.in/ — pm2 may not be serving"
else
  ok "Fetched HTML ($(echo -n "$HTML" | wc -c) bytes)"
  # The new sw-register.tsx contains 'getRegistrations' which only appears
  # in the new code. If it's in the served HTML, the new bundle is live.
  if echo "$HTML" | grep -q "overflow-x-hidden"; then
    ok "Served HTML has overflow-x-hidden — Phase 10+ layout clamp is live"
  else
    warn "overflow-x-hidden NOT in served HTML"
  fi
fi

# ─────────────────────────────────────────────────────────────────────
echo
echo "════════════════════════════════════════════════════════"
echo "Deploy complete. On your PHONE:"
echo "  1. Fully QUIT Safari (swipe up from bottom, swipe Safari away)"
echo "  2. Reopen Safari, navigate to https://flavrly.in/"
echo "  3. The SW kill switch runs — your old cache is wiped"
echo "  4. Hard-refresh the menu page (pull down to refresh)"
echo "  5. Take a screenshot and share if it's still broken"
echo "════════════════════════════════════════════════════════"
