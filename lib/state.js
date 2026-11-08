import { getJSON } from './http.js';
import { stateLinks } from './research.js';

// State legislature data from Open States / Plural (https://v3.openstates.org).
const API = 'https://v3.openstates.org';

const jurisdictionId = (state) => `ocd-jurisdiction/country:us/state:${state.toLowerCase()}/government`;

function os(path, params, apiKey) {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) (Array.isArray(v) ? v : [v]).forEach((x) => qs.append(k, x));
  return getJSON(`${API}${path}?${qs}`, { headers: { 'X-API-KEY': apiKey }, ttl: 3600 * 1000 });
}

export async function findLegislators(lat, lng, state, apiKey) {
  const data = await os('/people.geo', { lat, lng }, apiKey);
  return (data.results || [])
    .filter((p) => p.jurisdiction?.classification === 'state')
    .map((p) => toOfficial(p, state));
}

export function toOfficial(p, state) {
  const upper = p.current_role?.org_classification === 'upper';
  const roleTitle = p.current_role?.title || (upper ? 'Senator' : 'Representative');
  const stateWord = state === 'VA' ? 'Virginia' : state;
  return {
    id: p.id,
    level: 'state',
    name: p.name,
    lastName: p.family_name || p.name.split(' ').pop(),
    role: upper ? `${stateWord} State Senator` : `${stateWord} ${roleTitle === 'Delegate' ? 'Delegate' : 'State ' + roleTitle}`,
    chamber: upper ? 'upper' : 'lower',
    district: `${upper ? 'Senate' : 'House'} District ${p.current_role?.district}`,
    party: (p.party || '')[0],
    partyName: p.party,
    photo: p.image || null,
    email: p.email,
    website: p.openstates_url,
    links: stateLinks(p.name, state, p.openstates_url),
  };
}

export function placeholderLegislators(geo) {
  const out = [];
  const st = geo.state === 'VA' ? 'Virginia' : geo.state;
  if (geo.stateSenateDistrict != null)
    out.push({ id: 'state-upper', level: 'state', name: `${st} Senate District ${geo.stateSenateDistrict}`, role: 'State Senator', placeholder: true, links: whoIsLinks(geo) });
  if (geo.stateHouseDistrict != null)
    out.push({ id: 'state-lower', level: 'state', name: `${geo.state === 'VA' ? 'House of Delegates' : 'State House'} District ${geo.stateHouseDistrict}`, role: geo.state === 'VA' ? 'Delegate' : 'State Representative', placeholder: true, links: whoIsLinks(geo) });
  return out;
}

function whoIsLinks(geo) {
  return geo.state === 'VA'
    ? [{ label: "Who's my legislator (Virginia)", url: 'https://whosmy.virginiageneralassembly.gov/' }]
    : [{ label: 'Find my legislators', url: 'https://openstates.org/find_your_legislator/' }];
}

// Bills each legislator sponsored, plus recent floor votes they cast.
export async function stateActivity(legislators, state, apiKey) {
  const jur = jurisdictionId(state);
  const items = [];
  const errors = [];
  for (const leg of legislators) {
    try {
      const data = await os('/bills', { jurisdiction: jur, sponsor: leg.id, sort: 'updated_desc', per_page: 15, include: ['sponsorships'] }, apiKey);
      items.push(...sponsoredItems(data.results || [], leg));
    } catch (e) {
      errors.push(e.message);
    }
  }
  try {
    const data = await os('/bills', { jurisdiction: jur, sort: 'latest_action_desc', per_page: 20, include: ['votes'] }, apiKey);
    items.push(...voteItems(data.results || [], legislators));
  } catch (e) {
    errors.push(e.message);
  }
  if (errors.length && !items.length) throw new Error(errors[0]);
  return items;
}

export function sponsoredItems(bills, leg) {
  return bills.map((b) => {
    const mine = (b.sponsorships || []).find((s) => s.person?.id === leg.id);
    const primary = mine ? mine.primary || mine.classification === 'primary' : true;
    return {
      id: `state-${primary ? 'sponsored' : 'cosponsored'}-${leg.id}-${b.id}`,
      level: 'state',
      kind: primary ? 'sponsored' : 'cosponsored',
      date: (b.first_action_date || b.created_at || b.latest_action_date || '').slice(0, 10) + 'T12:00:00Z',
      title: b.title,
      billLabel: b.identifier,
      summary: b.latest_action_description ? `Latest action (${(b.latest_action_date || '').slice(0, 10)}): ${b.latest_action_description}` : '',
      topic: (b.subject || [])[0],
      officials: [{ id: leg.id, name: leg.name, role: leg.role }],
      url: b.openstates_url,
      source: `Open States · ${b.session} session`,
    };
  });
}

export function voteItems(bills, legislators) {
  const items = [];
  for (const b of bills) {
    for (const v of b.votes || []) {
      const officials = [];
      for (const leg of legislators) {
        const cast = (v.votes || []).find(
          (x) => x.voter?.id === leg.id || (!x.voter?.id && x.voter_name && x.voter_name.toLowerCase().includes(leg.lastName.toLowerCase())),
        );
        if (cast) officials.push({ id: leg.id, name: leg.name, role: leg.role, position: cap(cast.option) });
      }
      if (!officials.length) continue;
      const yes = (v.counts || []).find((c) => c.option === 'yes')?.value;
      const no = (v.counts || []).find((c) => c.option === 'no')?.value;
      items.push({
        id: `state-vote-${v.id}`,
        level: 'state',
        kind: 'vote',
        date: v.start_date?.length === 10 ? v.start_date + 'T12:00:00Z' : v.start_date,
        title: b.title,
        billLabel: b.identifier,
        question: v.motion_text,
        result: cap(v.result),
        tally: yes != null ? { yes, no } : null,
        summary: '',
        officials,
        url: b.openstates_url,
        source: `Open States · ${v.organization?.name || ''}`.replace(/ · $/, ''),
      });
    }
  }
  return items;
}

const cap = (s = '') => {
  const m = { yes: 'Yea', no: 'Nay', 'not voting': 'Not voting', absent: 'Absent', pass: 'Passed', fail: 'Failed' };
  return m[s.toLowerCase()] || s.charAt(0).toUpperCase() + s.slice(1);
};
