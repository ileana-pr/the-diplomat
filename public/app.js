const $ = (s) => document.querySelector(s);
const esc = (s = '') => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch {} },
};

const state = { data: null, level: 'all', kind: 'all', person: null, shown: 30 };
const LEVEL_LABEL = { federal: 'Federal', state: 'State', county: 'County' };
const KIND_LABEL = { vote: 'Vote', sponsored: 'Sponsored a bill', cosponsored: 'Co-sponsored a bill', meeting: 'Meeting agenda', minutes: 'Meeting minutes', news: 'County news' };
const PARTY = { Democrat: 'D', Democratic: 'D', Republican: 'R', Independent: 'I' };

function show(id) {
  for (const s of ['welcome', 'loading', 'error', 'results']) $('#' + s).hidden = s !== id && !(id === 'error' && s === 'welcome');
}

async function load(address) {
  show('loading');
  history.replaceState(null, '', '?address=' + encodeURIComponent(address));
  try {
    const res = await fetch('/api/feed?address=' + encodeURIComponent(address));
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Something went wrong.');
    store.set('diplomat:address', address);
    state.data = data;
    state.person = null;
    state.shown = 30;
    render();
    show('results');
  } catch (e) {
    $('#error').textContent = e.message;
    show('error');
  }
}

function render() {
  const { location: g, officials, county } = state.data;
  const pills = [
    g.congressionalDistrictName || (g.congressionalDistrict != null && `Congressional District ${g.congressionalDistrict}`),
    g.stateSenateDistrictName || (g.stateSenateDistrict != null && `State Senate District ${g.stateSenateDistrict}`),
    g.stateHouseDistrictName || (g.stateHouseDistrict != null && `State House District ${g.stateHouseDistrict}`),
    g.county,
  ].filter(Boolean);
  $('#location').innerHTML = `
    <h1>Your feed for ${esc(titleCase(g.matchedAddress))}</h1>
    <div class="districts">${pills.map((p) => `<span class="pill">${esc(p)}</span>`).join('')}</div>`;

  $('#reps').innerHTML = [
    repGroup('federal', 'Congress', officials.federal),
    repGroup('state', g.state === 'VA' ? 'Virginia General Assembly' : 'State legislature', officials.state),
    repGroup('county', countyTitle(county), officials.county, county),
  ].join('');
  renderFeed();
  renderSources();
}

function countyTitle(county) {
  if (!county?.name) return 'County';
  const place = county.name.split(',')[0];
  return county.body ? `${place} ${county.body}` : place;
}

function repGroup(level, title, list, county) {
  let body = list.map(repCard).join('');
  if (level === 'county' && !list.length) {
    body = county
      ? `<p class="placeholder-note">Board members aren't listed for this county yet.</p>`
      : `<p class="placeholder-note">This county isn't in the list yet.</p>`;
  }
  if (level === 'county' && county && (county.boardPage || county.agendasPage)) {
    const links = [];
    if (county.boardPage) links.push(`<a href="${esc(county.boardPage)}" target="_blank" rel="noopener">Board page</a>`);
    if (county.agendasPage) links.push(`<a href="${esc(county.agendasPage)}" target="_blank" rel="noopener">Agendas &amp; minutes</a>`);
    body += `<p class="placeholder-note">${links.join(' · ')}</p>`;
  }
  return `<div class="rep-group"><h3><span class="dot ${level}"></span>${esc(title)}</h3>${body}</div>`;
}

