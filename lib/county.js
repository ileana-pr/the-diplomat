import { getText } from './http.js';
import { tag, blocks, stripHtml } from './xml.js';
import { localLinks } from './research.js';
import COUNTIES from '../config/counties.js';

export function countyConfig(geoid) {
  return COUNTIES[geoid] || null;
}

export function countyOfficials(cfg, state) {
  return cfg.members.map((m, i) => ({
    id: `county-${i}`,
    level: 'county',
    name: m.name,
    role: `Supervisor, ${m.district}${m.title ? ` (${m.title})` : ''}`,
    district: m.district,
    website: m.url,
    links: [{ label: 'County bio', url: m.url }, ...localLinks(m.name, cfg.name, state)],
  }));
}

export async function countyFeed(cfg) {
  const items = [];
  const errors = [];
  try {
    items.push(...(await agendaItems(cfg)));
  } catch (e) {
    errors.push(`Agendas: ${e.message}`);
  }
  try {
    items.push(...(await newsItems(cfg)));
  } catch (e) {
    errors.push(`News: ${e.message}`);
  }
  return { items, errors };
}

function boardOfficial(cfg) {
  return [{ id: 'county-board', name: cfg.body, role: cfg.name }];
}

export function parseRss(xml) {
  return blocks(xml, 'item').map((it) => ({
    title: tag(it, 'title'),
    link: tag(it, 'link'),
    date: tag(it, 'pubDate') ? new Date(tag(it, 'pubDate')).toISOString() : null,
    category: tag(it, 'category'),
    description: stripHtml(tag(it, 'description')).slice(0, 400),
  }));
}

async function agendaItems(cfg) {
  let rows = [];
  try {
    rows = parseRss(await getText(cfg.agendaRss, { ttl: 3600 * 1000 }));
  } catch {
    rows = [];
  }
  if (!rows.length) rows = parseAgendaCenter(await getText(cfg.agendaCenter, { ttl: 3600 * 1000 }), cfg.agendaCenter);
  return rows
    .filter((r) => !r.category || /supervisor|board/i.test(r.category + ' ' + r.title))
    .slice(0, 15)
    .map((r) => ({
      id: `county-agenda-${r.link}`,
      level: 'county',
      kind: /minute/i.test(r.title + r.link) ? 'minutes' : 'meeting',
      date: r.date,
      title: r.title,
      summary: r.description || '',
      officials: boardOfficial(cfg),
      url: r.link,
      source: `${cfg.name} Agenda Center`,
    }));
}

// Fallback: read agenda/minutes links straight from the CivicPlus Agenda Center page.
export function parseAgendaCenter(html, base) {
  const seen = new Map();
  for (const m of html.matchAll(/href="([^"]*\/AgendaCenter\/ViewFile\/(Agenda|Minutes)\/_(\d{2})(\d{2})(\d{4})-(\d+)[^"]*)"/gi)) {
    const [, href, type, mm, dd, yyyy] = m;
    const link = new URL(href.replace(/&amp;/g, '&'), base).toString();
    if (seen.has(link)) continue;
    const date = new Date(Date.UTC(+yyyy, +mm - 1, +dd, 12)).toISOString();
    seen.set(link, {
      title: `Board of Supervisors ${type === 'Minutes' ? 'minutes' : 'meeting agenda'}, ${new Date(date).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' })}`,
      link,
      date,
      category: '',
      description: '',
    });
  }
  return [...seen.values()].sort((a, b) => b.date.localeCompare(a.date));
}

async function newsItems(cfg) {
  const rows = parseRss(await getText(cfg.newsRss, { ttl: 3600 * 1000 }));
  return rows.slice(0, 12).map((r) => ({
    id: `county-news-${r.link}`,
    level: 'county',
    kind: 'news',
    date: r.date,
    title: r.title,
    summary: r.description,
    officials: [{ id: 'county-gov', name: cfg.name, role: 'County government' }],
    url: r.link,
    source: `${cfg.name} News Flash`,
  }));
}
