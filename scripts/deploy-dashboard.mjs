#!/usr/bin/env node
/**
 * Flavrly deploy dashboard — a tiny, zero-dependency control panel.
 *
 * Runs on YOUR MAC. Serves a local web page (http://127.0.0.1:4321) with three
 * buttons so you never have to remember which command runs on which machine:
 *
 *   • Commit & Push   → stages all changes, commits, and pushes to GitHub (Mac)
 *   • Deploy to VPS    → pipes scripts/fix-prod.sh over SSH to the server, which
 *                        hard-syncs origin/main, installs, db push, rebuilds,
 *                        and restarts pm2 (VPS)
 *   • Full Deploy      → does both, in order, stopping if the push fails
 *
 * Live command output streams into the page as it runs. The server binds to
 * loopback only (127.0.0.1), so it is never exposed to your network.
 *
 * Usage (from the repo root or anywhere):
 *   node "scripts/deploy-dashboard.mjs"
 *   # then open http://127.0.0.1:4321  (it tries to open automatically)
 *
 * Requirements: git + ssh already configured on the Mac (you already deploy
 * this way). No npm install needed — uses only Node built-ins.
 */

import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';
import { existsSync } from 'node:fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');
const FIX_PROD = join(REPO_ROOT, 'scripts', 'fix-prod.sh');

// ── Config (override with env vars if the server ever moves) ────────────────
const PORT = Number(process.env.DEPLOY_DASH_PORT || 4321);
const SSH_TARGET = process.env.DEPLOY_SSH_TARGET || 'deploy@148.230.66.124';
const BRANCH = process.env.DEPLOY_BRANCH || 'main';

/**
 * Spawn a command and stream combined stdout/stderr to an HTTP response as
 * text/event-stream-ish chunks. We use plain chunked text (not real SSE) and a
 * sentinel line so the client knows when each command exits.
 */
function streamCommand(res, label, cmd, args, opts = {}) {
  res.write(`\n$ ${label}\n`);
  const child = spawn(cmd, args, { cwd: REPO_ROOT, ...opts });
  return new Promise((resolveStep) => {
    child.stdout.on('data', (d) => res.write(d.toString()));
    child.stderr.on('data', (d) => res.write(d.toString()));
    child.on('error', (err) => {
      res.write(`\n[error] ${err.message}\n`);
      resolveStep(1);
    });
    child.on('close', (code) => {
      res.write(`\n[exit ${code}] ${label}\n`);
      resolveStep(code ?? 1);
    });
  });
}

/** Run `git push` flow. Returns exit code (0 = ok). */
async function doPush(res, message) {
  const msg = (message && message.trim()) || `Deploy ${new Date().toISOString()}`;
  await streamCommand(res, 'git add -A', 'git', ['add', '-A']);
  // commit may exit non-zero when there's nothing to commit — that's fine, we
  // still want to push (in case a previous commit wasn't pushed).
  const commitCode = await streamCommand(res, `git commit -m "${msg}"`, 'git', ['commit', '-m', msg]);
  if (commitCode !== 0) {
    res.write('\n(note) commit returned non-zero — likely "nothing to commit". Continuing to push.\n');
  }
  const pushCode = await streamCommand(res, `git push origin ${BRANCH}`, 'git', ['push', 'origin', BRANCH]);
  return pushCode;
}

/** Run the VPS deploy: pipe fix-prod.sh over SSH. Returns exit code. */
async function doDeploy(res) {
  if (!existsSync(FIX_PROD)) {
    res.write(`\n[error] cannot find ${FIX_PROD}\n`);
    return 1;
  }
  // Equivalent to:  ssh <target> 'bash -s' < scripts/fix-prod.sh
  // We use bash -lc so the input redirection happens in a shell.
  const cmd = `ssh ${SSH_TARGET} 'bash -s' < ${JSON.stringify(FIX_PROD)}`;
  return streamCommand(res, cmd, 'bash', ['-lc', cmd]);
}

