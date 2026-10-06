// Tiny HubSpot client for the one-time setup scripts (Node 18+).
// Auth: HUBSPOT_TOKEN = an Ops-owned private app / service key token. Never commit it.
const BASE = 'https://api.hubapi.com';

export function token() {
  const t = process.env.HUBSPOT_TOKEN;
  if (!t) {
    console.error('Set HUBSPOT_TOKEN to a private app token with the scopes listed in README.md.');
    process.exit(1);
  }
  return t;
}

export async function hs(path, { method = 'GET', body, allow = [] } = {}) {
  for (let attempt = 0; attempt < 4; attempt++) {
    const res = await fetch(BASE + path, {
      method,
      headers: { Authorization: `Bearer ${token()}`, 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (res.status === 429 || res.status >= 500) {
      await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
      continue;
    }
    const text = await res.text();
    let data = null;
    if (text) {
      try {
        data = JSON.parse(text);
      } catch {
        // HubSpot answers some errors (unknown routes, auth problems at the edge) with an HTML page.
        data = { message: `non-JSON response: ${text.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 200)}` };
      }
    }
    if (!res.ok && !allow.includes(res.status)) throw new Error(`${method} ${path} → ${res.status}: ${(data && data.message) || text}`);
    return { status: res.status, data };
  }
  throw new Error(`${method} ${path} kept failing after retries`);
}

export async function searchAll(objectType, body) {
  const out = [];
  let after;
  do {
    const { data } = await hs(`/crm/v3/objects/${objectType}/search`, { method: 'POST', body: { ...body, limit: 200, after } });
    out.push(...data.results);
    after = data.paging?.next?.after;
  } while (after);
  return out;
}

export const apply = process.argv.includes('--apply');

export function csv(rows) {
  const cols = Object.keys(rows[0] || {});
  const esc = (v) => {
    const s = v == null ? '' : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [cols.join(',')].concat(rows.map((r) => cols.map((c) => esc(r[c])).join(','))).join('\n') + '\n';
}
