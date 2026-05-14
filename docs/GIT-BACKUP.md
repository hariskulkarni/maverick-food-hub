# GitHub backup & sync

How the Restaurant Manager codebase stays continuously backed up to GitHub, plus how the production VPS pulls from the same repo.

Two layers protect against data loss:

1. **Manual commits** — you run `./scripts/backup.sh "message"` when you finish a meaningful change. Standard developer workflow, clean history on `main`.
2. **Hourly safety net** — a launchd job snapshots your working tree (including uncommitted changes) every hour and force-pushes to a `backup/auto` branch on GitHub. If your Mac drowns, the most you ever lose is the last 60 minutes of work.

Both push to the same private GitHub repo. The VPS pulls `main` (never `backup/auto`) using a read-only deploy key.

---

## 1. One-time setup (on the Mac)

### Prereq — GitHub CLI

```bash
brew install gh
gh auth login
# Choose:  GitHub.com → HTTPS → "Login with browser"
# Authorize in the browser tab that opens.
```

### Initialise + push

```bash
cd "/Users/hkulkarni/Documents/Claude/Projects/Restaurant Manager"
./scripts/init-git.sh maverick-food-hub
```

What this does, step by step:
1. `git init -b main` (idempotent — skips if already a repo)
2. Sets `user.name` and `user.email` from `$GIT_NAME` / `$GIT_EMAIL` or sensible defaults
3. `git add -A` (respects the root `.gitignore` — `node_modules`, `.env`, `dev.db`, `uploads/`, keystores, build outputs are all excluded)
4. `git commit -m "chore: initial import..."`
5. Creates `https://github.com/<you>/maverick-food-hub` as **private**
6. `git push -u origin main`
7. Primes `backup/auto` to point at `main` and pushes it

After this, the repo is live on GitHub. Bookmark it.

### Install the hourly safety-net

```bash
./scripts/install-auto-backup.sh
```

Drops a launchd plist into `~/Library/LaunchAgents/com.maverick.git-backup.plist` and loads it. The job runs immediately (RunAtLoad) and then every hour on the hour.

Verify:

```bash
launchctl list | grep maverick
# com.maverick.git-backup  (PID)  0
tail -f ~/Library/Logs/maverick-git-backup.log
# [2026-05-14T...] clean tree — pointing backup/auto at HEAD (abc123)
# [2026-05-14T...] pushed backup/auto → origin (abc123)
```

To stop the safety net later: `./scripts/install-auto-backup.sh uninstall`.

---

## 2. Day-to-day workflow

### Saving real work

```bash
./scripts/backup.sh "fix: rider OTP race on slow networks"
```

Behavior:
- Shows the files that will be committed (so you can spot accidentally-staged secrets)
- Falls back to a timestamp message if you press Enter without typing one
- Pushes the current branch (not always `main`) to origin
- Tells you what to do if the push fails (auth, missing upstream)

For one-keystroke saves with no prompts:

```bash
./scripts/backup.sh --quick
# Commits as "backup: 2026-05-14 17:32" and pushes.
```

### What the auto-backup is doing under the hood

The `scripts/auto-backup.sh` cron uses `git stash create` — a non-destructive snapshot operation. It builds a commit object capturing your tracked + staged + untracked state **without touching your index, working tree, or current branch**. The resulting commit is force-pushed to `backup/auto`.

Why force-push? `backup/auto` is a single rolling "last good snapshot" pointer — we don't want a 24-commits-per-day history clogging the branch list. GitHub keeps the previous tip in its **reflog for 90 days**, so old snapshots are recoverable from there if you ever need one.

### Recovering from disaster

Scenario: laptop dies. Replacement Mac arrives 3 days later.

```bash
# On the new Mac, after brew install gh && gh auth login:
git clone git@github.com:<you>/maverick-food-hub.git
cd maverick-food-hub

# To pick up wherever the hourly job last snapshotted:
git checkout backup/auto -- .         # merges backup snapshot onto main
git status                            # shows the recovered uncommitted changes
```

The auto-backup branch can be **up to 60 minutes** older than your last keystroke before the crash — that's the only data loss window.

---

## 3. Wiring up the production VPS

The deploy script at `deploy/deploy.sh` runs `git fetch && git reset --hard origin/main` on the VPS. For that to work, the VPS needs read access to the GitHub repo. We use a **deploy key** instead of your personal credentials — scoped to this one repo, read-only by default, revocable from GitHub in two clicks.

