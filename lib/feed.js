import { lookupAddress } from './geo.js';
import * as federal from './federal.js';
import * as stateLeg from './state.js';
import * as county from './county.js';

// Builds the whole personalized feed for one address.
export async function buildFeed(address, env = process.env) {
  const geo = await lookupAddress(address);
  if (!geo) {
    const err = new Error("We couldn't match that address. Try your full street address with city, state and ZIP.");
    err.status = 404;
    throw err;
  }

  const sources = []; // status of each data source, shown in the UI
  const note = (name, ok, detail) => sources.push({ name, ok, detail });
  const { congress, session, year } = federal.currentCongress();

  // ---- Federal ----
  let fedMembers = [];
  let fedItems = [];
  try {
    fedMembers = await federal.findMembers(geo.state, geo.congressionalDistrict);
    note('Congress members', true, `${fedMembers.length} found`);
  } catch (e) {
    note('Congress members', false, e.message);
  }

  const fedTasks = [
    (async () => {
      const results = await Promise.allSettled(fedMembers.map((m) => federal.sponsorships(m, env.CONGRESS_API_KEY)));
      const ok = results.filter((r) => r.status === 'fulfilled');
      ok.forEach((r) => fedItems.push(...r.value));
      if (fedMembers.length) note('Congress.gov bills', ok.length > 0, ok.length ? (env.CONGRESS_API_KEY ? 'OK' : 'OK (using the shared DEMO_KEY, add your own key)') : results[0]?.reason?.message);
    })(),
    (async () => {
      try {
        let votes = await federal.houseVotes(year);
        if (!votes.length) votes = await federal.houseVotes(year - 1);
        fedItems.push(...federal.voteItems(votes, fedMembers, geo.state));
        note('House votes', true, `${votes.length} recent roll calls checked`);
      } catch (e) {
        note('House votes', false, e.message);
      }
    })(),
    (async () => {
      try {
        let votes = await federal.senateVotes(congress, session);
        if (!votes.length && session === 1) votes = await federal.senateVotes(congress - 1, 2);
        fedItems.push(...federal.voteItems(votes, fedMembers, geo.state));
        const savedWhen = votes.savedAt
          ? ` (saved ${new Date(votes.savedAt).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })})`
          : '';
        const have = votes.total && votes.total !== votes.length ? `${votes.length} of ${votes.total}` : `${votes.length}`;
        note('Senate votes', true, votes.via === 'Voteview'
          ? `${votes.length} recent roll calls (Voteview; saved Senate files were not ready)`
          : votes.via === 'senate.gov'
            ? `${have} roll calls from saved Senate files${savedWhen}`
            : `${votes.length} recent roll calls checked`);
      } catch (e) {
        note('Senate votes', false, e.message);
      }
    })(),
  ];

  // ---- State ----
  let stateMembers = [];
  let stateItems = [];
  const stateTask = (async () => {
    if (!env.OPENSTATES_API_KEY) {
      stateMembers = stateLeg.placeholderLegislators(geo);
      note('State legislature', false, 'Add a free Open States key to see your state legislators and their bills and votes');
      return;
    }
    try {
      stateMembers = await stateLeg.findLegislators(geo.lat, geo.lng, geo.state, env.OPENSTATES_API_KEY);
      note('State legislators', true, `${stateMembers.length} found`);
      stateItems = await stateLeg.stateActivity(stateMembers, geo.state, env.OPENSTATES_API_KEY);
      note('State bills & votes', true, `${stateItems.length} items`);
    } catch (e) {
      if (!stateMembers.length) stateMembers = stateLeg.placeholderLegislators(geo);
      note('State legislature', false, e.message);
    }
  })();

  // ---- County ----
  let countyMembers = [];
  let countyItems = [];
  let countyInfo = null;
  const countyTask = (async () => {
    const cfg = county.countyConfig(geo.countyGeoid);
    if (!cfg) {
      note('County', false, `${geo.county || 'Your county'} isn't set up yet. Add it in config/counties.js.`);
      return;
    }
    countyInfo = { name: cfg.name, body: cfg.body, boardPage: cfg.boardPage, agendasPage: cfg.agendasPage, website: cfg.website };
    countyMembers = county.countyOfficials(cfg, geo.state);
    const { items, errors } = await county.countyFeed(cfg);
    countyItems = items;
    note('County agendas & news', items.length > 0, errors.length ? errors.join('; ') : `${items.length} items`);
  })();

  await Promise.all([...fedTasks, stateTask, countyTask]);

  const feed = [...fedItems, ...stateItems, ...countyItems]
    .filter((i) => i.date && !Number.isNaN(Date.parse(i.date)))
    .sort((a, b) => b.date.localeCompare(a.date));
  const unique = mergeBills(feed);

  return {
    location: geo,
    county: countyInfo,
    officials: { federal: fedMembers, state: stateMembers, county: countyMembers },
    feed: unique,
    sources,
    generatedAt: new Date().toISOString(),
  };
}

// One card per bill: when several of your officials sponsor or co-sponsor the same bill, list them all on it.
export function mergeBills(items) {
  const out = [];
  const byBill = new Map();
  const seen = new Set();
  for (const item of items) {
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    if (item.kind !== 'sponsored' && item.kind !== 'cosponsored') {
      out.push(item);
      continue;
    }
    const key = `${item.level}|${item.url}|${item.billLabel}`;
    const officials = item.officials.map((o) => ({ ...o, position: item.kind === 'sponsored' ? 'Sponsor' : 'Co-sponsor' }));
    const existing = byBill.get(key);
    if (!existing) {
      const copy = { ...item, officials };
      byBill.set(key, copy);
      out.push(copy);
      continue;
    }
    for (const o of officials) if (!existing.officials.some((x) => x.id === o.id)) existing.officials.push(o);
    if (item.kind === 'sponsored') existing.kind = 'sponsored';
    existing.officials.sort((a, b) => (a.position === b.position ? 0 : a.position === 'Sponsor' ? -1 : 1));
  }
  return out;
}
