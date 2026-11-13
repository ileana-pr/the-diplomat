// Replaces global fetch with canned responses shaped like the real services. All names and numbers are made up.
const census = {
  result: { addressMatches: [{
    matchedAddress: '100 SAMPLE ST, ORANGE, VA, 22960',
    coordinates: { x: -78.11, y: 38.24 },
    addressComponents: { state: 'VA' },
    geographies: {
      States: [{ STUSAB: 'VA', NAME: 'Virginia', STATE: '51' }],
      Counties: [{ NAME: 'Orange County', GEOID: '51137' }],
      '119th Congressional Districts': [{ BASENAME: '7', NAME: 'Congressional District 7', CD119: '07' }],
      '2024 State Legislative Districts - Upper': [{ BASENAME: '17', NAME: 'State Senate District 17' }],
      '2024 State Legislative Districts - Lower': [{ BASENAME: '62', NAME: 'State House District 62' }],
    },
  }] },
};
const leg = (bioguide, lis, first, last, type, district, party) => ({
  id: { bioguide, lis, wikipedia: `${first} ${last}`, opensecrets: 'N000000000', fec: ['H0VA00000'], govtrack: 400000 },
  name: { first, last, official_full: `${first} ${last}` },
  bio: { birthday: '1970-01-01' },
  terms: [{ type, state: 'VA', district, party, start: '2019-01-03', end: '2027-01-03', url: 'https://example.house.gov', phone: '202-225-0000', address: '1 Capitol Hill' }],
});
const legislators = [
  leg('S000001', 'S001', 'Alex', 'Senatorson', 'sen', undefined, 'Democrat'),
  leg('S000002', 'S002', 'Jordan', 'Upperhouse', 'sen', undefined, 'Democrat'),
  leg('R000007', undefined, 'Casey', 'Districtseven', 'rep', 7, 'Democrat'),
  leg('R000005', undefined, 'Other', 'Person', 'rep', 5, 'Republican'),
];
const houseRoll = (n, vote) => `<?xml version="1.0"?><rollcall-vote><vote-metadata><majority>R</majority><congress>119</congress><session>2nd</session><chamber>U.S. House of Representatives</chamber><rollcall-num>${n}</rollcall-num><legis-num>H R ${1000 + n}</legis-num><vote-question>On Passage</vote-question><vote-type>YEA-AND-NAY</vote-type><vote-result>Passed</vote-result><action-date>${n}-Oct-2026</action-date><vote-desc>Sample Infrastructure Act number ${n}</vote-desc><vote-totals><totals-by-vote><total-stub>Totals</total-stub><yea-total>220</yea-total><nay-total>210</nay-total></totals-by-vote></vote-totals></vote-metadata><vote-data><recorded-vote><legislator name-id="R000007" party="D" state="VA" role="legislator">Districtseven</legislator><vote>${vote}</vote></recorded-vote><recorded-vote><legislator name-id="R000005" party="R" state="VA" role="legislator">Person</legislator><vote>Yea</vote></recorded-vote></vote-data></rollcall-vote>`;
const senateRow = (n, day) => `<vote><vote_number>00${n}</vote_number><vote_date>${day}</vote_date><issue>PN${n}</issue><question>On the Nomination</question><result>Confirmed</result><vote_tally><yeas>47</yeas><nays>41</nays></vote_tally><title>Confirmation of a sample nominee ${n}</title></vote>`;
const senateMenu = `<?xml version="1.0"?><vote_summary><congress>119</congress><session>2</session><congress_year>2026</congress_year><votes>${senateRow(256, '30-Sep')}${senateRow(255, '29-Sep')}</votes></vote_summary>`;
const senateVote = (n) => `<?xml version="1.0"?><roll_call_vote><congress>119</congress><session>2</session><vote_number>${n}</vote_number><vote_date>September ${n - 226}, 2026, 05:30 PM</vote_date><vote_question_text>On the Nomination PN${n}</vote_question_text><vote_result_text>Nomination Confirmed (47-41)</vote_result_text><vote_title>Confirmation of a sample nominee ${n}</vote_title><document><document_name>PN${n}</document_name></document><count><yeas>47</yeas><nays>41</nays></count><members><member><member_full>Senatorson (D-VA)</member_full><last_name>Senatorson</last_name><first_name>Alex</first_name><party>D</party><state>VA</state><vote_cast>Nay</vote_cast><lis_member_id>S001</lis_member_id></member><member><member_full>Upperhouse (D-VA)</member_full><last_name>Upperhouse</last_name><first_name>Jordan</first_name><party>D</party><state>VA</state><vote_cast>Yea</vote_cast><lis_member_id>S002</lis_member_id></member></members></roll_call_vote>`;
const bills = (kind) => ({
  [kind]: [
    { congress: 119, type: 'HR', number: '4321', title: `A sample bill to improve rural broadband (${kind})`, introducedDate: '2026-09-15', latestAction: { actionDate: '2026-09-15', text: 'Referred to the Committee on Energy and Commerce.' }, policyArea: { name: 'Science, Technology, Communications' } },
    { congress: 119, amendmentNumber: '12', introducedDate: '2026-09-01' },
  ],
});
const osPeople = { results: [
  { id: 'ocd-person/aaa', name: 'Pat Statesenator', family_name: 'Statesenator', party: 'Republican', current_role: { title: 'Senator', org_classification: 'upper', district: '17' }, jurisdiction: { classification: 'state' }, image: null, email: 'pat@example.org', openstates_url: 'https://openstates.org/person/pat' },
  { id: 'ocd-person/bbb', name: 'Robin Delegate', family_name: 'Delegate', party: 'Democratic', current_role: { title: 'Delegate', org_classification: 'lower', district: '62' }, jurisdiction: { classification: 'state' }, openstates_url: 'https://openstates.org/person/robin' },
  { id: 'ocd-person/ccc', name: 'Fed Person', jurisdiction: { classification: 'country' } },
] };
const osBills = (url) => url.includes('include=votes')
  ? { results: [{ id: 'ocd-bill/1', identifier: 'HB 100', title: 'Sample bill on school funding', openstates_url: 'https://openstates.org/va/bills/2026/HB100/', votes: [{ id: 'ocd-vote/1', motion_text: 'Third reading', start_date: '2026-03-05', result: 'pass', organization: { name: 'Senate' }, counts: [{ option: 'yes', value: 25 }, { option: 'no', value: 15 }], votes: [{ option: 'yes', voter_name: 'Statesenator', voter: { id: 'ocd-person/aaa' } }] }] }] }
  : { results: [{ id: 'ocd-bill/2', identifier: 'SB 200', title: 'Sample bill on broadband', session: '2026', first_action_date: '2026-01-10', latest_action_date: '2026-03-01', latest_action_description: 'Signed by Governor', openstates_url: 'https://openstates.org/va/bills/2026/SB200/', sponsorships: [{ name: 'X', primary: true, person: { id: url.includes('aaa') ? 'ocd-person/aaa' : 'ocd-person/bbb' } }] }] };
