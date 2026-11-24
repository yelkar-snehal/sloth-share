# Sloth Share

Too lazy to search for a song in your friend's app? Paste a song link from Spotify, Apple Music, YouTube Music or YouTube, choose your friend's app, and get the same song's link for that app. It works in any browser, including phones, and costs nothing to run.

## How it works

1. It reads the song from the link:
   - Apple Music: the free iTunes lookup API (no key).
   - YouTube Music: YouTube's oEmbed API (no key).
   - Spotify: the Spotify Web API, through `functions/api/spotify.js`. Without Spotify keys it falls back to Spotify's oEmbed API, which gives the title only.
2. It searches the destination:
   - Apple Music: the free iTunes Search API (no key).
   - Spotify: the Spotify Web API (free developer app).
   - YouTube Music: the YouTube Data API (free key, about 100 searches a day), through `functions/api/youtube.js`.
3. It scores each result on title, artist and duration (`match.js`), and shows the best match as high, medium or low, plus other options.

If a destination has no key or its daily quota is used up, the page gives a search link on that service instead.

The secrets stay in the two Cloudflare Pages Functions. The browser never sees them. Requests from other websites are refused.

## Run the tests

```bash
npm test
```

## Run it locally

```bash
cp .dev.vars.example .dev.vars   # optional: fill in keys
npx wrangler pages dev .         # http://localhost:8788
```

## Deploy free on Cloudflare Pages

1. Push this folder to a GitHub repository.
2. In the Cloudflare dashboard: Workers & Pages → Create → Pages → Connect to Git → choose the repository.
   - Framework preset: None. Build command: leave empty. Build output directory: `/`.
   - The `functions/` folder is picked up automatically.
3. After the first deploy: Settings → Variables and Secrets → add these as encrypted secrets, then redeploy:
   - `SPOTIFY_CLIENT_ID` and `SPOTIFY_CLIENT_SECRET` (optional, for Spotify)
   - `YOUTUBE_API_KEY` (optional, for direct YouTube Music matches)
4. The site is at `https://<project-name>.pages.dev`.

Apple Music needs no setup and no paid Apple account.

### Spotify keys (free)

1. Go to https://developer.spotify.com/dashboard, log in, and create an app.
2. Any name and description. Redirect URI: your site address, for example `https://sloth-share.pages.dev/`. API: Web API.
3. Open the app's settings and copy the Client ID and Client Secret.

If Spotify's dashboard does not let you create an app with your account, skip it. Spotify still works as a source (title only) and gives a search link as a destination.

### YouTube key (free)

1. Go to https://console.cloud.google.com, create a project.
2. APIs & Services → Library → enable "YouTube Data API v3".
3. APIs & Services → Credentials → Create credentials → API key. Restrict the key to "YouTube Data API v3".
4. The free quota is 10,000 units a day. One search uses 100, so about 100 conversions to YouTube Music a day.

## Use it on a phone

Android (Chrome): open the site → menu → Install app (or Add to Home screen). Then, in any music app, tap Share → Sloth Share. The result opens with the link ready to copy.

iPhone: websites cannot appear in the Share menu. Copy the song link, open the site and tap Paste. For one tap from the Share menu, make a Shortcut:

1. Shortcuts app → + → name it "Sloth Share".
2. Tap the (i) settings → turn on "Show in Share Sheet", and set it to receive URLs and Text.
3. Add the action "URL Encode" with Shortcut Input.
4. Add the action "URL" with: `https://<project-name>.pages.dev/?to=apple&url=` followed by the URL Encoded result.
5. Add the action "Open URLs".

Change `to=apple` to `to=spotify`, `to=ytmusic` (YouTube Music) or `to=youtube` to fix the destination, or leave `to=` out to use the last choice.

## Limits

- Single songs only. Albums and playlists are not supported.
- Matching uses title, artist and duration. Live versions, remixes and songs that are not available in the chosen region can match the wrong version or nothing, so check a low or medium match before you share it.
- Apple Music links are per region. Set Region to your friend's country.

## License

The code is MIT. See [LICENSE](LICENSE). The drawings in `assets/` are not: they belong to Snehal Yelkar, all rights reserved.

Icons: [Lucide](https://lucide.dev) (ISC license).
