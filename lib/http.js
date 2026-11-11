// fetch helpers with a memory cache and a saved copy on disk.
// a page load uses the saved copy. if it is old, a new download happens in the background.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const UA = 'TheDiplomat/0.1 (personal civic feed)';
const cache = new Map();
const inflight = new Map();
const useDisk = !process.env.NODE_TEST_CONTEXT;
const diskRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'data', 'http');

function diskFile(url) {
  const name = crypto.createHash('sha256').update(url).digest('hex');
  return path.join(diskRoot, `${name}.json`);
}

function readDisk(url) {
  if (!useDisk) return null;
  try {
    const saved = JSON.parse(fs.readFileSync(diskFile(url), 'utf8'));
    if (typeof saved.body !== 'string') return null;
    return saved;
  } catch {
    return null;
  }
}

function writeDisk(url, body, ttl) {
  const expires = Date.now() + ttl;
  cache.set(url, { value: body, expires });
  if (!useDisk) return;
  try {
    fs.mkdirSync(diskRoot, { recursive: true });
    // the url is stored so a restart can refresh this exact request.
    fs.writeFileSync(diskFile(url), JSON.stringify({ url, expires, body }));
  } catch {
    // a host like vercel can refuse writes. the memory cache above still holds the response.
  }
}

function remember(url, body, expires) {
  cache.set(url, { value: body, expires });
  return body;
}

async function fetchAndStore(url, { headers = {}, ttl = 10 * 60 * 1000, timeout = 20000 } = {}) {
  const res = await fetch(url, {
    headers: { 'User-Agent': UA, Accept: '*/*', ...headers },
    signal: AbortSignal.timeout(timeout),
  });
  if (!res.ok) {
    const err = new Error(`${res.status} ${res.statusText} from ${new URL(url).host}`);
    if (res.status === 404) cache.set(url, { error: err, expires: Date.now() + 15 * 60 * 1000 });
    throw err;
  }
  const body = await res.text();
  writeDisk(url, body, ttl);
  return body;
}

// one download per url at a time. a second caller waits for the same download.
function startFetch(url, opts) {
  const existing = inflight.get(url);
  if (existing) return existing;
  const job = fetchAndStore(url, opts).finally(() => inflight.delete(url));
  job.catch(() => {});
  inflight.set(url, job);
  return job;
}

export async function getText(url, { headers = {}, ttl = 10 * 60 * 1000, timeout = 20000, wait } = {}) {
  const hit = cache.get(url);
  if (hit?.error && hit.expires > Date.now()) throw hit.error;
  if (hit && !hit.error && hit.expires > Date.now()) return hit.value;

  const saved = readDisk(url);
  if (saved) {
    if (saved.expires <= Date.now()) startFetch(url, { headers, ttl, timeout });
    return remember(url, saved.body, Math.max(saved.expires, Date.now() + 1000));
  }

  const job = startFetch(url, { headers, ttl, timeout });
  const limit = wait ?? timeout;
  let timer;
  const giveUp = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`Timed out talking to ${new URL(url).host}`)), limit);
  });
  try {
    return await Promise.race([job, giveUp]);
  } finally {
    clearTimeout(timer);
  }
}

export async function getJSON(url, opts) {
  return JSON.parse(await getText(url, opts));
}

// Run async tasks with limited concurrency, keeping successes and ignoring failures.
export async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let i = 0;
  async function worker() {
    while (i < items.length) {
      const idx = i++;
      try { out[idx] = await fn(items[idx], idx); } catch { out[idx] = undefined; }
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

export function clearCache() {
  cache.clear();
}

// refresh saved copies that are old, without making a visitor wait.
export function warmSavedHttp() {
  if (!useDisk || !fs.existsSync(diskRoot)) return;
  for (const name of fs.readdirSync(diskRoot)) {
    if (!name.endsWith('.json')) continue;
    try {
      const saved = JSON.parse(fs.readFileSync(path.join(diskRoot, name), 'utf8'));
      if (saved.url && saved.expires <= Date.now()) startFetch(saved.url, { ttl: 60 * 60 * 1000, timeout: 30000 });
    } catch {}
  }
}
