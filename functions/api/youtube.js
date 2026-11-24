// GET /api/youtube?q=<text> -> YouTube Music links for the best matching music videos.
//
// Optional. Set YOUTUBE_API_KEY (YouTube Data API v3, free quota) as an encrypted variable.
// Without it the page falls back to a YouTube Music search link.
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

const decode = s => String(s || '')
  .replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>');

export async function onRequestGet({ request, env }) {
  if (foreignOrigin(request)) return json({ error: 'forbidden' }, 403);
  if (!env.YOUTUBE_API_KEY) return json({ error: 'youtube_not_configured' }, 503);

  const q = (new URL(request.url).searchParams.get('q') || '').slice(0, 200);
  if (!q) return json({ error: 'use ?q=' }, 400);

  const url = 'https://www.googleapis.com/youtube/v3/search?part=snippet&type=video&videoCategoryId=10&maxResults=6'
    + `&q=${encodeURIComponent(q)}&key=${env.YOUTUBE_API_KEY}`;
  try {
    const res = await fetch(url);
    if (!res.ok) return json({ error: `YouTube returned ${res.status}` }, res.status === 403 ? 429 : 502);
    const body = await res.json();
    const items = (body.items || []).map(it => ({
      title: decode(it.snippet.title),
      artist: decode(it.snippet.channelTitle).replace(/\s*-\s*Topic$/i, '').replace(/VEVO$/i, ''),
      art: it.snippet.thumbnails?.medium?.url || '',
      url: `https://music.youtube.com/watch?v=${it.id.videoId}`,
    }));
    return json({ items }, 200, 3600);
  } catch (err) {
    return json({ error: err.message }, 502);
  }
}