const agendaHtml = `<a href="/AgendaCenter/ViewFile/Agenda/_10282026-1201">Agenda</a><a href="/AgendaCenter/ViewFile/Minutes/_10142026-1190">Minutes</a><a href="/AgendaCenter/ViewFile/Agenda/_10142026-1190">Agenda</a>`;
const newsRss = `<rss><channel><item><title>Public hearing scheduled on the sample zoning amendment</title><link>https://www.orangecountyva.gov/CivicAlerts.aspx?AID=9999</link><pubDate>Mon, 02 Nov 2026 14:00:00 GMT</pubDate><description>&lt;p&gt;The Board of Supervisors will hold a public hearing.&lt;/p&gt;</description></item></channel></rss>`;

export function installMockFetch({ failOpenStates = false, houseIndexMissing = false, blockSenate = false } = {}) {
  const calls = [];
  globalThis.fetch = async (url, opts = {}) => {
    url = String(url);
    calls.push({ url, headers: opts.headers });
    const ok = (body, type = 'application/json') => new Response(typeof body === 'string' ? body : JSON.stringify(body), { status: 200, headers: { 'Content-Type': type } });
    if (url.includes('geocoding.geo.census.gov')) return ok(census);
    if (url.includes('legislators-current.json')) return ok(legislators);
    if (url.includes('/sponsored-legislation')) return ok(bills('sponsoredLegislation'));
    if (url.includes('/cosponsored-legislation')) return ok(bills('cosponsoredLegislation'));
    if (url.includes('clerk.house.gov') && url.endsWith('index.asp')) {
      if (houseIndexMissing) return new Response('missing', { status: 404, statusText: 'Not Found' });
      return ok('<a href="https://clerk.house.gov/cgi-bin/vote.asp?year=2026&rollnumber=3">3</a> rollnumber=2', 'text/html');
    }
    let m = url.match(/roll(\d{3})\.xml$/);
    if (m) {
      const n = +m[1];
      // a missing clerk file is http 200 with this short error, not a 404
      if (houseIndexMissing && n > 5) return ok('<xml>Error sanitizing file</xml>', 'text/xml');
      return ok(houseRoll(n, n % 2 ? 'Nay' : 'Yea'), 'text/xml');
    }
    if (url.includes('vote_menu_')) {
      if (blockSenate) return new Response('blocked', { status: 403, statusText: 'Forbidden' });
      return ok(senateMenu, 'text/xml');
    }
    m = url.match(/vote_\d+_\d_(\d+)\.xml$/);
    if (m) return ok(senateVote(+m[1]), 'text/xml');
    if (url.includes('openstates.org')) {
      if (failOpenStates) return new Response('nope', { status: 401, statusText: 'Unauthorized' });
      if (url.includes('/people.geo')) return ok(osPeople);
      if (url.includes('/bills')) return ok(osBills(url));
    }
    if (url.includes('ModID=65')) return new Response('', { status: 404, statusText: 'Not Found' });
    if (url.endsWith('/AgendaCenter')) return ok(agendaHtml, 'text/html');
    if (url.includes('ModID=1')) return ok(newsRss, 'application/rss+xml');
    return new Response('not mocked', { status: 404, statusText: 'Not Found' });
  };
  return calls;
}