function repCard(o) {
  const party = o.party ? PARTY[o.party] || o.party[0] : '';
  const initials = o.name.split(/\s+/).filter((w) => /^[A-Z]/.test(w)).map((w) => w[0]).slice(0, 2).join('');
  const avatar = o.photo
    ? `<img class="avatar" src="${esc(o.photo)}" alt="" loading="lazy" data-initials="${esc(initials)}">`
    : `<span class="avatar">${esc(initials)}</span>`;
  const facts = [
    o.district && ['District', o.district],
    o.firstElected && ['In office since', o.firstElected],
    o.termEnd && ['Term ends', new Date(o.termEnd).getFullYear()],
    o.phone && ['Phone', `<a href="tel:${esc(o.phone)}">${esc(o.phone)}</a>`],
    o.email && ['Email', `<a href="mailto:${esc(o.email)}">${esc(o.email)}</a>`],
    o.office && ['Office', esc(o.office)],
    o.website && ['Website', `<a href="${esc(o.website)}" target="_blank" rel="noopener">${esc(o.website.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, ''))}</a>`],
  ].filter(Boolean);
  return `<details class="rep">
    <summary>${avatar}<div class="who"><div class="name">${esc(o.name)}${party ? `<span class="party ${esc(party)}">${esc(party)}</span>` : ''}</div><div class="role">${esc(o.role)}</div></div></summary>
    <div class="rep-body">
      ${o.placeholder ? `<p class="placeholder-note">Add a free Open States API key to see who this is, plus their bills and votes.</p>` : ''}
      ${facts.length ? `<dl>${facts.map(([k, v]) => `<dt>${k}</dt><dd>${typeof v === 'string' && v.startsWith('<') ? v : esc(v)}</dd>`).join('')}</dl>` : ''}
      <div class="links">${(o.links || []).map((l) => `<a href="${esc(l.url)}" target="_blank" rel="noopener">${esc(l.label)}</a>`).join('')}</div>
      ${o.placeholder ? '' : `<button class="linkish" data-person="${esc(o.id)}" data-name="${esc(o.name)}">Show only ${esc(o.name.split(' ').slice(-1)[0])}'s activity</button>`}
    </div>
  </details>`;
}

function matches(item) {
  if (state.level !== 'all' && item.level !== state.level) return false;
  if (state.kind === 'vote' && item.kind !== 'vote') return false;
  if (state.kind === 'bill' && !['sponsored', 'cosponsored'].includes(item.kind)) return false;
  if (state.kind === 'local' && !['meeting', 'minutes', 'news'].includes(item.kind)) return false;
  if (state.person && !item.officials.some((o) => o.id === state.person.id)) return false;
  return true;
}

function renderFeed() {
  const items = state.data.feed.filter(matches);
  const pf = $('#person-filter');
  pf.hidden = !state.person;
  if (state.person) pf.innerHTML = `Showing activity for <b>${esc(state.person.name)}</b>. <button class="linkish" id="clear-person">Show everyone</button>`;
  if (!items.length) {
    $('#feed').innerHTML = `<li class="empty">Nothing here yet for this filter. Some sources may need an API key; see “Data sources” below.</li>`;
    return;
  }
  $('#feed').innerHTML = items.slice(0, state.shown).map(card).join('') +
    (items.length > state.shown ? `<li><button class="btn more" id="more">Show more (${items.length - state.shown} left)</button></li>` : '');
}

function card(i) {
  const date = new Date(i.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
  const who = i.kind === 'vote'
    ? `<div class="positions">${i.officials.map((o) => `<span class="pos"><b class="${esc((o.position || '').split(' ')[0])}">${esc(o.position)}</b>${esc(o.name)}</span>`).join('')}</div>`
    : i.level === 'county' ? '' : `<div class="positions">${i.officials.map((o) => `<span class="pos"><b>${esc(o.position || 'Sponsor')}</b>${esc(o.name)}</span>`).join('')}</div>`;
  const result = i.kind === 'vote' && (i.question || i.result)
    ? `<p class="result">${esc(i.question || '')}${i.result ? ` · <b>${esc(i.result)}</b>` : ''}${i.tally && !/\d/.test(i.result || '') ? ` (${i.tally.yes}–${i.tally.no})` : ''}</p>` : '';
  return `<li class="card ${i.level}">
    <div class="card-meta"><span class="tag ${i.level}">${LEVEL_LABEL[i.level]}</span><span>${esc(KIND_LABEL[i.kind] || i.kind)}</span><span>${date}</span>${i.topic ? `<span>${esc(i.topic)}</span>` : ''}</div>
    <h3>${i.billLabel ? `<span class="bill">${esc(i.billLabel)}</span> ` : ''}<a href="${esc(i.url)}" target="_blank" rel="noopener">${esc(i.title)}</a></h3>
    ${result}
    ${i.summary ? `<p>${esc(i.summary)}</p>` : ''}
    ${who}
    <div class="card-meta" style="margin:8px 0 0">Source: ${esc(i.source)}</div>
  </li>`;
}

function renderSources() {
  const s = state.data.sources;
  const bad = s.filter((x) => !x.ok).length;
  $('#sources').innerHTML = `<summary>Data sources${bad ? ` (${bad} need attention)` : ''}</summary>
    <ul>${s.map((x) => `<li class="${x.ok ? '' : 'bad'}">${x.ok ? '✓' : '!'} <b>${esc(x.name)}</b>: ${esc(x.detail || '')}</li>`).join('')}</ul>
    <p>Updated ${new Date(state.data.generatedAt).toLocaleString()}</p>`;
  if (bad) $('#sources').open = true;
}

function titleCase(s = '') {
  return s.toLowerCase().replace(/\b([a-z])/g, (m) => m.toUpperCase()).replace(/\b(Va|Nc|Md|Dc)\b/g, (m) => m.toUpperCase());
}

// ---- Events ----
// Swap a photo that fails to load for the person's initials.
document.addEventListener('error', (e) => {
  const img = e.target;
  if (img.tagName === 'IMG' && img.dataset.initials !== undefined) {
    const span = document.createElement('span');
    span.className = 'avatar';
    span.textContent = img.dataset.initials;
    img.replaceWith(span);
  }
}, true);
$('#addr-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const a = $('#address').value.trim();
  if (a) load(a);
});
document.addEventListener('click', (e) => {
  const chip = e.target.closest('.chip');
  if (chip) {
    const group = chip.parentElement.dataset.group;
    chip.parentElement.querySelectorAll('.chip').forEach((c) => c.classList.toggle('on', c === chip));
    state[group] = chip.dataset.value;
    state.shown = 30;
    return renderFeed();
  }
  const p = e.target.closest('[data-person]');
  if (p) {
    state.person = { id: p.dataset.person, name: p.dataset.name };
    state.shown = 30;
    renderFeed();
    return $('.feed-col').scrollIntoView({ behavior: 'smooth' });
  }
  if (e.target.id === 'clear-person') { state.person = null; return renderFeed(); }
  if (e.target.id === 'more') { state.shown += 30; return renderFeed(); }
});

const initial = new URLSearchParams(location.search).get('address') || store.get('diplomat:address');
if (initial) { $('#address').value = initial; load(initial); }
