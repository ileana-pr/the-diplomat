import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { handleFeed } from './api/feed.js';
import { loadEnv } from './lib/env.js';
import { warmSavedHttp } from './lib/http.js';

const root = path.dirname(fileURLToPath(import.meta.url));

loadEnv();

const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon' };

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname === '/api/feed') {
    const { status, body } = await handleFeed(url.searchParams.get('address'));
    return send(res, status, body);
  }
  const file = path.normalize(path.join(root, 'public', url.pathname === '/' ? 'index.html' : url.pathname));
  if (!file.startsWith(path.join(root, 'public'))) return send(res, 403, { error: 'Forbidden' });
  fs.readFile(file, (err, data) => {
    if (err) return send(res, 404, { error: 'Not found' });
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
    res.end(data);
  });
});

function send(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
}

const port = +process.env.PORT || 3000;
server.listen(port, () => {
  console.log(`The Diplomat is running at http://localhost:${port}`);
  if (!process.env.CONGRESS_API_KEY) console.log('  Tip: add CONGRESS_API_KEY to .env (free at https://api.congress.gov/sign-up/)');
  if (!process.env.OPENSTATES_API_KEY) console.log('  Tip: add OPENSTATES_API_KEY to .env for Virginia General Assembly data');
  if (!process.env.DATABASE_URL) console.log('  Tip: run `vercel env pull` for DATABASE_URL. Without it, Senate votes are forgotten when the server stops');
  warmSavedHttp();
});
