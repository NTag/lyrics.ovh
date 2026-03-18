const { describe, it } = require("node:test");
const assert = require("node:assert");
const { findLyrics } = require("./lyrics");

// Generous timeout: external HTTP requests can be slow
const TIMEOUT = 30000;

// ── Songs that SHOULD return lyrics ─────────────────────────

const SHOULD_FIND = [
  // English
  ["Pink Floyd", "Wish You Were Here"],
  ["Radiohead", "Creep"],
  ["Nirvana", "Smells Like Teen Spirit"],
  ["Queen", "Bohemian Rhapsody"],
  ["The Beatles", "Let It Be"],
  ["Adele", "Someone Like You"],
  ["Ed Sheeran", "Shape of You"],
  ["Eminem", "Lose Yourself"],
  ["Coldplay", "Yellow"],
  ["Arctic Monkeys", "Do I Wanna Know?"],

  // French
  ["Stromae", "Alors on danse"],
  ["Edith Piaf", "La Vie en rose"],
  ["Jacques Brel", "Ne me quitte pas"],

  // Spanish
  ["Bad Bunny", "Titi Me Pregunto"],
  ["Shakira", "Waka Waka"],

  // Portuguese
  ["Tom Jobim", "Garota de Ipanema"],

  // German
  ["Rammstein", "Du Hast"],
  ["Nena", "99 Luftballons"],

  // Italian
  ["Laura Pausini", "La Solitudine"],

  // Korean
  ["BTS", "Dynamite"],

  // Various genres
  ["Metallica", "Nothing Else Matters"],
  ["Bob Marley", "No Woman No Cry"],
  ["Johnny Cash", "Ring of Fire"],
  ["David Bowie", "Space Oddity"],
  ["Led Zeppelin", "Stairway to Heaven"],
  ["Marvin Gaye", "What's Going On"],
  ["Stevie Wonder", "Superstition"],
  ["Michael Jackson", "Billie Jean"],
  ["ABBA", "Dancing Queen"],
  ["Daft Punk", "Get Lucky"],
];

describe("findLyrics — should find lyrics", { timeout: TIMEOUT }, () => {
  for (const [artist, title] of SHOULD_FIND) {
    it(`${artist} — ${title}`, async () => {
      const lyrics = await findLyrics(title, artist);
      assert.ok(typeof lyrics === "string", "lyrics should be a string");
      assert.ok(lyrics.length > 50, `lyrics too short (${lyrics.length} chars)`);
    });
  }
});

// ── Songs that should NOT return lyrics (false positives) ───

const SHOULD_NOT_FIND = [
  // Completely made-up
  ["Tomeu Penya", "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"],
  ["Tomeu Penya", "Non existent song"],
  ["Pink Floyd", "This Song Does Not Exist At All 12345"],
  ["Radiohead", "zzzzzz fake title qqqqq"],
  ["ABBA", "My Invisible Unicorn Dance Party"],

  // Real artist, totally wrong title
  ["Eminem", "Sunshine Rainbow Butterflies"],
  ["Adele", "Heavy Metal Thunder Explosion"],

  // Made-up artist
  ["Zxqwrt Plmkn", "Invisible Dreams"],
  ["Fake Artist 999", "Not A Real Song"],
  ["aaaaaaaaa", "bbbbbbbbb"],
];

describe(
  "findLyrics — should NOT find lyrics (no false positives)",
  { timeout: TIMEOUT },
  () => {
    for (const [artist, title] of SHOULD_NOT_FIND) {
      it(`${artist} — ${title}`, async () => {
        await assert.rejects(
          () => findLyrics(title, artist),
          (err) => {
            assert.ok(err instanceof Error);
            return true;
          },
          "should reject for non-existent song",
        );
      });
    }
  },
);
