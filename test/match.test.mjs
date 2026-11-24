import test from 'node:test';
import assert from 'node:assert/strict';
import { detect, firstUrl, parseYouTube, cleanTitle, rank, confidence, similarity } from '../match.js';

test('detects Spotify track links, URIs and short links', () => {
  assert.deepEqual(detect('https://open.spotify.com/track/4cOdK2wGLETKBW3PvgPWqT?si=abc'), { service: 'spotify', id: '4cOdK2wGLETKBW3PvgPWqT' });
  assert.deepEqual(detect('https://open.spotify.com/intl-de/track/4cOdK2wGLETKBW3PvgPWqT'), { service: 'spotify', id: '4cOdK2wGLETKBW3PvgPWqT' });
  assert.deepEqual(detect('spotify:track:4cOdK2wGLETKBW3PvgPWqT'), { service: 'spotify', id: '4cOdK2wGLETKBW3PvgPWqT' });
  assert.equal(detect('https://spotify.link/AbC123').shortLink, 'https://spotify.link/AbC123');
  assert.ok(detect('https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M').unsupported);
});

test('detects Apple Music song links in album and song form', () => {
  assert.deepEqual(detect('https://music.apple.com/in/album/never-gonna-give-you-up/1558533900?i=1558534271'), { service: 'apple', id: '1558534271', country: 'in' });
  assert.deepEqual(detect('https://music.apple.com/us/song/never-gonna-give-you-up/1558534271'), { service: 'apple', id: '1558534271', country: 'us' });
  assert.ok(detect('https://music.apple.com/us/album/whenever-you-need-somebody/1558533900').unsupported);
});

test('detects YouTube Music and YouTube links', () => {
  assert.deepEqual(detect('https://music.youtube.com/watch?v=dQw4w9WgXcQ&si=x'), { service: 'youtube', id: 'dQw4w9WgXcQ' });
  assert.deepEqual(detect('https://youtu.be/dQw4w9WgXcQ?si=x'), { service: 'youtube', id: 'dQw4w9WgXcQ' });
  assert.deepEqual(detect('https://m.youtube.com/watch?v=dQw4w9WgXcQ'), { service: 'youtube', id: 'dQw4w9WgXcQ' });
});

test('finds the URL inside shared text', () => {
  assert.equal(firstUrl('Listen to this on Spotify: https://open.spotify.com/track/4cOdK2wGLETKBW3PvgPWqT.'), 'https://open.spotify.com/track/4cOdK2wGLETKBW3PvgPWqT');
  assert.equal(detect('hello'), null);
});

test('parses YouTube titles', () => {
  assert.deepEqual(parseYouTube('Rick Astley - Never Gonna Give You Up (Official Video) (4K Remaster)', 'Rick Astley'), { title: 'Never Gonna Give You Up', artist: 'Rick Astley' });
  assert.deepEqual(parseYouTube('Tum Hi Ho', 'Arijit Singh - Topic'), { title: 'Tum Hi Ho', artist: 'Arijit Singh' });
});

test('cleans decorations from titles', () => {
  assert.equal(cleanTitle('Here Comes The Sun - Remastered 2009'), 'Here Comes The Sun');
  assert.equal(cleanTitle('Señorita (feat. X)'), 'Señorita');
  assert.equal(cleanTitle('Blinding Lights [Official Audio]'), 'Blinding Lights');
});

test('ranks the real recording above a karaoke cover', () => {
  const source = { title: 'Never Gonna Give You Up', artist: 'Rick Astley', durationMs: 213000 };
  const ranked = rank(source, [
    { title: 'Never Gonna Give You Up (Karaoke Version)', artist: 'Karaoke Hits', durationMs: 214000 },
    { title: 'Never Gonna Give You Up', artist: 'Rick Astley', durationMs: 214000 },
    { title: 'Together Forever', artist: 'Rick Astley', durationMs: 200000 },
  ]);
  assert.equal(ranked[0].artist, 'Rick Astley');
  assert.equal(ranked[0].title, 'Never Gonna Give You Up');
  assert.equal(confidence(ranked[0].score), 'high');
  assert.notEqual(confidence(ranked[2].score), 'high');
});

test('similarity ignores case, accents and punctuation', () => {
  assert.equal(similarity('Beyoncé', 'beyonce'), 1);
  assert.ok(similarity('Hello', 'Goodbye') < 0.3);
});
