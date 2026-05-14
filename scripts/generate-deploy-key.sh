#!/usr/bin/env bash
# ──────────────────────────────────────────────────────────────────────────────
# Generate a read-only SSH deploy key for the production VPS.
#
# Output:
#   ~/.ssh/maverick-vps-deploy        — private key (stays on your Mac for now)
#   ~/.ssh/maverick-vps-deploy.pub    — public key (paste into GitHub)
#
# Why a deploy key, not your personal SSH key?
#   • Scoped to ONE repo (revocable in seconds if the VPS is compromised)
#   • Read-only by default (the VPS can `git pull` but never `git push`)
#   • Doesn't expose your personal GitHub identity to the server
#
# After running this:
#   1. Copy the .pub contents (it prints them at the end)
#   2. Paste into GitHub → repo → Settings → Deploy keys → Add deploy key
#      • Title: "Hostinger KVM 2 — maverick-prod-1"
#      • Key: paste the .pub
#      • Allow write access: LEAVE UNCHECKED (we want read-only)
#   3. Copy both files to the VPS:
#        scp ~/.ssh/maverick-vps-deploy* deploy@<vps-ip>:~/.ssh/
#   4. On the VPS, set up the SSH config (the script prints the snippet)
# ──────────────────────────────────────────────────────────────────────────────
set -euo pipefail

KEY_PATH="$HOME/.ssh/maverick-vps-deploy"
KEY_COMMENT="maverick-vps-deploy $(date +%Y-%m-%d)"

if [[ -f "$KEY_PATH" ]]; then
  echo "→ Deploy key already exists at $KEY_PATH"
  echo "  Delete both files first if you want to regenerate:"
  echo "    rm -f $KEY_PATH $KEY_PATH.pub"
  exit 0
fi

mkdir -p "$HOME/.ssh"
chmod 700 "$HOME/.ssh"

echo "→ Generating ed25519 SSH keypair"
ssh-keygen -t ed25519 -C "$KEY_COMMENT" -f "$KEY_PATH" -N ""

chmod 600 "$KEY_PATH"
chmod 644 "$KEY_PATH.pub"

echo ""
echo "✓ Generated:"
echo "    $KEY_PATH        (private — keep secret)"
echo "    $KEY_PATH.pub    (public — paste into GitHub)"
echo ""
echo "─────────────────────────────────────────────────────────────────────"
echo "  STEP 1 — Add the public key to GitHub"
echo "─────────────────────────────────────────────────────────────────────"
echo "  Go to:    https://github.com/<your-user>/<repo>/settings/keys"
echo "  Click:    'Add deploy key'"
echo "  Title:    Hostinger KVM 2 — maverick-prod-1"
echo "  Allow write: UNCHECKED (read-only)"
echo ""
echo "  Paste this public key:"
echo ""
cat "$KEY_PATH.pub"
echo ""
echo "─────────────────────────────────────────────────────────────────────"
echo "  STEP 2 — Copy the keypair to the VPS"
echo "─────────────────────────────────────────────────────────────────────"
echo "  scp $KEY_PATH $KEY_PATH.pub deploy@<vps-ip>:~/.ssh/"
echo ""
echo "─────────────────────────────────────────────────────────────────────"
echo "  STEP 3 — On the VPS, configure SSH to use it for github.com"
echo "─────────────────────────────────────────────────────────────────────"
echo "  ssh deploy@<vps-ip>"
echo "  chmod 600 ~/.ssh/maverick-vps-deploy"
echo "  chmod 644 ~/.ssh/maverick-vps-deploy.pub"
echo ""
echo "  cat >> ~/.ssh/config <<'EOF'"
echo "  Host github.com"
echo "      HostName github.com"
echo "      User git"
echo "      IdentityFile ~/.ssh/maverick-vps-deploy"
echo "      IdentitiesOnly yes"
echo "  EOF"
echo "  chmod 600 ~/.ssh/config"
echo ""
echo "  # Test"
echo "  ssh -T git@github.com"
echo "  # Expect: 'Hi <your-user>/<repo>! You've successfully authenticated...'"
echo ""
echo "─────────────────────────────────────────────────────────────────────"
echo "  STEP 4 — Clone the repo on the VPS via SSH"
echo "─────────────────────────────────────────────────────────────────────"
echo "  cd /opt && sudo mkdir -p restaurant-manager"
echo "  sudo chown deploy:deploy restaurant-manager"
echo "  git clone git@github.com:<your-user>/<repo>.git restaurant-manager"
echo ""
echo "  After that, deploy/deploy.sh works end-to-end."
