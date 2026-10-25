// Webhook tap for local UAT: gateway -> http://localhost:3312/... -> app http://localhost:3311/...
// Records every inbound request byte-for-byte (headers + raw body) under $UAT_DIR/tap/ so a
// captured delivery can be replayed later, and can stall a delivery to create a crash window.
// Mode is read per request from $UAT_DIR/tap.mode (one line):
//   pass                    forward immediately (default)
//   hold-response:<ms>      forward to the app at once, but answer the gateway only after <ms>
//                           (app has committed; gateway has not seen the 200 yet)
//   hold-request:<ms>       wait <ms> before forwarding; if the gateway connection is gone by
//                           then, DROP the request (the app never sees it)
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const dir = process.env.UAT_DIR;
const tapDir = path.join(dir, 'tap');
fs.mkdirSync(tapDir, { recursive: true });
let n = fs.readdirSync(tapDir).length;
const mode = () => { try { return fs.readFileSync(path.join(dir, 'tap.mode'), 'utf8').trim() || 'pass'; } catch { return 'pass'; } };
// Request-derived values (url, headers) are logged: strip CR/LF so a crafted request can't forge log lines.
const log = (m) => console.log(`${new Date().toISOString()} ${String(m).replace(/\n|\r/g, '')}`);

http.createServer((req, res) => {
  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', () => {
    const raw = Buffer.concat(chunks);
    const id = String(++n).padStart(4, '0');
    const m = mode();
    fs.writeFileSync(path.join(tapDir, `${id}.json`), JSON.stringify({ at: new Date().toISOString(), method: req.method, url: req.url, headers: req.headers, bodyB64: raw.toString('base64'), mode: m }));
    log(`#${id} ${req.method} ${req.url} webhook-id=${req.headers['webhook-id']} mode=${m}`);
    let clientGone = false;
    res.on('close', () => { if (!res.writableEnded) { clientGone = true; log(`#${id} gateway connection closed before response`); } });
    const forward = (cb) => {
      const up = http.request({ host: '127.0.0.1', port: 3311, path: req.url, method: req.method, headers: { ...req.headers, host: 'localhost:3311' } }, (r) => {
        const out = [];
        r.on('data', (c) => out.push(c));
        r.on('end', () => cb(r.statusCode, r.headers, Buffer.concat(out)));
      });
      up.on('error', (e) => cb(502, {}, Buffer.from(String(e))));
      up.end(raw);
    };
    const reply = (status, headers, body) => {
      if (clientGone) return log(`#${id} app answered ${status} but gateway is gone (response lost)`);
      res.writeHead(status, { 'content-type': headers['content-type'] || 'text/plain' });
      res.end(body);
      log(`#${id} -> gateway ${status} ${body.toString().slice(0, 120)}`);
    };
    const [kind, msStr] = m.split(':');
    const ms = Number(msStr) || 0;
    if (kind === 'hold-response') {
      forward((s, h, b) => { log(`#${id} app answered ${s}; holding response ${ms}ms`); setTimeout(() => reply(s, h, b), ms); });
    } else if (kind === 'hold-request') {
      setTimeout(() => {
        if (clientGone) return log(`#${id} DROPPED (gateway gone before forward; app never saw it)`);
        forward(reply);
      }, ms);
    } else {
      forward(reply);
    }
  });
}).listen(3312, '127.0.0.1', () => log('webhook tap on http://localhost:3312'));
