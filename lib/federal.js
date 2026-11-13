import { getJSON, getText, fetchText, mapLimit } from './http.js';
import { tag, blocks, attr, stripHtml, parseDMY, parseLongDate } from './xml.js';
import { federalLinks } from './research.js';
import { senateStore } from './senate-db.js';

const VOTES_TO_SCAN = 20;

export function currentCongress(date = new Date()) {
  const y = date.getUTCFullYear();
  return { congress: Math.floor((y - 1789) / 2) + 1, session: y % 2 === 1 ? 1 : 2, year: y };
}

// ---------- Who represents this address in Congress ----------
export async function findMembers(state, district) {
  const all = await getJSON('https://unitedstates.github.io/congress-legislators/legislators-current.json', { ttl: 24 * 3600 * 1000 });
  return pickMembers(all, state, district);
}

export function pickMembers(all, state, district) {
  const out = [];
  for (const leg of all) {
    const term = leg.terms[leg.terms.length - 1];
    if (term.state !== state) continue;
    const isSen = term.type === 'sen';
    if (!isSen && district != null && term.district !== district) continue;
    const name = leg.name.official_full || `${leg.name.first} ${leg.name.last}`;
    out.push({
      id: leg.id.bioguide,
      bioguide: leg.id.bioguide,
      lis: leg.id.lis,
      level: 'federal',
      name,
      lastName: leg.name.last,
      role: isSen ? 'U.S. Senator' : 'U.S. Representative',
      district: isSen ? state : `${state}-${term.district === 0 ? 'At Large' : term.district}`,
      chamber: isSen ? 'senate' : 'house',
      party: term.party,
      photo: `https://unitedstates.github.io/images/congress/225x275/${leg.id.bioguide}.jpg`,
      website: term.url,
      phone: term.phone,
      office: term.address || term.office,
      termStart: term.start,
      termEnd: term.end,
      firstElected: leg.terms[0]?.start?.slice(0, 4),
      birthday: leg.bio?.birthday,
      links: federalLinks(leg),
    });
  }
  // Senators first, then the House member.
  return out.sort((a, b) => (a.chamber === b.chamber ? 0 : a.chamber === 'senate' ? -1 : 1));
}

// ---------- Bills they sponsored and co-sponsored (Congress.gov) ----------
const BILL_PATH = { HR: 'house-bill', S: 'senate-bill', HRES: 'house-resolution', SRES: 'senate-resolution', HJRES: 'house-joint-resolution', SJRES: 'senate-joint-resolution', HCONRES: 'house-concurrent-resolution', SCONRES: 'senate-concurrent-resolution' };
const BILL_LABEL = { HR: 'H.R.', S: 'S.', HRES: 'H.Res.', SRES: 'S.Res.', HJRES: 'H.J.Res.', SJRES: 'S.J.Res.', HCONRES: 'H.Con.Res.', SCONRES: 'S.Con.Res.' };
function ordinal(n) {
  const t = n % 100;
  if (t >= 11 && t <= 13) return n + 'th';
  return n + ({ 1: 'st', 2: 'nd', 3: 'rd' }[n % 10] || 'th');
}

export function billUrl(congress, type, number) {
  const path = BILL_PATH[type?.toUpperCase()];
  return path ? `https://www.congress.gov/bill/${ordinal(congress)}-congress/${path}/${number}` : 'https://www.congress.gov/';
}

export async function sponsorships(member, apiKey) {
  const key = apiKey || 'DEMO_KEY';
  const base = `https://api.congress.gov/v3/member/${member.bioguide}`;
  const qs = `?format=json&limit=15&api_key=${encodeURIComponent(key)}`;
  const [sp, co] = await Promise.allSettled([
    getJSON(`${base}/sponsored-legislation${qs}`, { ttl: 3600 * 1000, timeout: 30000, wait: 4000 }),
    getJSON(`${base}/cosponsored-legislation${qs}`, { ttl: 3600 * 1000, timeout: 30000, wait: 4000 }),
  ]);
  const items = [];
  if (sp.status === 'fulfilled') items.push(...billItems(sp.value.sponsoredLegislation, member, 'sponsored'));
  if (co.status === 'fulfilled') items.push(...billItems(co.value.cosponsoredLegislation, member, 'cosponsored'));
  if (sp.status === 'rejected' && co.status === 'rejected') throw sp.reason;
  return items;
}

export function billItems(list = [], member, kind) {
  return list
    .filter((b) => b.number && b.type) // skip amendments
    .map((b) => {
      const label = `${BILL_LABEL[b.type.toUpperCase()] || b.type} ${b.number}`;
      return {
        id: `fed-${kind}-${member.bioguide}-${b.congress}-${b.type}-${b.number}`,
        level: 'federal',
        kind,
        date: (b.introducedDate || b.latestAction?.actionDate) + 'T12:00:00Z',
        title: b.title || label,
        billLabel: label,
        summary: b.latestAction?.text ? `Latest action (${b.latestAction.actionDate}): ${b.latestAction.text}` : '',
        topic: b.policyArea?.name,
        officials: [{ id: member.id, name: member.name, role: member.role }],
        url: billUrl(b.congress, b.type, b.number),
        source: 'Congress.gov',
      };
    });
}

