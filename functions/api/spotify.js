// GET /api/spotify?track=<id>            -> one track
// GET /api/spotify?q=<text>&market=IN    -> search results
// GET /api/spotify?expand=<spotify.link> -> the open.spotify.com URL behind a short link
//
// The Spotify client secret stays here, on the server. Set SPOTIFY_CLIENT_ID and
// SPOTIFY_CLIENT_SECRET as encrypted variables in the Cloudflare Pages project.
function json(body, status = 200, maxAge = 0) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': maxAge ? `public, max-age=${maxAge}` : 'no-store',
    },
  });
}

/** Only this site may call the API from a browser. Stops other sites from spending our quota. */
function foreignOrigin(request) {
  const origin = request.headers.get('origin');
  if (!origin) return false;
  return new URL(origin).host !== new URL(request.url).host;
}

let cached = { token: '', expiresAt: 0 };

async function accessToken(env) {
  if (cached.token && Date.now() < cached.expiresAt) return cached.token;
  const res = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      authorization: 'Basic ' + btoa(`${env.SPOTIFY_CLIENT_ID}:${env.SPOTIFY_CLIENT_SECRET}`),
    },
    body: 'grant_type=client_credentials',
  });
  if (!res.ok) throw new Error(`Spotify token request failed (${res.status})`);
  const body = await res.json();
  cached = { token: body.access_token, expiresAt: Date.now() + (body.expires_in - 60) * 1000 };
  return cached.token;
}

const toItem = t => ({
  title: t.name,
  artist: t.artists.map(a => a.name).join(', '),
  durationMs: t.duration_ms,
  isrc: t.external_ids?.isrc,
  art: (t.album?.images || []).slice(-2)[0]?.url || '',
  url: t.external_urls?.spotify,
});

async function expand(shortUrl) {
  const host = new URL(shortUrl).hostname;
  if (host !== 'spotify.link' && host !== 'spotify.app.link') throw new Error('Not a Spotify short link');
  const res = await fetch(shortUrl, { redirect: 'follow', headers: { 'user-agent': 'Mozilla/5.0' } });
  if (new URL(res.url).hostname === 'open.spotify.com') return res.url;
  // Some short links land on a page that redirects with JavaScript. Read the target from the page.
  const m = (await res.text()).match(/https:\/\/open\.spotify\.com\/track\/[A-Za-z0-9]{22}/);
  if (!m) throw new Error('Could not open the short link');
  return m[0];
}

export async function onRequestGet({ request, env }) {
  if (foreignOrigin(request)) return json({ error: 'forbidden' }, 403);
  const p = new URL(request.url).searchParams;

  try {
    if (p.get('expand')) return json({ url: await expand(p.get('expand')) }, 200, 86400);

    if (!env.SPOTIFY_CLIENT_ID || !env.SPOTIFY_CLIENT_SECRET) {
      return json({ error: 'spotify_not_configured' }, 503);
    }
    const headers = { authorization: `Bearer ${await accessToken(env)}` };
    const market = (p.get('market') || 'IN').slice(0, 2).toUpperCase();

    const id = p.get('track');
    if (id) {
      if (!/^[A-Za-z0-9]{22}$/.test(id)) return json({ error: 'bad track id' }, 400);
      const res = await fetch(`https://api.spotify.com/v1/tracks/${id}?market=${market}`, { headers });
      if (!res.ok) return json({ error: `Spotify returned ${res.status}` }, res.status === 404 ? 404 : 502);
      return json(toItem(await res.json()), 200, 86400);
    }

    const q = (p.get('q') || '').slice(0, 200);
    if (q) {
      const url = `https://api.spotify.com/v1/search?type=track&limit=8&market=${market}&q=${encodeURIComponent(q)}`;
      const res = await fetch(url, { headers });
      if (!res.ok) return json({ error: `Spotify returned ${res.status}` }, 502);
      const body = await res.json();
      return json({ items: (body.tracks?.items || []).map(toItem) }, 200, 3600);
    }
  } catch (err) {
    return json({ error: err.message }, 502);
  }
  return json({ error: 'use ?track=, ?q= or ?expand=' }, 400);
}
