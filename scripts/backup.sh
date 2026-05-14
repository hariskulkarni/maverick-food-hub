#!/usr/bin/env bash
# ──────────────────────────────────────────────────────────────────────────────
# Manual backup — stage, commit, push.
#
# For everyday work: when you've made a meaningful chunk of changes and want
# them on GitHub. Prompts for a message; falls back to a timestamp.
#
#   ./scripts/backup.sh              # prompt for commit message
#   ./scripts/backup.sh "msg here"   # use the provided message
#   ./scripts/backup.sh --quick      # commit with auto-message + push
# ──────────────────────────────────────────────────────────────────────────────
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

# ── parse args ───────────────────────────────────────────────────────────
QUICK="false"
MESSAGE=""
if [[ "${1:-}" == "--quick" ]]; then
  QUICK="true"
elif [[ $# -gt 0 ]]; then
  MESSAGE="$1"
fi

# ── any changes? ─────────────────────────────────────────────────────────
if git diff --quiet && git diff --cached --quiet && [[ -z "$(git ls-files --others --exclude-standard)" ]]; then
  echo "Nothing to commit — working tree is clean."
  echo "Pushing current branch anyway in case of un-pushed commits…"
  git push 2>/dev/null || true
  exit 0
fi

# ── stage everything ─────────────────────────────────────────────────────
echo "→ Files that will be committed:"
git add -A
git status --short
echo ""

# ── message ──────────────────────────────────────────────────────────────
if [[ -z "$MESSAGE" ]]; then
  if [[ "$QUICK" == "true" ]]; then
    MESSAGE="backup: $(date '+%Y-%m-%d %H:%M')"
  else
    echo -n "Commit message [Enter for default]: "
    read -r MESSAGE
    if [[ -z "$MESSAGE" ]]; then
      MESSAGE="backup: $(date '+%Y-%m-%d %H:%M')"
    fi
  fi
fi

# ── commit ───────────────────────────────────────────────────────────────
echo "→ Committing: $MESSAGE"
git commit -m "$MESSAGE"

# ── push ─────────────────────────────────────────────────────────────────
BRANCH="$(git rev-parse --abbrev-ref HEAD)"
echo "→ Pushing $BRANCH to origin"
if git push origin "$BRANCH"; then
  echo ""
  echo "✓ Done. Latest on GitHub at:"
  REMOTE_URL="$(git remote get-url origin)"
  echo "    $REMOTE_URL"
else
  echo ""
  echo "✗ Push failed. Common causes:"
  echo "  • Branch hasn't been pushed before:  git push -u origin $BRANCH"
  echo "  • Auth missing:  gh auth login   (or set up SSH key)"
  exit 1
fi
