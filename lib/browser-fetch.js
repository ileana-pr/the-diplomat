// reads a url with a real chrome window parked off-screen.
// headless chrome is refused by senate.gov. a normal window is not.
import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const CANDIDATES = [
  process.env.CHROME_PATH,
  '/mnt/c/Program Files/Google/Chrome/Application/chrome.exe',
  '/mnt/c/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium-browser',
  '/usr/bin/chromium',
].filter(Boolean);

export function findChrome() {
  return CANDIDATES.find((p) => {
    try { return fs.existsSync(p); } catch { return false; }
  }) || null;
}

function profileDir(exe) {
  if (exe.toLowerCase().endsWith('.exe')) {
    let temp = 'C:\\Windows\\Temp';
    try {
      const out = execFileSync('cmd.exe', ['/c', 'echo %TEMP%'], { encoding: 'utf8', cwd: '/mnt/c/Windows' }).trim();
      if (out && !out.includes('%TEMP%')) temp = out;
    } catch {}
    return `${temp}\\diplomat-senate-${Date.now()}`;
  }
  return path.join(os.tmpdir(), 'diplomat-senate-chrome');
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// opens one chrome and reads several pages with it, then closes the window.
export async function withChrome(fn) {
  const exe = findChrome();
  if (!exe) throw new Error('Install Google Chrome so Senate votes can be read.');
  const port = await pickPort();
  // windows chrome is started by a short-lived linux helper, so the helper
  // exiting does not mean the browser exited. quit through the debugging port.
  const logPath = path.join(os.tmpdir(), 'diplomat-chrome.log');
  const log = fs.openSync(logPath, 'a');
  spawn(exe, [
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profileDir(exe)}`,
    '--window-position=-32000,-32000',
    '--window-size=900,700',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-blink-features=AutomationControlled',
    'about:blank',
  ], { stdio: ['ignore', log, log], cwd: exe.toLowerCase().endsWith('.exe') ? '/mnt/c/Windows' : os.tmpdir() });
  const session = await connect(port);
  try {
    return await fn(session);
  } finally {
    await session.close();
  }
}

async function pickPort() {
  for (let port = 9341; port < 9360; port++) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/json/version`, { signal: AbortSignal.timeout(300) });
      if (res.ok) continue;
    } catch {
      return port;
    }
  }
  throw new Error('No free port for Chrome.');
}

async function connect(port) {
  let version;
  for (let i = 0; i < 40; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/json/version`);
      if (res.ok) { version = await res.json(); break; }
    } catch {}
    await sleep(250);
  }
  if (!version) throw new Error('Chrome did not open its debugging port.');

  const ws = new WebSocket(version.webSocketDebuggerUrl);
  let nextId = 0;
  const pending = new Map();
  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve);
    ws.addEventListener('error', () => reject(new Error('Could not connect to Chrome.')));
  });
  ws.addEventListener('message', (ev) => {
    const msg = JSON.parse(ev.data);
    if (!msg.id || !pending.has(msg.id)) return;
    const wait = pending.get(msg.id);
    pending.delete(msg.id);
    if (msg.error) wait.reject(new Error(msg.error.message || 'Chrome command failed.'));
    else wait.resolve(msg.result);
  });
  const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
    const id = ++nextId;
    pending.set(id, { resolve, reject });
    const msg = { id, method, params };
    if (sessionId) msg.sessionId = sessionId;
    ws.send(JSON.stringify(msg));
  });

  const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
  await send('Page.enable', {}, sessionId);
  await send('Runtime.enable', {}, sessionId);
  await send('Network.enable', {}, sessionId);
  // a refused page must not stick in the cache and hide a later good copy.
  await send('Network.setCacheDisabled', { cacheDisabled: true }, sessionId);

  return {
    async text(url) {
      await send('Page.navigate', { url }, sessionId);
      // the old page is still "complete" for a moment, so wait until this url is showing.
      const want = new URL(url).pathname;
      let href = '';
      for (let i = 0; i < 80; i++) {
        const state = await send('Runtime.evaluate', {
          expression: 'JSON.stringify({ state: document.readyState, href: location.href })',
          returnByValue: true,
        }, sessionId);
        let info = {};
        try { info = JSON.parse(state.result?.value || '{}'); } catch {}
        href = info.href || '';
        if (info.state === 'complete' && href.includes(want)) break;
        await sleep(250);
        href = '';
      }
      if (!href.includes(want)) throw new Error(`Chrome timed out opening ${url}`);
      // chrome wraps xml in a viewer page. fetching the same address returns the raw file.
      // a security check sometimes shows a script page first, then the xml.
      const read = () => send('Runtime.evaluate', {
        expression: 'fetch(location.href).then((r) => r.text())',
        awaitPromise: true,
        returnByValue: true,
      }, sessionId);
      let body = '';
      for (let i = 0; i < 16; i++) {
        const got = await read();
        if (got.exceptionDetails) throw new Error(`Chrome could not read ${url}`);
        body = got.result?.value || '';
        if (body.includes('<?xml')) return body;
        if (body.includes('Access Denied') || body.includes('Senate.gov - Unauthorized')) break;
        await sleep(500);
      }
      const sample = String(body).replace(/\s+/g, ' ').slice(0, 80);
      throw new Error(`senate.gov did not return xml for ${url} (${sample})`);
    },
    async close() {
      try { await send('Browser.close'); } catch {}
      try { ws.close(); } catch {}
    },
  };
}
