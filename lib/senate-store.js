// saves senate.gov roll-call xml on disk so a page load does not have to open chrome.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { blocks, tag } from './xml.js';
import { withChrome } from './browser-fetch.js';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const HOUR = 60 * 60 * 1000;
// a quiet hour is one request (the list). new or changed votes are a few files, newest first.
const FETCH_PER_PASS = 5;

export function senateDir() {
  return process.env.SENATE_STORE_DIR || path.join(root, 'data', 'senate');
}

function menuFile(congress, session) {
  return path.join(senateDir(), `vote_menu_${congress}_${session}.xml`);
}

function voteFile(congress, session, num) {
  return path.join(senateDir(), `vote_${congress}_${session}_${num}.xml`);
}

function voteNumbers(menu) {
  return blocks(menu, 'vote').map((v) => tag(v, 'vote_number')).filter(Boolean);
}

// the list has no last-edited time. these fields are what it does show for each vote.
function voteSignature(block) {
  return ['vote_date', 'issue', 'question', 'result', 'yeas', 'nays', 'title'].map((name) => tag(block, name)).join('|');
}

function signatures(menu) {
  const out = new Map();
  if (!menu) return out;
  for (const block of blocks(menu, 'vote')) {
    const num = tag(block, 'vote_number');
    if (num) out.set(num, voteSignature(block));
  }
  return out;
}

// which vote files to download this pass.
// a file we already have is skipped until the list shows a different result or tally.
export function planSenateFetches({ oldMenu, newMenu, hasFile, synced = {}, limit = FETCH_PER_PASS }) {
  const oldSigs = signatures(oldMenu);
  const nextSynced = { ...synced };
  const corrections = [];
  const missing = [];
  for (const [num, sig] of signatures(newMenu)) {
    if (!hasFile(num)) {
      missing.push(num);
      continue;
    }
    const known = synced[num] || oldSigs.get(num) || '';
    if (known && known !== sig) {
      corrections.push(num);
      // keep the old signature until the new file is actually saved
      nextSynced[num] = known;
    } else nextSynced[num] = sig;
  }
  return { fetch: [...corrections, ...missing].slice(0, limit), synced: nextSynced };
}

function denied(error) {
  const message = String(error?.message || '');
  return message.includes('Access Denied') || message.includes('Unauthorized');
}

// votes already on disk. null when the folder has nothing we can show yet.
export function readSavedSenateXml(congress, session) {
  const file = menuFile(congress, session);
  if (!fs.existsSync(file)) return null;
  const menu = fs.readFileSync(file, 'utf8');
  const votes = [];
  for (const num of voteNumbers(menu)) {
    const vote = voteFile(congress, session, num);
    if (!fs.existsSync(vote)) continue;
    const xml = fs.readFileSync(vote, 'utf8');
    if (xml.includes('<roll_call_vote')) votes.push({ num, xml });
  }
  if (!votes.length) return null;
  const status = readStatus();
  return { votes, savedAt: status.updatedAt || null, total: voteNumbers(menu).length };
}

function readStatus() {
  try { return JSON.parse(fs.readFileSync(path.join(senateDir(), 'status.json'), 'utf8')); } catch { return {}; }
}

// open chrome, refresh the list, and download votes that are missing or whose result changed.
// each file is requested once. a refusal stops the rest of this pass.
export async function refreshSenateVotes(congress, session) {
  const menuUrl = `https://www.senate.gov/legislative/LIS/roll_call_lists/vote_menu_${congress}_${session}.xml`;
  return withChrome(async (chrome) => {
    fs.mkdirSync(senateDir(), { recursive: true });
    const menuPath = menuFile(congress, session);
    const previousMenu = fs.existsSync(menuPath) ? fs.readFileSync(menuPath, 'utf8') : '';
    const previous = readStatus();
    const sameSession = previous.congress === congress && previous.session === session;
    let menu;
    try {
      menu = await chrome.text(menuUrl);
      if (!menu.includes('<vote_summary')) throw new Error('The Senate vote menu was not XML.');
      fs.writeFileSync(menuPath, menu);
    } catch (e) {
      // keep the last good menu if this check was refused.
      if (!previousMenu) throw e;
      menu = previousMenu;
      console.error('Could not refresh the Senate menu, using the saved copy:', e.message);
    }
    const hasFile = (num) => fs.existsSync(voteFile(congress, session, num));
    const plan = planSenateFetches({
      oldMenu: previousMenu,
      newMenu: menu,
      hasFile,
      synced: sameSession ? previous.synced || {} : {},
    });
    const sigs = signatures(menu);
    let fetched = 0;
    for (const num of plan.fetch) {
      const url = `https://www.senate.gov/legislative/LIS/roll_call_votes/vote${congress}${session}/vote_${congress}_${session}_${num}.xml`;
      try {
        const xml = await chrome.text(url);
        if (!xml.includes('<roll_call_vote')) throw new Error('not a roll call');
        await new Promise((r) => setTimeout(r, 400));
        fs.writeFileSync(voteFile(congress, session, num), xml);
        plan.synced[num] = sigs.get(num);
        fetched++;
      } catch (e) {
        // a failed download leaves the previous file in place.
        // asking again right after a refusal makes the block worse, so this pass stops.
        console.error(`Could not save Senate vote ${num}: ${e.message}`);
        if (denied(e)) break;
      }
    }
    const nums = voteNumbers(menu);
    const allowed = new Set(nums);
    const synced = {};
    for (const [num, sig] of Object.entries(plan.synced)) {
      if (allowed.has(num)) synced[num] = sig;
    }
    const saved = nums.filter(hasFile).length;
    const status = { updatedAt: new Date().toISOString(), congress, session, newest: nums[0] || null, saved, total: nums.length, fetched, dir: senateDir(), synced };
    fs.writeFileSync(path.join(senateDir(), 'status.json'), JSON.stringify(status, null, 2) + '\n');
    return status;
  });
}

// check about once an hour. a user's request only reads the saved files.
export function startSenateRefresh() {
  let running = false;
  const run = async () => {
    if (running) return;
    running = true;
    try {
      const { currentCongress } = await import('./federal.js');
      const { congress, session } = currentCongress();
      const status = await refreshSenateVotes(congress, session);
      console.log(`Senate votes: ${status.saved} of ${status.total} saved, ${status.fetched} downloaded this pass (${status.dir})`);
    } catch (e) {
      console.error('Could not refresh Senate votes:', e.message);
    } finally {
      running = false;
    }
  };
  run();
  const timer = setInterval(run, Number(process.env.SENATE_REFRESH_MS) || HOUR);
  timer.unref?.();
}
