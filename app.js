import { SERVICES, detect, parseYouTube, cleanTitle, rank, confidence } from './match.js';

const $ = sel => document.querySelector(sel);
const store = {
  get: (k, d) => { try { return localStorage.getItem('sb.' + k) || d; } catch { return d; } },
  set: (k, v) => { try { localStorage.setItem('sb.' + k, v); } catch { /* private mode */ } },
};

const guessCountry = () => ((navigator.language || 'en-IN').split('-')[1] || 'IN').toLowerCase();
const state = { dest: store.get('dest', 'apple'), country: store.get('country', guessCountry()) };

class UserError extends Error {}

async function getJSON(url) {
  const res = await fetch(url);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(body.error || `Request failed (${res.status})`);
    err.status = res.status;
    throw err;
  }
  return body;
}

// ---------- 1. Read the song behind the pasted link ----------

async function readSource(link) {
  let d = detect(link);
  if (!d) throw new UserError('Paste a song link from Spotify, Apple Music or YouTube Music.');
  if (d.unsupported) throw new UserError(`This link is not a single song: ${d.unsupported}.`);

  if (d.shortLink) {
    const { url } = await getJSON('/api/spotify?expand=' + encodeURIComponent(d.shortLink));
    d = detect(url);
  }

  if (d.service === 'apple') {
    const body = await getJSON(`https://itunes.apple.com/lookup?id=${d.id}&country=${d.country}&entity=song`);
    const t = (body.results || []).find(r => r.wrapperType === 'track');
    if (!t) throw new UserError('Apple Music did not find this song in that region.');
    return { service: 'apple', title: t.trackName, artist: t.artistName, durationMs: t.trackTimeMillis, art: t.artworkUrl100, url: link };
  }

  if (d.service === 'spotify') {
    try {
      const t = await getJSON(`/api/spotify?track=${d.id}&market=${state.country}`);
      return { service: 'spotify', ...t };
    } catch (err) {
      if (err.status !== 503) throw err;
      // Spotify keys not set up: the public embed API gives the title only.
      const o = await getJSON('https://open.spotify.com/oembed?url=' + encodeURIComponent(`https://open.spotify.com/track/${d.id}`));
      return { service: 'spotify', title: o.title, artist: '', art: o.thumbnail_url, url: link };
    }
  }

  // YouTube Music
  const o = await getJSON('https://www.youtube.com/oembed?format=json&url=' + encodeURIComponent(`https://www.youtube.com/watch?v=${d.id}`));
  return { service: 'youtube', ...parseYouTube(o.title, o.author_name), art: o.thumbnail_url, url: link };
}

// ---------- 2. Find the same song on the destination ----------

const searchUrl = {
  apple: q => `https://music.apple.com/${state.country}/search?term=${encodeURIComponent(q)}`,
  spotify: q => `https://open.spotify.com/search/${encodeURIComponent(q)}`,
  youtube: q => `https://music.youtube.com/search?q=${encodeURIComponent(q)}`,
};

async function search(dest, q) {
  if (dest === 'apple') {
    const body = await getJSON(`https://itunes.apple.com/search?entity=song&limit=10&country=${state.country}&term=${encodeURIComponent(q)}`);
    return (body.results || []).map(t => ({
      title: t.trackName, artist: t.artistName, durationMs: t.trackTimeMillis,
      art: t.artworkUrl100, url: String(t.trackViewUrl).replace(/[?&]uo=\d+/, ''),
    }));
  }
  if (dest === 'spotify') {
    return (await getJSON(`/api/spotify?q=${encodeURIComponent(q)}&market=${state.country}`)).items;
  }
  const { items } = await getJSON('/api/youtube?q=' + encodeURIComponent(q));
  // YouTube titles look like "Artist - Song (Official Video)": compare on the parsed parts.
  return items.map(it => ({ ...it, ...parseYouTube(it.title, it.artist), shownTitle: it.title }));
}

async function findOn(dest, src) {
  if (src.service === dest) return { best: { ...src, score: 1 }, others: [] };
  const q = `${src.artist} ${cleanTitle(src.title)}`.trim();
  try {
    const ranked = rank(src, await search(dest, q));
    if (!ranked.length) return { fallback: searchUrl[dest](q), reason: 'No match found.' };
    return { best: ranked[0], others: ranked.slice(1, 4) };
  } catch (err) {
    if (err.status === 503 || err.status === 429) {
      return { fallback: searchUrl[dest](q), reason: `Direct ${SERVICES[dest]} search is not set up, or today's free quota is used.` };
    }
    throw err;
  }
}

// ---------- 3. Show the result ----------

function setBusy(on, text = '') {
  $('#convert').disabled = on;
  $('#status').textContent = text;
}

function el(tag, attrs = {}, text) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  if (text !== undefined) node.textContent = text;
  return node;
}