// ---------- House roll-call votes (Office of the Clerk XML) ----------
// the yearly index page (index.asp) now 404s. the roll xml files are still published,
// and a missing roll comes back as a short "error sanitizing file" document.
const HOUSE_PROBE_TTL = 15 * 60 * 1000;

async function houseRollExists(year, n) {
  try {
    const xml = await getText(`https://clerk.house.gov/evs/${year}/roll${String(n).padStart(3, '0')}.xml`, { ttl: HOUSE_PROBE_TTL });
    return xml.includes('<rollcall-vote');
  } catch {
    return false;
  }
}

// roll numbers count up from 1 with no gaps, so this finds the newest one.
async function highestHouseRoll(year) {
  if (!(await houseRollExists(year, 1))) return 0;
  let upper = 1;
  while (upper < 2000 && (await houseRollExists(year, upper))) upper *= 2;
  let lo = upper / 2;
  let hi = Math.min(upper, 2000);
  while (lo + 1 < hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (await houseRollExists(year, mid)) lo = mid;
    else hi = mid;
  }
  return lo;
}

export async function latestHouseRolls(year) {
  try {
    const html = await getText(`https://clerk.house.gov/evs/${year}/index.asp`, { ttl: HOUSE_PROBE_TTL });
    const nums = [...html.matchAll(/rollnumber=(\d+)/gi)].map((m) => +m[1]);
    if (!nums.length) {
      // plain-text fallback: the index lists roll numbers at the start of each row.
      const m = html.match(/Roll Calls \d+ Thru (\d+)/i);
      if (m) nums.push(+m[1]);
    }
    if (nums.length) {
      const max = Math.max(0, ...nums);
      return Array.from({ length: Math.min(VOTES_TO_SCAN, max) }, (_, i) => max - i);
    }
  } catch {
    // index page is gone; look at the roll files themselves
  }
  const max = await highestHouseRoll(year);
  return Array.from({ length: Math.min(VOTES_TO_SCAN, max) }, (_, i) => max - i);
}

export function parseHouseRoll(xml, year, roll) {
  const meta = tag(xml, 'vote-metadata');
  const legis = tag(meta, 'legis-num');
  const positions = {};
  for (const rv of blocks(xml, 'recorded-vote')) {
    const legTag = rv.match(/<legislator[^>]*>/i)?.[0] || '';
    positions[attr(legTag, 'name-id')] = tag(rv, 'vote');
  }
  const totals = blocks(xml, 'totals-by-vote')[0] || '';
  return {
    chamber: 'house',
    number: roll,
    date: parseDMY(tag(meta, 'action-date')),
    question: tag(meta, 'vote-question'),
    result: tag(meta, 'vote-result'),
    bill: legis && legis !== '0' ? legis : '',
    description: tag(meta, 'vote-desc'),
    yeas: +tag(totals, 'yea-total') || null,
    nays: +tag(totals, 'nay-total') || null,
    url: `https://clerk.house.gov/Votes/${year}${String(roll)}`,
    positions,
  };
}

export async function houseVotes(year) {
  const rolls = await latestHouseRolls(year);
  const parsed = await mapLimit(rolls, 5, async (n) => {
    const xml = await getText(`https://clerk.house.gov/evs/${year}/roll${String(n).padStart(3, '0')}.xml`, { ttl: 24 * 3600 * 1000 });
    return parseHouseRoll(xml, year, n);
  });
  return parsed.filter(Boolean);
}

// ---------- Senate roll-call votes (senate.gov XML, saved between visits) ----------
// the list of roll calls says what changed. a vote file is downloaded only when it is new or changed.
const SENATE_DOWNLOADS = 20;
const SENATE_LIST_TTL = 15 * 60 * 1000;
const SENATE_TIMEOUT = 10000;
const SENATE_BASE = 'https://www.senate.gov/legislative/LIS';
const senateFile = (congress, session, number, ext) =>
  `${SENATE_BASE}/roll_call_votes/vote${congress}${session}/vote_${congress}_${session}_${String(number).padStart(5, '0')}.${ext}`;

// one row per roll call. the mark changes when the senate corrects a result, tally or title.
export function parseSenateList(xml) {
  if (!xml.includes('<vote_summary')) throw new Error('senate.gov did not return the list of votes');
  const year = tag(xml, 'congress_year');
  return blocks(xml, 'vote').map((v) => {
    const day = tag(v, 'vote_date');
    const row = {
      number: +tag(v, 'vote_number'),
      date: parseDMY(`${day}-${year}`),
      bill: stripHtml(tag(v, 'issue')),
      question: stripHtml(tag(v, 'question')),
      result: stripHtml(tag(v, 'result')),
      yeas: +tag(v, 'yeas') || null,
      nays: +tag(v, 'nays') || null,
      title: stripHtml(tag(v, 'title')),
    };
    row.mark = [day, row.bill, row.question, row.result, row.yeas, row.nays, row.title].join('|');
    return row;
  }).filter((row) => row.number > 0);
}

