// Tiny regex-based helpers for the simple, flat XML the House, Senate and RSS feeds publish.
const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
export function decode(s = '') {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)))
    .replace(/&(\w+);/g, (m, n) => ENT[n] ?? m)
    .replace(/\s+/g, ' ')
    .trim();
}
export function tag(xml, name) {
  const m = xml.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, 'i'));
  return m ? decode(m[1]) : '';
}
export function blocks(xml, name) {
  return [...xml.matchAll(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, 'gi'))].map((m) => m[0]);
}
export function attr(xmlTag, name) {
  const m = xmlTag.match(new RegExp(`${name}="([^"]*)"`, 'i'));
  return m ? decode(m[1]) : '';
}
export function stripHtml(s = '') {
  return decode(s.replace(/<[^>]+>/g, ' '));
}
const MONTHS = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };
// "30-Apr-2026" -> ISO date
export function parseDMY(s) {
  const m = s.match(/(\d{1,2})-([A-Za-z]{3})-(\d{4})/);
  if (!m) return null;
  return new Date(Date.UTC(+m[3], MONTHS[m[2].toLowerCase()], +m[1], 12)).toISOString();
}
// "September 30, 2026, 05:30 PM" -> ISO date
export function parseLongDate(s) {
  const m = s.match(/([A-Za-z]+) (\d{1,2}), (\d{4})/);
  if (!m) return null;
  return new Date(Date.UTC(+m[3], MONTHS[m[1].slice(0, 3).toLowerCase()], +m[2], 12)).toISOString();
}