function actions(url) {
  const row = el('div', { class: 'actions' });
  const copy = el('button', { type: 'button', class: 'primary' }, 'Copy link');
  copy.onclick = async () => {
    try { await navigator.clipboard.writeText(url); copy.textContent = 'Copied'; }
    catch { prompt('Copy this link:', url); }
    setTimeout(() => { copy.textContent = 'Copy link'; }, 1500);
  };
  row.append(copy);
  if (navigator.share) {
    const share = el('button', { type: 'button' }, 'Share');
    share.onclick = () => navigator.share({ url }).catch(() => {});
    row.append(share);
  }
  row.append(el('a', { href: url, target: '_blank', rel: 'noopener', class: 'button' }, 'Open'));
  return row;
}

function songCard(song, dest) {
  const card = el('div', { class: 'song' });
  if (song.art) card.append(el('img', { src: song.art, alt: '', width: '72', height: '72', loading: 'lazy' }));
  const text = el('div', { class: 'meta' });
  text.append(el('p', { class: 'title' }, song.shownTitle || song.title));
  text.append(el('p', { class: 'artist' }, song.artist || 'Unknown artist'));
  const level = confidence(song.score);
  text.append(el('p', { class: `badge ${level}` }, `${SERVICES[dest]} · ${level} match`));
  card.append(text);
  return card;
}

function render(src, dest, found) {
  const out = $('#result');
  out.replaceChildren();
  out.append(el('p', { class: 'from' }, `From ${SERVICES[src.service]}: ${src.title}${src.artist ? ' · ' + src.artist : ''}`));

  if (found.fallback) {
    out.append(el('p', { class: 'note' }, `${found.reason} This link opens a ${SERVICES[dest]} search for the song.`));
    out.append(actions(found.fallback));
    return;
  }

  out.append(songCard(found.best, dest), actions(found.best.url));
  if (confidence(found.best.score) === 'low') {
    out.append(el('p', { class: 'note' }, 'Low match. Check that this is the right version before you share it.'));
  }
  if (found.others.length) {
    const more = el('details', { class: 'others' });
    more.append(el('summary', {}, 'Not the right one?'));
    for (const song of found.others) {
      const pick = el('button', { type: 'button', class: 'other' }, `${song.shownTitle || song.title} · ${song.artist}`);
      pick.onclick = () => render(src, dest, { best: song, others: found.others.filter(s => s !== song).concat(found.best) });
      more.append(pick);
    }
    out.append(more);
  }
}

async function convert() {
  const link = $('#link').value.trim();
  if (!link) return;
  setBusy(true, 'Finding the song…');
  $('#result').replaceChildren();
  try {
    const src = await readSource(link);
    setBusy(true, `Searching ${SERVICES[state.dest]}…`);
    render(src, state.dest, await findOn(state.dest, src));
    setBusy(false);
  } catch (err) {
    setBusy(false, err instanceof UserError ? err.message : `Something went wrong: ${err.message}`);
  }
}

// ---------- Wiring ----------

function init() {
  for (const input of document.querySelectorAll('input[name="dest"]')) {
    input.checked = input.value === state.dest;
    input.onchange = () => { state.dest = input.value; store.set('dest', input.value); if ($('#link').value) convert(); };
  }
  const region = $('#region');
  if (![...region.options].some(o => o.value === state.country)) region.add(new Option(state.country.toUpperCase(), state.country));
  region.value = state.country;
  region.onchange = () => { state.country = region.value; store.set('country', region.value); };

  $('#form').onsubmit = e => { e.preventDefault(); convert(); };
  $('#link').addEventListener('paste', () => setTimeout(convert, 0));
  $('#link').addEventListener('input', () => {
    const d = detect($('#link').value);
    $('#detected').textContent = d && !d.unsupported ? `From ${SERVICES[d.service]}` : '';
  });

  const paste = $('#paste');
  if (navigator.clipboard?.readText) {
    paste.onclick = async () => {
      try { $('#link').value = await navigator.clipboard.readText(); $('#link').dispatchEvent(new Event('input')); convert(); }
      catch { $('#link').focus(); }
    };
  } else {
    paste.hidden = true;
  }

  // Android share sheet (manifest share_target) and the iOS Shortcut both open /?url=… or /?text=….
  const p = new URLSearchParams(location.search);
  const to = p.get('to');
  if (to && SERVICES[to]) {
    state.dest = to;
    for (const input of document.querySelectorAll('input[name="dest"]')) input.checked = input.value === to;
  }
  const shared = p.get('url') || p.get('text') || p.get('title');
  if (shared) {
    $('#link').value = shared;
    $('#link').dispatchEvent(new Event('input'));
    history.replaceState(null, '', location.pathname);
    convert();
  }

  if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
}

init();