export function parseSenateVote(xml, number) {
  if (!xml.includes('<roll_call_vote')) throw new Error('senate.gov did not return the vote file');
  const doc = blocks(xml, 'document')[0] || '';
  const count = blocks(xml, 'count')[0] || '';
  return {
    number: +number,
    date: parseLongDate(tag(xml, 'vote_date')),
    question: tag(xml, 'vote_question_text') || tag(xml, 'question'),
    result: tag(xml, 'vote_result_text') || tag(xml, 'vote_result'),
    bill: tag(doc, 'document_name'),
    title: tag(xml, 'vote_title') || tag(doc, 'document_title'),
    yeas: +tag(count, 'yeas') || null,
    nays: +tag(count, 'nays') || null,
    members: blocks(xml, 'member').map((m) => ({
      lis: tag(m, 'lis_member_id') || `${tag(m, 'state')}:${tag(m, 'last_name')}`,
      state: tag(m, 'state'),
      lastName: tag(m, 'last_name'),
      cast: tag(m, 'vote_cast'),
    })),
  };
}

// which vote files to download this visit: changed ones first, then ones we do not have, newest first.
export function pickDownloads(pending, limit = SENATE_DOWNLOADS) {
  const newest = (a, b) => b.number - a.number;
  const changed = pending.filter((row) => row.fileMark != null).sort(newest);
  const missing = pending.filter((row) => row.fileMark == null).sort(newest);
  return [...changed, ...missing].slice(0, limit);
}

async function syncSenate(congress, session, store, now) {
  const out = { added: 0, updated: 0, problem: '' };
  try {
    const checked = await store.listCheckedAt(congress, session);
    if (!checked || now - checked > SENATE_LIST_TTL) {
      const xml = await fetchText(`${SENATE_BASE}/roll_call_lists/vote_menu_${congress}_${session}.xml`, { timeout: SENATE_TIMEOUT });
      await store.saveList(congress, session, parseSenateList(xml), now);
    }
    const picked = pickDownloads(await store.pending(congress, session, now));
    const mine = new Set(await store.claim(congress, session, picked.map((row) => row.number), now));
    // a failed download is skipped here and tried again by a later visit.
    await mapLimit(picked.filter((row) => mine.has(row.number)), 5, async (row) => {
      const xml = await fetchText(senateFile(congress, session, row.number, 'xml'), { timeout: SENATE_TIMEOUT });
      await store.saveVote(congress, session, parseSenateVote(xml, row.number), row.listMark);
      if (row.fileMark == null) out.added++;
      else out.updated++;
    });
  } catch (e) {
    out.problem = e.message;
  }
  return out;
}

// visitors who arrive together share one round of downloads.
const senateSyncs = new WeakMap();
function sharedSync(congress, session, store, now) {
  if (!senateSyncs.has(store)) senateSyncs.set(store, new Map());
  const jobs = senateSyncs.get(store);
  const key = `${congress}-${session}`;
  if (!jobs.has(key)) jobs.set(key, syncSenate(congress, session, store, now).finally(() => jobs.delete(key)));
  return jobs.get(key);
}

export async function senateVotes(congress, session, state, { store = senateStore(), now = Date.now() } = {}) {
  const sync = await sharedSync(congress, session, store, now);
  const saved = await store.votesFor(congress, session, state);
  // with nothing saved, a refusal from senate.gov is the whole story.
  if (!saved.length && sync.problem) throw new Error(sync.problem);
  const votes = saved.map((v) => {
    const positions = {};
    for (const m of v.members) {
      positions[m.lis] = m.cast;
      positions[`${m.state}:${m.lastName.toLowerCase()}`] = m.cast;
    }
    return {
      chamber: 'senate',
      number: v.number,
      date: v.date,
      question: v.question,
      result: v.result,
      bill: v.bill,
      description: v.title,
      yeas: v.yeas,
      nays: v.nays,
      url: senateFile(congress, session, v.number, 'htm'),
      positions,
    };
  });
  return { votes, ...sync };
}

// Combine roll calls with the members who represent this address.
export function voteItems(votes, members, state) {
  const items = [];
  for (const v of votes) {
    const officials = [];
    for (const m of members) {
      if (m.chamber !== v.chamber) continue;
      const pos = v.chamber === 'house'
        ? v.positions[m.bioguide]
        : v.positions[m.lis] || v.positions[m.bioguide] || v.positions[`${state}:${m.lastName.toLowerCase()}`];
      if (pos) officials.push({ id: m.id, name: m.name, role: m.role, position: pos });
    }
    if (!officials.length) continue;
    items.push({
      id: `fed-vote-${v.chamber}-${v.number}-${v.date?.slice(0, 4)}`,
      level: 'federal',
      kind: 'vote',
      chamber: v.chamber,
      date: v.date,
      title: v.description || v.question,
      billLabel: v.bill,
      question: v.question,
      result: v.result,
      tally: v.yeas != null ? { yes: v.yeas, no: v.nays } : null,
      summary: '',
      officials,
      url: v.url,
      source: v.chamber === 'house' ? 'House Clerk roll call ' + v.number : 'Senate roll call ' + v.number,
    });
  }
  return items;
}
