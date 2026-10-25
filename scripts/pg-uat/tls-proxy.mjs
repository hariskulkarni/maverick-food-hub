// Minimal TLS terminator: https://localhost:7712 -> http://127.0.0.1:7711 (gateway checkout portal).
// Self-signed cert from $UAT_DIR/tls.{crt,key}. Local UAT only.
import https from 'node:https';
import http from 'node:http';
import fs from 'node:fs';
const dir = process.env.UAT_DIR;
https.createServer({ key: fs.readFileSync(`${dir}/tls.key`), cert: fs.readFileSync(`${dir}/tls.crt`) }, (req, res) => {
  const up = http.request({ host: '127.0.0.1', port: 7711, path: req.url, method: req.method, headers: { ...req.headers, host: 'localhost:7712', 'x-forwarded-proto': 'https' } }, (r) => {
    res.writeHead(r.statusCode || 502, r.headers);
    r.pipe(res);
  });
  up.on('error', () => { res.writeHead(502); res.end('upstream error'); });
  req.pipe(up);
}).listen(7712, '127.0.0.1', () => console.log('tls proxy on https://localhost:7712'));
