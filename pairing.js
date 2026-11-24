// A coffee for every song: Grey Soul's "a song for every cup", in reverse.
// Plain rules, no AI. The same song always gets the same coffee, so a shared link
// shows the same pairing to everyone. Edit BREWS and GENRES to change the menu.

export const BREWS = {
  v60Hot: { name: 'Hot V60, light roast', notes: ['Bright and clean. Let it bloom, like the intro.', 'Slow pour, slow song.'] },
  v60Iced: { name: 'Iced V60, light roast', notes: ['Half the water as ice. Bright, cold, gone before the chorus ends.', 'Fruity, cold and a little dramatic.'] },
  deep27: { name: 'Cafec Deep 27, medium roast', notes: ['A long, sweet draw-down. No rush.', 'Deep cone, deep cut.'] },
  pourBalanced: { name: 'Balanced pour-over, medium roast', notes: ['Nothing too bright, nothing too bitter. Just even.'] },
  steel: { name: 'Steel-filter pour-over, medium roast', notes: ['More body, a little grit. Like a live take.', 'The oils stay in, and so does the feeling.'] },
  aero: { name: 'AeroPress, medium roast', notes: ['Quick, punchy, one press. Fits a short song.', 'Two minutes, done. Repeat.'] },
  aeroInverted: { name: 'Inverted AeroPress, long steep', notes: ['Flip it, wait, press. Smooth and round.', 'A long steep for a slow groove.'] },
  aeroWild: { name: 'Inverted AeroPress, in the wild', notes: ['Packed in the bag, brewed outdoors. Flip, steep, press.'] },
  aeroLong: { name: "AeroPress, Jonathan Gagné's long method", notes: ['Right way up, long and patient. Worth the wait.'] },
  aeroIced: { name: 'AeroPress shot over ice', notes: ['Strong over ice. Loud and cold.', 'A small, sharp shot for a high-energy track.'] },
  coldBrew: { name: 'Cold brew pot, 16 hours', notes: ['Made the night before, like this playlist.', 'Smooth, low acid, on loop all day.'] },
  leftover: { name: 'Leftover beans in the cold-brew pot', notes: ['No plan, no recipe. Whatever beans are left, and it still works.', 'The end of the bag, and the end of the night.'] },
  moka: { name: 'Moka pot, dark roast', notes: ['Loud on the stove, loud in the headphones.', 'Thick, bitter, unapologetic.'] },
  filterBlack: { name: 'South Indian filter coffee, black', notes: ['Strong decoction, no milk. The way I drink it.', 'Early morning, steel tumbler, black.'] },
  sifRocks: { name: 'SIF on the rocks (South Indian filter over ice)', notes: ['Strong decoction over ice. Loud, cold and very South Indian.'] },
  filterTraditional: { name: 'Traditional filter kaapi, with milk and sugar', notes: ['Davara and tumbler, pulled high. A song your parents know.', 'Frothy, sweet, nostalgic.'] },
};

// iTunes `primaryGenreName` values (and a few common words) mapped to two or three brews.
const GENRES = [
  [/jazz|blues|bossa/i, ['deep27', 'v60Hot', 'aeroInverted']],
  [/classical|ambient|new age|instrumental|piano/i, ['v60Hot', 'deep27']],
  [/singer|songwriter|folk|indie|alternative|acoustic/i, ['steel', 'aeroInverted', 'v60Hot']],
  [/k-pop|j-pop|pop|dance|disco/i, ['v60Iced', 'aeroIced']],
  [/electronic|house|techno|edm|lo-?fi|chill/i, ['coldBrew', 'v60Iced']],
  [/hip-hop|rap|metal|punk|hard rock|grunge/i, ['moka', 'aeroIced']],
  [/rock/i, ['moka', 'steel', 'aero']],
  [/r&b|soul|funk/i, ['aeroInverted', 'coldBrew']],
  [/bollywood|indian|hindi|tamil|telugu|kannada|malayalam|marathi|punjabi|bengali/i, ['filterBlack', 'filterTraditional']],
  [/devotional|spiritual|sufi|ghazal|qawwali|carnatic|hindustani/i, ['filterBlack']],
  [/soundtrack|score|musical/i, ['aero', 'deep27']],
  [/latin|reggae|afro|caribbean/i, ['v60Iced', 'coldBrew']],
  [/country|americana/i, ['steel']],
];

/** Small stable hash, so the same song always picks the same option. */
function hash(s) {
  let h = 2166136261;
  for (const ch of String(s)) { h ^= ch.codePointAt(0); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

/**
 * song: { title, artist, genre?, durationMs?, year? }
 * Returns { key, name, note }.
 */
export function pairFor(song) {
  const seed = hash(`${song.title}|${song.artist}`.toLowerCase());
  const genre = song.genre || '';
  let options = GENRES.find(([re]) => re.test(genre))?.[1];

  if (!options) {
    options = ['leftover'];
  } else if (options.includes('filterTraditional')) {
    // Old Indian songs get the traditional cup; newer ones get it black.
    options = song.year && song.year < 2000 ? ['filterTraditional'] : ['filterBlack'];
  }

  let key = options[seed % options.length];
  const minutes = (song.durationMs || 0) / 60000;
  if (minutes > 7 && key !== 'filterBlack' && key !== 'filterTraditional') key = 'deep27'; // long song, long draw-down
  if (minutes && minutes < 2.5 && (key === 'v60Hot' || key === 'deep27')) key = 'aero';  // short song, short brew

  const brew = BREWS[key];
  return { key, name: brew.name, note: brew.notes[(seed >>> 8) % brew.notes.length] };
}
