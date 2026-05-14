#!/usr/bin/env bash
# ──────────────────────────────────────────────────────────────────────────────
# One-shot: push everything to GitHub, fix any prior 403s, prime backup/auto.
#
# What it does:
#   1. Confirms the repo exists on GitHub
#   2. Fixes the origin URL if it's malformed (recovers from the earlier
#      gh-create glitch that set origin to https://github.com//.git)
#   3. Sets up authentication — prefers SSH, falls back to a PAT prompted from
#      you and stored properly in macOS Keychain
#   4. Pushes main
#   5. Creates and pushes backup/auto (the safety-net branch)
#   6. Verifies remote HEAD matches local HEAD
#
# Re-run safely as many times as you need.
# ──────────────────────────────────────────────────────────────────────────────
set -euo pipefail

REPO_OWNER="hariskulkarni"
REPO_NAME="maverick-food-hub"
EXPECTED_HTTPS="https://github.com/$REPO_OWNER/$REPO_NAME.git"
EXPECTED_SSH="git@github.com:$REPO_OWNER/$REPO_NAME.git"
REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

# Colours — use ANSI-C quoting ($'...') so the backslash escapes are
# interpreted at assignment time, not as literal \033 characters in printf.
G=$'\033[32m'; R=$'\033[31m'; Y=$'\033[33m'; B=$'\033[34m'; N=$'\033[0m'

say()  { printf "${B}→${N} %s\n" "$*"; }
ok()   { printf "${G}✓${N} %s\n" "$*"; }
err()  { printf "${R}✗${N} %s\n" "$*"; }
warn() { printf "${Y}!${N} %s\n" "$*"; }

# ── pre-flight ───────────────────────────────────────────────────────────
if ! git rev-parse --git-dir >/dev/null 2>&1; then
  err "Not a git repository. Run ./scripts/init-git.sh first."
  exit 1
fi

if ! command -v gh >/dev/null 2>&1; then
  err "GitHub CLI (gh) is not installed."
  echo "  Install:  brew install gh && gh auth login"
  exit 1
fi

if ! gh auth status >/dev/null 2>&1; then
  err "gh is not authenticated."
  echo "  Run:  gh auth login"
  exit 1
fi

GH_USER="$(gh api user --jq .login)"
if [[ "$GH_USER" != "$REPO_OWNER" ]]; then
  warn "gh is authenticated as '$GH_USER' but the repo owner is '$REPO_OWNER'."
  echo -n "  Continue anyway? [y/N]: "
  read -r CONFIRM
  [[ "$CONFIRM" != "y" && "$CONFIRM" != "Y" ]] && exit 1
fi

# ── 1. Verify the repo exists ────────────────────────────────────────────
say "Verifying $REPO_OWNER/$REPO_NAME exists on GitHub"
if gh repo view "$REPO_OWNER/$REPO_NAME" >/dev/null 2>&1; then
  ok "Repo exists"
else
  warn "Repo not found — creating it now (PRIVATE)"
  gh repo create "$REPO_OWNER/$REPO_NAME" --private \
    --description "Maverick's Food Hub — multi-tenant food ordering platform"
  ok "Repo created"
fi

# ── 2. Pick an auth method ───────────────────────────────────────────────
USE_SSH="false"

# If user already has an SSH key registered on github.com, prefer SSH
if ssh -T -o BatchMode=yes -o ConnectTimeout=5 git@github.com 2>&1 | grep -q "successfully authenticated"; then
  ok "SSH to github.com works — using SSH"
  USE_SSH="true"
fi