### Generate the keypair (on your Mac)

```bash
./scripts/generate-deploy-key.sh
```

Output:
- `~/.ssh/maverick-vps-deploy` — private (will copy to VPS)
- `~/.ssh/maverick-vps-deploy.pub` — public (paste into GitHub)

The script prints the rest of the instructions at the end of its run. Brief version:

1. **GitHub** → repo → Settings → **Deploy keys** → Add deploy key
   - Title: `Hostinger KVM 2 — maverick-prod-1`
   - Key: paste `~/.ssh/maverick-vps-deploy.pub`
   - **Allow write access:** leave UNCHECKED (read-only — the VPS should never push)
2. **Mac terminal** — copy keypair to VPS:
   ```bash
   scp ~/.ssh/maverick-vps-deploy* deploy@<vps-ip>:~/.ssh/
   ```
3. **VPS** — configure SSH to use the key for `github.com`:
   ```bash
   ssh deploy@<vps-ip>
   chmod 600 ~/.ssh/maverick-vps-deploy
   cat >> ~/.ssh/config <<'EOF'
   Host github.com
       HostName github.com
       User git
       IdentityFile ~/.ssh/maverick-vps-deploy
       IdentitiesOnly yes
   EOF
   chmod 600 ~/.ssh/config
   ssh -T git@github.com   # expect "Hi <user>/<repo>! ..."
   ```
4. **VPS** — clone:
   ```bash
   cd /opt && sudo mkdir -p restaurant-manager
   sudo chown deploy:deploy restaurant-manager
   git clone git@github.com:<you>/maverick-food-hub.git restaurant-manager
   ```

Now `deploy/deploy.sh` works end-to-end: it pulls from `origin/main`, builds, and reloads PM2.

---

## 4. Security checklist

Before pushing the very first commit, audit what's about to land on GitHub:

```bash
# Anything sensitive? Run these and review the output.
git ls-files | grep -E '\.(env|key|pem|p12|pfx|crt|keystore|jks)$'
git ls-files | grep -E 'secret|password|token|credential' -i
git ls-files | grep -E 'uploads/'
```

If any of those produce hits, **stop**: add the offending pattern to `.gitignore`, run `git rm --cached <file>` to remove from the index, and re-check.

The shipped root `.gitignore` already covers:
- `.env`, `.env.*` (production credentials)
- `*.keystore`, `*.jks`, `apps/android-rider/android/keystore.properties` (APK signing)
- `prisma/dev.db` (local dev data)
- `public/uploads/`, `apps/web/public/uploads/` (user-uploaded images)
- `*.key`, `*.pem` (TLS, signing)

If you accidentally commit a secret, **rotate it immediately** even after `git rm` + force-push, because anything that touched GitHub is assumed compromised:
- Rotate Razorpay keys in the dashboard
- Rotate MSG91 auth key
- Reset SMTP password in Zoho/Brevo
- Regenerate `NEXTAUTH_SECRET` and `APP_ENCRYPTION_KEY`

---

## 5. File index

| File | Purpose |
|---|---|
| `.gitignore` | Root ignore rules covering monorepo, secrets, build artifacts, OS junk |
| `scripts/init-git.sh` | One-time: `git init` + GitHub repo create + first push |
| `scripts/backup.sh` | Manual `add -A` + commit + push |
| `scripts/auto-backup.sh` | Non-destructive snapshot → force-push to `backup/auto` |
| `scripts/install-auto-backup.sh` | Install / uninstall the launchd job |
| `scripts/com.maverick.git-backup.plist` | launchd template (substitutes paths) |
| `scripts/generate-deploy-key.sh` | Create the read-only VPS deploy key + instructions |
| `docs/GIT-BACKUP.md` | This document |

---

## 6. Quick reference

```bash
# First-time setup
brew install gh && gh auth login
./scripts/init-git.sh maverick-food-hub
./scripts/install-auto-backup.sh
./scripts/generate-deploy-key.sh         # follow the printed steps

# Day-to-day
./scripts/backup.sh "what you did"        # manual commit + push
./scripts/backup.sh --quick               # one-shot, auto-message

# Check status
launchctl list | grep maverick            # hourly job running?
tail -f ~/Library/Logs/maverick-git-backup.log

# Disaster recovery on a new Mac
gh repo clone <you>/maverick-food-hub
cd maverick-food-hub
git checkout backup/auto -- .             # pick up uncommitted hourly snapshot
```
