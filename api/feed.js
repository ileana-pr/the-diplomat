// vercel calls this file for /api/feed. `npm start` uses server.js, which calls the same function.
import { buildFeed } from '../lib/feed.js';

export const maxDuration = 60;

export async function handleFeed(address) {
  const trimmed = (address || '').trim();
  if (trimmed.length < 5) {
    return { status: 400, body: { error: 'Please enter your street address, city, state and ZIP.' } };
  }
  try {
    return { status: 200, body: await buildFeed(trimmed) };
  } catch (e) {
    console.error(e);
    return {
      status: e.status || 502,
      body: { error: e.status ? e.message : `Couldn't reach the address lookup service: ${e.message}` },
    };
  }
}

function addressFrom(req) {
  try {
    const url = new URL(req.url || '/', 'http://localhost');
    const fromUrl = url.searchParams.get('address');
    if (fromUrl) return fromUrl;
  } catch {}
  const query = req.query?.address;
  return Array.isArray(query) ? query[0] : query || '';
}

export default async function handler(req, res) {
  const { status, body } = await handleFeed(addressFrom(req));
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(body));
}
