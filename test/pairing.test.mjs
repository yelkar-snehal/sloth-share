import test from 'node:test';
import assert from 'node:assert/strict';
import { pairFor, BREWS } from '../pairing.js';

test('the same song always gets the same coffee', () => {
  const song = { title: 'Despacito', artist: 'Luis Fonsi', genre: 'Latin' };
  assert.deepEqual(pairFor(song), pairFor({ ...song }));
});

test('genres map to the right family of brews', () => {
  assert.match(pairFor({ title: 'Tum Hi Ho', artist: 'Arijit Singh', genre: 'Bollywood', year: 2013 }).name, /filter coffee, black/);
  assert.match(pairFor({ title: 'Lag Jaa Gale', artist: 'Lata Mangeshkar', genre: 'Bollywood', year: 1964 }).name, /Traditional filter kaapi/);
  assert.ok(['moka', 'aeroIced'].includes(pairFor({ title: 'Lose Yourself', artist: 'Eminem', genre: 'Hip-Hop/Rap' }).key));
  assert.equal(pairFor({ title: 'x', artist: 'y', genre: '' }).key, 'leftover');
});

test('a very long song gets the slow cone, a very short one the AeroPress', () => {
  assert.equal(pairFor({ title: 'Long', artist: 'A', genre: 'Jazz', durationMs: 9 * 60000 }).key, 'deep27');
  const short = pairFor({ title: 'Short', artist: 'B', genre: 'Classical', durationMs: 2 * 60000 });
  assert.equal(short.key, 'aero');
});

test('every brew has a name and at least one note', () => {
  for (const b of Object.values(BREWS)) { assert.ok(b.name); assert.ok(b.notes.length); }
});
