#!/usr/bin/env bash
# ──────────────────────────────────────────────────────────────────────────────
# One-time: initialise the local repo, create the GitHub repo, push.
#
# Prereqs:
#   1. GitHub account (you have one if you've logged into github.com)
#   2. `brew install gh` — the GitHub CLI
#   3. `gh auth login` — choose GitHub.com → HTTPS → "Login with browser"
#
# Run:
#   ./scripts/init-git.sh restaurant-manager
#
# What it does:
#   • git init at repo root
#   • Adds & commits everything respecting .gitignore
#   • Creates a PRIVATE GitHub repo under your account
#   • Pushes main + creates the backup/auto branch
# ──────────────────────────────────────────────────────────────────────────────
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

REPO_NAME="${1:-maverick-food-hub}"

# ── checks ───────────────────────────────────────────────────────────────
if ! command -v gh >/dev/null 2>&1; then
  echo "✗ The GitHub CLI (gh) is not installed."
  echo "  Install:  brew install gh"
  echo "  Then:     gh auth login"
  exit 1
fi

if ! gh auth status >/dev/null 2>&1; then
  echo "✗ gh is installed but not authenticated."
  echo "  Run:  gh auth login"
  echo "        → GitHub.com → HTTPS → Login with browser"
  exit 1
fi

GH_USER="$(gh api user --jq .login)"
echo "→ Authenticated as: $GH_USER"
echo "→ Target repo: $GH_USER/$REPO_NAME (private)"
echo ""

# ── confirm ──────────────────────────────────────────────────────────────
if [[ "${SKIP_CONFIRM:-}" != "true" ]]; then
  echo -n "Proceed? [y/N]: "
  read -r CONFIRM
  if [[ "$CONFIRM" != "y" && "$CONFIRM" != "Y" ]]; then
    echo "Aborted."
    exit 0
  fi
fi

# ── git init (idempotent) ────────────────────────────────────────────────
if [[ -d .git ]]; then
  echo "→ .git already exists — skipping git init"
else
  echo "→ git init"
  git init -b main
fi

git config user.email "${GIT_EMAIL:-harish.adobearchitect@gmail.com}"
git config user.name "${GIT_NAME:-Harish Kulkarni}"

# ── initial commit ───────────────────────────────────────────────────────
echo "→ git add -A"
git add -A

if git diff --cached --quiet; then
  echo "→ nothing to commit (already up to date)"
else
  echo "→ git commit"
  git commit -m "chore: initial import of Restaurant Manager

Maverick's Food Hub — multi-tenant food ordering platform.
Customer site, admin dashboard, kitchen panel, rider PWA, super-admin,
delivery tracking, payments, SMS/email, and the Capacitor rider APK shell.
"
fi

# ── create + push ────────────────────────────────────────────────────────
EXPECTED_URL="https://github.com/$GH_USER/$REPO_NAME.git"

if gh repo view "$GH_USER/$REPO_NAME" >/dev/null 2>&1; then
  echo "→ Repo $GH_USER/$REPO_NAME already exists on GitHub"
else
  echo "→ Creating PRIVATE repo $GH_USER/$REPO_NAME"
  # Pass OWNER/NAME explicitly — some gh versions print broken templated output
  # when given just a name, which can lead to a malformed `origin` URL.
  gh repo create "$GH_USER/$REPO_NAME" \
    --private \
    --description "Maverick's Food Hub — multi-tenant food ordering platform"
fi

# Reset origin to the known-correct URL no matter what (idempotent + recovers
# from prior runs where `gh repo create --source=. --remote=origin` set a
# broken URL like https://github.com//.git).
if git remote get-url origin >/dev/null 2>&1; then
  CURRENT_URL="$(git remote get-url origin)"
  if [[ "$CURRENT_URL" != "$EXPECTED_URL" ]]; then
    echo "→ Fixing origin URL ($CURRENT_URL → $EXPECTED_URL)"
    git remote set-url origin "$EXPECTED_URL"
  fi
else
  git remote add origin "$EXPECTED_URL"
fi

# Push main
echo "→ Pushing main → $EXPECTED_URL"
git push -u origin main

# ── prime backup/auto branch ─────────────────────────────────────────────
echo "→ Priming backup/auto branch"
git update-ref refs/heads/backup/auto "$(git rev-parse HEAD)"
git push -u origin backup/auto --force-with-lease

# ── summary ──────────────────────────────────────────────────────────────
echo ""
echo "✓ All done."
echo ""
echo "   Repo:    https://github.com/$GH_USER/$REPO_NAME"
echo "   Branch:  main (working) + backup/auto (rolling snapshot)"
echo ""
echo "Next steps:"
echo "  1. Install the hourly safety-net job:"
echo "     ./scripts/install-auto-backup.sh"
echo ""
echo "  2. For manual backups going forward:"
echo "     ./scripts/backup.sh \"what you changed\""
echo ""
echo "  3. Wire up the VPS deploy key:"
echo "     ./scripts/generate-deploy-key.sh"
