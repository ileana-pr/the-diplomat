// Local (county) sources, keyed by the county's Census GEOID (state FIPS + county FIPS).
// To add your county: copy the Orange County entry and update the URLs and board members.
export default {
  '51137': {
    name: 'Orange County, Virginia',
    body: 'Board of Supervisors',
    website: 'https://www.orangecountyva.gov/',
    boardPage: 'https://www.orangecountyva.gov/95/Board-of-Supervisors',
    agendasPage: 'https://www.orangecountyva.gov/525/Agendas-Minutes',
    agendaCenter: 'https://www.orangecountyva.gov/AgendaCenter',
    // CivicPlus sites publish RSS for the Agenda Center (ModID=65) and News Flash (ModID=1).
    agendaRss: 'https://www.orangecountyva.gov/RSSFeed.aspx?ModID=65&CID=All-0',
    newsRss: 'https://www.orangecountyva.gov/RSSFeed.aspx?ModID=1&CID=All-newsflash.xml',
    newsPage: 'https://www.orangecountyva.gov/CivicAlerts.aspx',
    // From the county homepage, November 2026. Orange County elects one supervisor per district.
    members: [
      { name: 'J. Jason Capelle', district: 'District One', url: 'https://www.orangecountyva.gov/574/district-one' },
      { name: 'Ed M. Van Hoven', district: 'District Two', title: 'Vice Chairman', url: 'https://www.orangecountyva.gov/575/district-two' },
      { name: 'Keith F. Marshall', district: 'District Three', url: 'https://www.orangecountyva.gov/595/district-three' },
      { name: 'Crystal D. Coleman', district: 'District Four', url: 'https://www.orangecountyva.gov/597/district-four' },
      { name: 'J. Bryan Nicol', district: 'District Five', title: 'Chairman', url: 'https://www.orangecountyva.gov/600/district-five' },
    ],
    districtMap: 'https://www.orangecountyva.gov/574/district-one',
  },
};
