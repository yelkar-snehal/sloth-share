// Pure helpers: parse music links, clean titles, score candidates.
// No DOM and no network, so Node can test them (see test/match.test.mjs).

export const SERVICES = {
  apple: 'Apple Music',
  spotify: 'Spotify',
  youtube: 'YouTube Music',
};

/** Return the first http(s) URL in shared text such as "Listen to X on Spotify: https://...". */
export function firstUrl(text) {
  const m = String(text || '').match(/https?:\/\/[^\s<>"']+|spotify:track:[A-Za-z0-9]{22}/);
  return m ? m[0].replace(/[).,]+$/, '') : '';
}

/** Work out which service a link belongs to and pull out the track id. */
export function detect(raw) {
  const text = firstUrl(raw);
  if (!text) return null;

  let m = text.match(/^spotify:track:([A-Za-z0-9]{22})$/);
  if (m) return { service: 'spotify', id: m[1] };

  let url;
  try { url = new URL(text); } catch { return null; }
  const host = url.hostname.replace(/^www\.|^m\./, '');

  if (host === 'open.spotify.com') {
    m = url.pathname.match(/\/track\/([A-Za-z0-9]{22})/);
    return m ? { service: 'spotify', id: m[1] } : { service: 'spotify', unsupported: 'only single songs are supported' };
  }
  if (host === 'spotify.link' || host === 'spotify.app.link') {
    return { service: 'spotify', shortLink: url.href };
  }
  if (host === 'music.apple.com' || host === 'itunes.apple.com') {
    const country = (url.pathname.split('/')[1] || 'us').slice(0, 2);
    const i = url.searchParams.get('i');
    if (i) return { service: 'apple', id: i, country };
    m = url.pathname.match(/\/song\/(?:[^/]+\/)?(\d+)/);
    if (m) return { service: 'apple', id: m[1], country };
    return { service: 'apple', unsupported: 'open the song itself, not the album, and copy its link' };
  }
  if (host === 'music.youtube.com' || host === 'youtube.com') {
    const v = url.searchParams.get('v');
    return v ? { service: 'youtube', id: v } : { service: 'youtube', unsupported: 'only single songs are supported' };
  }
  if (host === 'youtu.be') {
    const id = url.pathname.slice(1).split('/')[0];
    return id ? { service: 'youtube', id } : null;
  }
  return null;
}

/** YouTube gives "Artist - Song (Official Video)" by "Artist" or "Song" by "Artist - Topic". */
export function parseYouTube(title, author) {
  let artist = String(author || '').replace(/\s*-\s*Topic$/i, '').replace(/VEVO$/i, '').trim();
  let song = String(title || '');
  const dash = song.match(/^(.+?)\s+[-–—]\s+(.+)$/);
  if (dash && !/ - Topic$/i.test(author || '')) {
    artist = dash[1].trim();
    song = dash[2];
  }
  return { title: cleanTitle(song), artist };
}

/** Drop decorations that differ between services: (Official Video), [4K], - Remastered 2011, feat. X. */
export function cleanTitle(s) {
  return String(s || '')
    .replace(/\s*[([][^)\]]*(official|video|audio|lyric|visuali[sz]er|4k|hd|remaster|live|explicit|clean|feat\.?|ft\.?|with )[^)\]]*[)\]]/gi, '')
    .replace(/\s+-\s+(\d{4}\s+)?remaster(ed)?(\s+\d{4})?.*$/i, '')
    .replace(/\s+(feat\.?|ft\.?)\s+.*$/i, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

export function norm(s) {
  return cleanTitle(s)
    .normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9ऀ-ॿ؀-ۿ぀-ヿ一-鿿 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Dice coefficient on character bigrams: 1 for equal strings, 0 for nothing in common. */
export function similarity(a, b) {
  a = norm(a); b = norm(b);
  if (!a || !b) return 0;
  if (a === b) return 1;
  if (a.length < 2 || b.length < 2) return 0;
  const grams = s => { const g = new Map(); for (let i = 0; i < s.length - 1; i++) { const k = s.slice(i, i + 2); g.set(k, (g.get(k) || 0) + 1); } return g; };
  const ga = grams(a), gb = grams(b);
  let common = 0;
  for (const [k, n] of ga) common += Math.min(n, gb.get(k) || 0);
  return (2 * common) / (a.length - 1 + b.length - 1);
}

/** Artist lists differ ("A, B" vs "A & B"), so take the best match of any listed artist. */
export function artistSimilarity(a, b) {
  const split = s => String(s || '').split(/,|&| and | x | feat\.? | ft\.? /i).map(t => t.trim()).filter(Boolean);
  const as = split(a), bs = split(b);
  if (!as.length || !bs.length) return 0;
  let best = similarity(a, b);
  for (const x of as) for (const y of bs) best = Math.max(best, similarity(x, y));
  return best;
}

/** Score 0..1 for how likely a candidate is the same recording as the source. */
export function score(source, cand) {
  const t = similarity(source.title, cand.title);
  const a = artistSimilarity(source.artist, cand.artist);
  let d = 0.5;
  if (source.durationMs && cand.durationMs) {
    const diff = Math.abs(source.durationMs - cand.durationMs) / 1000;
    d = diff <= 3 ? 1 : Math.max(0, 1 - (diff - 3) / 17);
  }
  // A cover or karaoke version often has the right title and the wrong artist.
  const penalty = /karaoke|tribute|cover|instrumental|8-bit/i.test(cand.title + ' ' + cand.artist) &&
    !/karaoke|tribute|cover|instrumental|8-bit/i.test(source.title) ? 0.25 : 0;
  // Tie-break: prefer the exact same title over a "(2022 Remaster)" or "(Live)" variant.
  const exact = String(source.title || '').trim().toLowerCase() === String(cand.title || '').trim().toLowerCase() ? 0.04 : 0;
  return Math.max(0, Math.min(1, 0.55 * t + 0.35 * a + 0.10 * d - penalty + exact));
}

export function rank(source, candidates) {
  return candidates
    .map(c => ({ ...c, score: score(source, c) }))
    .sort((x, y) => y.score - x.score);
}

export function confidence(s) {
  return s >= 0.8 ? 'high' : s >= 0.6 ? 'medium' : 'low';
}