const PAGE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Flavrly · Deploy</title>
<style>
  :root { color-scheme: light dark; }
  * { box-sizing: border-box; }
  body {
    margin: 0; font: 15px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
    background: #fff5f7; color: #2a1320; min-height: 100vh;
  }
  .wrap { max-width: 880px; margin: 0 auto; padding: 28px 20px 60px; }
  header { display: flex; align-items: center; gap: 12px; margin-bottom: 6px; }
  .logo { width: 38px; height: 38px; border-radius: 11px; display: grid; place-items: center;
    background: linear-gradient(135deg, #f23e5c, #c026d3); color: #fff; font-weight: 800; font-size: 20px; }
  h1 { font-size: 22px; margin: 0; letter-spacing: -0.01em; }
  .sub { color: #8a5e6e; margin: 2px 0 22px; font-size: 13px; }
  .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 12px; }
  .field { margin: 0 0 16px; }
  label { display: block; font-weight: 600; font-size: 12px; text-transform: uppercase; letter-spacing: .04em; color: #8a5e6e; margin-bottom: 6px; }
  input[type=text] { width: 100%; padding: 11px 13px; border: 1px solid #f0c9d4; border-radius: 11px; font-size: 14px; background: #fff; }
  input[type=text]:focus { outline: none; border-color: #f23e5c; box-shadow: 0 0 0 3px rgba(242,62,92,.18); }
  button { border: 0; border-radius: 12px; padding: 14px 16px; font-size: 14px; font-weight: 700; cursor: pointer;
    transition: transform .12s ease, box-shadow .2s ease, opacity .2s; width: 100%; }
  button:active { transform: scale(.98); }
  button:disabled { opacity: .5; cursor: not-allowed; }
  .btn-push { background: #fff; color: #c41f5c; border: 1.5px solid #f4a9bd; }
  .btn-deploy { background: #fff; color: #7a1f4a; border: 1.5px solid #d8b3c8; }
  .btn-full { background: linear-gradient(135deg, #f23e5c, #c026d3); color: #fff; box-shadow: 0 8px 22px -10px rgba(242,62,92,.7); }
  .status { display: inline-flex; align-items: center; gap: 7px; font-size: 13px; font-weight: 600; margin: 18px 0 8px; }
  .dot { width: 9px; height: 9px; border-radius: 50%; background: #c9b3bd; }
  .dot.run { background: #f6a609; animation: blink 1s ease-in-out infinite; }
  .dot.ok { background: #1f9d6b; }
  .dot.err { background: #e0314b; }
  @keyframes blink { 50% { opacity: .35; } }
  pre { background: #1d1117; color: #f3e9ee; border-radius: 14px; padding: 16px; overflow: auto;
    max-height: 56vh; font: 12.5px/1.55 ui-monospace, SFMono-Regular, Menlo, monospace; white-space: pre-wrap; word-break: break-word; margin: 0; }
  .hint { font-size: 12px; color: #8a5e6e; margin-top: 10px; }
  .row { display: grid; grid-template-columns: 1fr 1fr 1.2fr; gap: 12px; margin-top: 4px; }
  @media (max-width: 620px) { .row { grid-template-columns: 1fr; } }
</style>
</head>
<body>
<div class="wrap">
  <header>
    <div class="logo">F</div>
    <div>
      <h1>Flavrly Deploy</h1>
      <div class="sub">Push to GitHub and ship to production — one click, right machine.</div>
    </div>
  </header>

  <div class="field">
    <label for="msg">Commit message</label>
    <input id="msg" type="text" placeholder="What changed in this deploy?" />
  </div>

  <div class="row">
    <button class="btn-push"   onclick="run('push')">⬆︎ Commit &amp; Push</button>
    <button class="btn-deploy" onclick="run('deploy')">🚀 Deploy to VPS</button>
    <button class="btn-full"   onclick="run('full')">⚡ Full Deploy (push + ship)</button>
  </div>

  <div class="status"><span class="dot" id="dot"></span><span id="statusText">Idle — pick an action above.</span></div>
  <pre id="log">Ready.\n</pre>
  <div class="hint">Tip: after it finishes, hard-refresh flavrly.in (Cmd+Shift+R). Watch the log for <b>HEAD is now</b>, <b>✓ Compiled successfully</b>, and pm2 <b>online</b>.</div>
</div>

<script>
  const logEl = document.getElementById('log');
  const dot = document.getElementById('dot');
  const statusText = document.getElementById('statusText');
  const buttons = () => Array.from(document.querySelectorAll('button'));

  function setBusy(busy, label) {
    buttons().forEach(b => b.disabled = busy);
    dot.className = 'dot' + (busy ? ' run' : '');
    statusText.textContent = label;
  }

  async function run(action) {
    const message = document.getElementById('msg').value;
    logEl.textContent = '';
    setBusy(true, action === 'push' ? 'Pushing to GitHub…' : action === 'deploy' ? 'Deploying to VPS…' : 'Full deploy running…');
    try {
      const res = await fetch('/api/' + action, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message })
      });
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let tail = '';
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        const chunk = dec.decode(value, { stream: true });
        tail += chunk;
        logEl.textContent += chunk;
        logEl.scrollTop = logEl.scrollHeight;
      }
      const ok = !/\\[exit [^0]\\d*\\]/.test(tail) && !/\\[error\\]/.test(tail) && /\\[exit 0\\]/.test(tail);
      dot.className = 'dot ' + (ok ? 'ok' : 'err');
      statusText.textContent = ok ? 'Done ✓ — hard-refresh flavrly.in to verify.' : 'Finished with errors — check the log.';
    } catch (e) {
      logEl.textContent += '\\n[client error] ' + e.message + '\\n';
      dot.className = 'dot err';
      statusText.textContent = 'Request failed.';
    } finally {
      buttons().forEach(b => b.disabled = false);
    }
  }
</script>
</body>
</html>`;

const server = createServer(async (req, res) => {
  if (req.method === 'GET' && (req.url === '/' || req.url === '/index.html')) {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(PAGE);
    return;
  }

  if (req.method === 'POST' && req.url?.startsWith('/api/')) {
    const action = req.url.slice('/api/'.length);
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', async () => {
      let message = '';
      try { message = JSON.parse(body || '{}').message || ''; } catch {}
      res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-cache' });

      try {
        if (action === 'push') {
          await doPush(res, message);
        } else if (action === 'deploy') {
          await doDeploy(res);
        } else if (action === 'full') {
          const code = await doPush(res, message);
          if (code !== 0) {
            res.write('\n(!) Push failed — NOT deploying. Fix the push error above and retry.\n');
          } else {
            res.write('\n========== push OK · starting VPS deploy ==========\n');
            await doDeploy(res);
          }
        } else {
          res.write(`\n[error] unknown action "${action}"\n`);
        }
      } catch (err) {
        res.write(`\n[error] ${err.message}\n`);
      }
      res.end();
    });
    return;
  }

  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end('Not found');
});

server.listen(PORT, '127.0.0.1', () => {
  const url = `http://127.0.0.1:${PORT}`;
  console.log(`\n  Flavrly deploy dashboard → ${url}`);
  console.log(`  Repo:   ${REPO_ROOT}`);
  console.log(`  VPS:    ${SSH_TARGET}  (branch ${BRANCH})`);
  console.log(`  Press Ctrl+C to stop.\n`);
  // Best-effort auto-open on macOS.
  spawn('open', [url], { stdio: 'ignore' }).on('error', () => {});
});
