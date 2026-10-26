// Integrated demo — the restaurant owner's Novaryq Developer-console steps, done through the same
// staff API the console uses (LOCAL ONLY): sign in, mint a partner API key for Flavrly, and create
// the webhook subscription pointing at the Flavrly restaurant's webhook URL (CONTRACT-CHANGES NQ-1).
// Prints KEY=VALUE lines for up.sh. Usage: node link-novaryq.mjs <novaryqApi> <ownerEmail> <ownerPassword> <flavrlyWebhookUrl>
const [api, email, password, webhookUrl] = process.argv.slice(2);

async function call(method, path, body, token) {
  const res = await fetch(`${api}${path}`, {
    method,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => null);
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status} ${JSON.stringify(json)}`);
  return json;
}

const login = await call('POST', '/v1/auth/login', { email, password });
if (!login.accessToken) throw new Error(`owner login did not return a token: ${JSON.stringify(login)}`);
const key = await call('POST', '/v1/dev-platform/keys', { name: 'Flavrly ordering channel (demo)', scopes: ['read:menu', 'read:orders', 'write:orders'] }, login.accessToken);
const hook = await call('POST', '/v1/dev-platform/webhooks', { url: webhookUrl, events: ['order.status_changed', 'menu.item.availability_changed'] }, login.accessToken);
console.log(`NQ_CLIENT_ID=${key.clientId}`);
console.log(`NQ_SECRET=${key.secret}`);
console.log(`NQ_WEBHOOK_ID=${hook.id}`);
console.log(`NQ_WEBHOOK_SECRET=${hook.secret}`);
