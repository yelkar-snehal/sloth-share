import { SERVICES, YT_FAMILY, detect, parseYouTube, cleanTitle, rank, confidence } from './match.js';
import { pairFor, BREWS } from './pairing.js';
import { ON_REPEAT } from './on-repeat.js';

const $ = sel => document.querySelector(sel);
const store = {
  get: (k, d) => { try { return localStorage.getItem('sb.' + k) || d; } catch { return d; } },
  set: (k, v) => { try { localStorage.setItem('sb.' + k, v); } catch { /* private mode */ } },
};

const state = { dest: store.get('dest', 'apple'), country: store.get('country', 'in') };

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

// Genre and year come from Apple's free catalogue. They drive the coffee pairing.
const vibeOf = t => ({ genre: t.primaryGenreName || '', year: t.releaseDate ? Number(String(t.releaseDate).slice(0, 4)) : undefined });

async function vibe(src, found) {
  if (src.genre) return src;
  if (found.best?.genre) return { ...src, genre: found.best.genre, year: found.best.year };
  try {
    const q = `${src.artist} ${cleanTitle(src.title)}`.trim();
    const best = rank(src, await search('apple', q))[0];
    if (best && best.score >= 0.6) return { ...src, genre: best.genre, year: best.year };
  } catch { /* no pairing data is fine */ }
  return src;
}

function pairingBlock(song) {
  const p = song.coffee && BREWS[song.coffee]
    ? { name: BREWS[song.coffee].name, note: song.note || BREWS[song.coffee].notes[0] }
    : pairFor(song);
  const box = el('div', { class: 'pairing' });
  box.append(icon('i-cup', 'pair-icon'));
  box.append(el('p', { class: 'pair-label' }, 'Pairs with'));
  box.append(el('p', { class: 'pair-name' }, p.name));
  box.append(el('p', { class: 'pair-note' }, p.note));
  return box;
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
    return { service: 'apple', title: t.trackName, artist: t.artistName, durationMs: t.trackTimeMillis, art: t.artworkUrl100, url: link, ...vibeOf(t) };
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

  // YouTube and YouTube Music
  const o = await getJSON('https://www.youtube.com/oembed?format=json&url=' + encodeURIComponent(`https://www.youtube.com/watch?v=${d.id}`));
  return { service: d.service, ytId: d.id, ...parseYouTube(o.title, o.author_name), art: o.thumbnail_url, url: link };
}

// ---------- 2. Find the same song on the destination ----------

const searchUrl = {
  apple: q => `https://music.apple.com/${state.country}/search?term=${encodeURIComponent(q)}`,
  spotify: q => `https://open.spotify.com/search/${encodeURIComponent(q)}`,
  ytmusic: q => `https://music.youtube.com/search?q=${encodeURIComponent(q)}`,
  youtube: q => `https://www.youtube.com/results?search_query=${encodeURIComponent(q)}`,
};

const ytLink = (dest, id) => dest === 'ytmusic' ? `https://music.youtube.com/watch?v=${id}` : `https://www.youtube.com/watch?v=${id}`;

async function search(dest, q) {
  if (dest === 'apple') {
    const body = await getJSON(`https://itunes.apple.com/search?entity=song&limit=10&country=${state.country}&term=${encodeURIComponent(q)}`);
    return (body.results || []).map(t => ({
      title: t.trackName, artist: t.artistName, durationMs: t.trackTimeMillis,
      art: t.artworkUrl100, url: String(t.trackViewUrl).replace(/[?&]uo=\d+/, ''), ...vibeOf(t),
    }));
  }
  if (dest === 'spotify') {
    return (await getJSON(`/api/spotify?q=${encodeURIComponent(q)}&market=${state.country}`)).items;
  }
  const { items } = await getJSON('/api/youtube?q=' + encodeURIComponent(q));
  // YouTube titles look like "Artist - Song (Official Video)": compare on the parsed parts.
  return items.map(it => ({ ...it, ...parseYouTube(it.title, it.artist), shownTitle: it.title, url: ytLink(dest, it.id) }));
}

async function findOn(dest, src) {
  if (src.service === dest) return { best: { ...src, score: 1 }, others: [] };
  if (src.ytId && YT_FAMILY.has(dest)) return { best: { ...src, url: ytLink(dest, src.ytId), score: 1 }, others: [] };
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
  document.body.classList.toggle('working', on);
  $('#status').textContent = text;
}