if [[ "$USE_SSH" == "false" ]]; then
  echo ""
  echo "Your earlier HTTPS push hit a 403. Two ways to fix it:"
  echo ""
  echo "  ${B}A)${N} ${G}SSH${N} (recommended — set-and-forget, no passwords)"
  echo "  ${B}B)${N} ${G}Personal Access Token (PAT)${N} (paste a token, stored in Keychain)"
  echo ""
  echo -n "Choose [A/b]: "
  read -r CHOICE
  CHOICE="${CHOICE:-A}"

  if [[ "$CHOICE" == "A" || "$CHOICE" == "a" ]]; then
    # ── SSH path ─────────────────────────────────────────────────────────
    SSH_KEY="$HOME/.ssh/id_ed25519"
    if [[ ! -f "$SSH_KEY" ]]; then
      say "Generating a new ed25519 SSH key at $SSH_KEY"
      ssh-keygen -t ed25519 -C "$(gh api user --jq .email)" -f "$SSH_KEY" -N ""
    else
      ok "Using existing SSH key at $SSH_KEY"
    fi

    say "Adding the public key to your GitHub account"
    if ! gh ssh-key list 2>/dev/null | grep -q "$(cut -d' ' -f2 < "$SSH_KEY.pub")"; then
      # Refresh gh scopes to include admin:public_key if missing
      if ! gh ssh-key add "$SSH_KEY.pub" --title "MacBook $(hostname -s) $(date +%Y-%m-%d)" 2>/dev/null; then
        warn "gh needs more scopes — refreshing"
        gh auth refresh -h github.com -s admin:public_key
        gh ssh-key add "$SSH_KEY.pub" --title "MacBook $(hostname -s) $(date +%Y-%m-%d)"
      fi
      ok "SSH key uploaded"
    else
      ok "SSH key already registered with GitHub"
    fi

    say "Testing SSH auth (this may show a host-key prompt the first time)"
    ssh -o StrictHostKeyChecking=accept-new -T git@github.com 2>&1 | head -1 || true
    USE_SSH="true"

  else
    # ── PAT path ─────────────────────────────────────────────────────────
    echo ""
    echo "Create a fine-scoped PAT at:"
    echo "  ${B}https://github.com/settings/tokens/new${N}"
    echo ""
    echo "  Note:             maverick-food-hub-push"
    echo "  Expiration:       90 days"
    echo "  Scopes:           ${G}repo${N}  (just the top-level 'repo' checkbox)"
    echo ""
    echo "Then paste it below. The token will go straight into macOS Keychain,"
    echo "NOT into shell history or .git/config."
    echo ""
    echo -n "Paste PAT (input hidden): "
    # -s suppresses echo
    read -r -s PAT
    echo ""

    if [[ -z "$PAT" ]]; then
      err "No PAT entered. Aborting."
      exit 1
    fi

    say "Configuring git to use macOS Keychain for credentials"
    git config --global credential.helper osxkeychain

    # Purge any stale github.com entry
    security delete-internet-password -s github.com 2>/dev/null || true

    say "Stashing PAT in Keychain for github.com"
    # `git credential approve` writes via the configured helper
    printf "protocol=https\nhost=github.com\nusername=%s\npassword=%s\n\n" \
      "$REPO_OWNER" "$PAT" | git credential approve
    ok "PAT stored in Keychain"

    # Wipe PAT from this shell's memory
    unset PAT
  fi
fi

# ── 3. Make sure origin is correct ───────────────────────────────────────
say "Setting origin to the right URL"
EXPECTED_URL="$EXPECTED_HTTPS"
[[ "$USE_SSH" == "true" ]] && EXPECTED_URL="$EXPECTED_SSH"

if git remote get-url origin >/dev/null 2>&1; then
  CURRENT_URL="$(git remote get-url origin)"
  if [[ "$CURRENT_URL" != "$EXPECTED_URL" ]]; then
    git remote set-url origin "$EXPECTED_URL"
    ok "Updated origin: $CURRENT_URL → $EXPECTED_URL"
  else
    ok "origin already correct: $EXPECTED_URL"
  fi
else
  git remote add origin "$EXPECTED_URL"
  ok "Added origin: $EXPECTED_URL"
fi

# ── 4. Push main ─────────────────────────────────────────────────────────
say "Pushing main → origin (this is the big one — be patient)"
if git push -u origin main; then
  ok "main pushed"
else
  err "Push failed. Most common causes:"
  echo "    • PAT lacks 'repo' scope → create a new one with the right scope"
  echo "    • SSH key not registered → check  gh ssh-key list"
  echo "    • Network blocked → curl -I https://github.com"
  exit 1
fi

# ── 5. Prime backup/auto ─────────────────────────────────────────────────
say "Priming backup/auto branch (the hourly-snapshot target)"
git update-ref refs/heads/backup/auto "$(git rev-parse HEAD)"
git push -u origin backup/auto --force-with-lease
ok "backup/auto pushed"

# ── 6. Verify ────────────────────────────────────────────────────────────
say "Verifying remote matches local"
LOCAL_SHA="$(git rev-parse HEAD)"
REMOTE_SHA="$(gh api "repos/$REPO_OWNER/$REPO_NAME/branches/main" --jq .commit.sha)"

if [[ "$LOCAL_SHA" == "$REMOTE_SHA" ]]; then
  ok "main @ $LOCAL_SHA matches remote"
else
  err "Mismatch: local=$LOCAL_SHA remote=$REMOTE_SHA"
  exit 1
fi

# ── done ─────────────────────────────────────────────────────────────────
echo ""
echo "════════════════════════════════════════════════════════════════════"
ok "All set."
echo ""
echo "   ${B}Repo${N}:    https://github.com/$REPO_OWNER/$REPO_NAME"
echo "   ${B}Main${N}:    https://github.com/$REPO_OWNER/$REPO_NAME/tree/main"
echo "   ${B}Backup${N}:  https://github.com/$REPO_OWNER/$REPO_NAME/tree/backup/auto"
echo ""
echo "Next steps:"
echo "   1. Install the hourly safety net:"
echo "      ${B}./scripts/install-auto-backup.sh${N}"
echo ""
echo "   2. For everyday commits:"
echo "      ${B}./scripts/backup.sh \"what changed\"${N}"
echo ""
echo "   3. When ready to set up the VPS:"
echo "      ${B}./scripts/generate-deploy-key.sh${N}"
echo "════════════════════════════════════════════════════════════════════"
