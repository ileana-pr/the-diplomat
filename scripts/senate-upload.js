// uploads senate vote files already saved in data/senate to the database.
// a roll call the database already has a file for is left alone, so this is safe to run again.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEnv } from '../lib/env.js';
import { parseSenateList, parseSenateVote } from '../lib/federal.js';
import { senateStore, usingDatabase } from '../lib/senate-db.js';

loadEnv();
if (!usingDatabase()) {
  console.error('DATABASE_URL is missing. Run `vercel env pull` first.');
  process.exit(1);
}

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'data', 'senate');
const lists = fs.existsSync(dir) ? fs.readdirSync(dir).filter((name) => /^vote_menu_\d+_\d\.xml$/.test(name)) : [];
if (!lists.length) {
  console.error(`No saved vote list in ${dir}`);
  process.exit(1);
}

const store = senateStore();
for (const name of lists) {
  const [, congress, session] = name.match(/^vote_menu_(\d+)_(\d)\.xml$/).map(Number);
  const rows = parseSenateList(fs.readFileSync(path.join(dir, name), 'utf8'));
  const have = new Set(await store.savedNumbers(congress, session));
  let uploaded = 0;
  const skipped = [];
  for (const row of rows) {
    if (have.has(row.number)) continue;
    const file = path.join(dir, `vote_${congress}_${session}_${String(row.number).padStart(5, '0')}.xml`);
    if (!fs.existsSync(file)) { skipped.push(`${row.number} (no file)`); continue; }
    const vote = parseSenateVote(fs.readFileSync(file, 'utf8'), row.number);
    // a file that disagrees with the list is out of date. the site downloads a fresh one later.
    if (vote.yeas !== row.yeas || vote.nays !== row.nays) { skipped.push(`${row.number} (tally differs from the list)`); continue; }
    await store.saveVote(congress, session, vote, row.mark);
    uploaded++;
    if (uploaded % 25 === 0) console.log(`  ${uploaded} uploaded...`);
  }
  console.log(`Congress ${congress}, session ${session}: ${uploaded} uploaded, ${have.size} already there, ${skipped.length} skipped`);
  if (skipped.length) console.log(`  Skipped: ${skipped.join(', ')}`);
}