function icon(id, cls = 'ic') {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', cls);
  svg.setAttribute('aria-hidden', 'true');
  const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
  use.setAttribute('href', '#' + id);
  svg.append(use);
  return svg;
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
    try { await navigator.clipboard.writeText(url); copy.textContent = 'Copied'; copy.classList.add('copied'); }
    catch { prompt('Copy this link:', url); }
    setTimeout(() => { copy.textContent = 'Copy link'; copy.classList.remove('copied'); }, 1500);
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
  const origin = src.service ? `From ${SERVICES[src.service]}` : 'From my on-repeat list';
  out.append(el('p', { class: 'from' }, `${origin}: ${src.title}${src.artist ? ' · ' + src.artist : ''}`));

  if (found.fallback) {
    out.append(el('p', { class: 'note' }, `${found.reason} This link opens a ${SERVICES[dest]} search for the song.`));
    out.append(actions(found.fallback), pairingBlock(found.vibe || src));
    return;
  }

  out.append(songCard(found.best, dest), actions(found.best.url), pairingBlock(found.vibe || src));
  if (confidence(found.best.score) === 'low') {
    out.append(el('p', { class: 'note' }, 'Low match. Check that this is the right version before you share it.'));
  }
  if (found.others.length) {
    const more = el('details', { class: 'others' });
    more.append(el('summary', {}, 'Not the right one?'));
    for (const song of found.others) {
      const pick = el('button', { type: 'button', class: 'other' }, `${song.shownTitle || song.title} · ${song.artist}`);
      pick.onclick = () => render(src, dest, { best: song, others: found.others.filter(s => s !== song).concat(found.best), vibe: found.vibe });
      more.append(pick);
    }
    out.append(more);
  }
}

/** A song from the on-repeat shelf: no link to read, so go straight to the search. */
async function convertKnown(song) {
  setBusy(true, `Searching ${SERVICES[state.dest]}`);
  $('#result').replaceChildren();
  try {
    const found = await findOn(state.dest, song);
    found.vibe = song.coffee ? song : await vibe(song, found);
    render(song, state.dest, found);
    setBusy(false);
    $('#result').scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (err) {
    setBusy(false, `Something went wrong: ${err.message}`);
  }
}

function shelf() {
  const list = $('#repeat-list');
  for (const song of ON_REPEAT) {
    const b = el('button', { type: 'button', class: 'repeat-song' });
    b.append(el('span', { class: 'r-title' }, song.title), el('span', { class: 'r-artist' }, song.artist));
    b.onclick = () => { $('.repeat').open = false; convertKnown(song); };
    list.append(b);
  }
}

async function convert() {
  const link = $('#link').value.trim();
  if (!link) return;
  setBusy(true, 'Finding the song');
  $('#result').replaceChildren();
  try {
    const src = await readSource(link);
    setBusy(true, `Searching ${SERVICES[state.dest]}`);
    const found = await findOn(state.dest, src);
    found.vibe = await vibe(src, found);
    render(src, state.dest, found);
    setBusy(false);
  } catch (err) {
    setBusy(false, err instanceof UserError ? err.message : `Something went wrong: ${err.message}`);
  }
}

// ---------- Wiring ----------

function init() {
  shelf();
  // The mascot is optional: it shows only when /assets/mascot.png exists.
  const mascot = $('#mascot');
  mascot.onload = () => { mascot.hidden = false; };
  if (mascot.complete && mascot.naturalWidth) mascot.hidden = false;

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
  $('#link').addEventListener('input', e => {
    // Typing or editing by hand shows Convert. Pasting converts by itself, so it does not.
    if (e.inputType && e.inputType !== 'insertFromPaste') $('#convert').hidden = false;
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

  // Android Chrome offers install only when the page qualifies; show the button then.
  let installPrompt = null;
  window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); installPrompt = e; $('#install').hidden = false; });
  $('#install').onclick = async () => { if (!installPrompt) return; installPrompt.prompt(); await installPrompt.userChoice; installPrompt = null; $('#install').hidden = true; };
  window.addEventListener('appinstalled', () => { $('#install').hidden = true; });

  if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
}

init();
