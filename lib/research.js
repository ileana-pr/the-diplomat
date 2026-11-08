// Background-research links for each official.
const enc = encodeURIComponent;
const wiki = (title) => `https://en.wikipedia.org/wiki/${enc(title.replace(/ /g, '_'))}`;
const ballotpedia = (name) => `https://ballotpedia.org/${enc(name.replace(/ /g, '_'))}`;
const news = (q) => `https://news.google.com/search?q=${enc(q)}`;

export function federalLinks(leg) {
  const id = leg.id || {};
  const name = leg.name?.official_full || `${leg.name?.first} ${leg.name?.last}`;
  const links = [];
  if (id.bioguide) links.push({ label: 'Congress.gov profile', url: `https://www.congress.gov/member/${enc(name.toLowerCase().replace(/[^a-z]+/g, '-'))}/${id.bioguide}` });
  if (id.wikipedia) links.push({ label: 'Wikipedia', url: wiki(id.wikipedia) });
  links.push({ label: 'Ballotpedia', url: id.ballotpedia ? ballotpedia(id.ballotpedia) : ballotpedia(name) });
  if (id.opensecrets) links.push({ label: 'Campaign money (OpenSecrets)', url: `https://www.opensecrets.org/members-of-congress/summary?cid=${id.opensecrets}` });
  if (id.fec?.length) links.push({ label: 'FEC filings', url: `https://www.fec.gov/data/candidate/${id.fec[id.fec.length - 1]}/` });
  if (id.govtrack) links.push({ label: 'GovTrack report card', url: `https://www.govtrack.us/congress/members/${id.govtrack}` });
  if (id.votesmart) links.push({ label: 'Vote Smart', url: `https://justfacts.votesmart.org/candidate/${id.votesmart}` });
  links.push({ label: 'In the news', url: news(`"${name}"`) });
  return links;
}

export function stateLinks(name, state, openstatesUrl) {
  const links = [];
  if (openstatesUrl) links.push({ label: 'Open States profile', url: openstatesUrl });
  links.push({ label: 'Ballotpedia', url: ballotpedia(name) });
  if (state === 'VA') links.push({ label: 'Campaign money (VPAP)', url: `https://www.vpap.org/search/?q=${enc(name)}` });
  links.push({ label: 'Wikipedia search', url: `https://en.wikipedia.org/w/index.php?search=${enc(name + ' politician')}` });
  links.push({ label: 'In the news', url: news(`"${name}"`) });
  return links;
}

export function localLinks(name, county, state) {
  return [
    { label: 'Ballotpedia search', url: `https://ballotpedia.org/wiki/index.php?search=${enc(name)}` },
    ...(state === 'VA' ? [{ label: 'Campaign money (VPAP)', url: `https://www.vpap.org/search/?q=${enc(name)}` }] : []),
    { label: 'In the news', url: news(`"${name}" ${county}`) },
  ];
}
