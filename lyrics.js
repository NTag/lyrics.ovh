const cheerio = require("cheerio");

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

const FETCH_TIMEOUT = 5000; // 5s per source request

// ── LRU Cache ────────────────────────────────────────────────

const CACHE_MAX = 10000;
const cache = new Map();

function cacheGet(key) {
  const val = cache.get(key);
  if (val === undefined) return undefined;
  // Move to end (most recently used)
  cache.delete(key);
  cache.set(key, val);
  return val;
}

function cacheSet(key, val) {
  if (cache.has(key)) cache.delete(key);
  cache.set(key, val);
  // Evict oldest entries if over limit
  while (cache.size > CACHE_MAX) {
    cache.delete(cache.keys().next().value);
  }
}

function levenshtein(a, b) {
  const m = a.length,
    n = b.length;
  const dp = Array.from({ length: m + 1 }, (_, i) => [i]);
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] =
        a[i - 1] === b[j - 1]
          ? dp[i - 1][j - 1]
          : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return dp[m][n];
}

function deburr(str) {
  return str.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

function kebabCase(str) {
  return str
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase();
}

function snakeCase(str) {
  return str
    .replace(/[^a-zA-Z0-9]+/g, "_")
    .replace(/^_|_$/g, "")
    .toLowerCase();
}

function stripToAlphaNum(str) {
  return str.replace(/[^a-zA-Z0-9]/g, "").toLowerCase();
}

/**
 * Check if a result title is a reasonable match for the requested title.
 * Strips accents, punctuation, and compares normalized forms.
 * Uses Levenshtein distance relative to the shorter string length.
 */
function titleMatches(requested, found) {
  const normalize = (s) =>
    deburr(s)
      .toLowerCase()
      .replace(/\(.*?\)/g, "")
      .replace(/\[.*?\]/g, "")
      .replace(/[^a-z0-9]/g, "");
  const a = normalize(requested);
  const b = normalize(found);
  if (!a || !b) return false;
  // Exact match after normalization
  if (a === b) return true;
  // One contains the other
  if (a.includes(b) || b.includes(a)) return true;
  // Levenshtein: allow up to 30% distance relative to the shorter string
  const dist = levenshtein(a, b);
  const maxLen = Math.max(a.length, b.length);
  return dist / maxLen <= 0.3;
}

function textln($el) {
  $el.find("script").remove();
  $el.find("#video-musictory").remove();
  // Get inner HTML so we can process it as a string
  let html = $el.html() || "";
  // Normalize <br> variants to \n, eating surrounding whitespace/newlines
  html = html.replace(/\s*<br\s*\/?>\s*/gi, "\n");
  // Strip all remaining HTML tags
  html = html.replace(/<[^>]+>/g, "");
  // Decode common HTML entities
  html = html.replace(/&amp;/g, "&");
  html = html.replace(/&lt;/g, "<");
  html = html.replace(/&gt;/g, ">");
  html = html.replace(/&quot;/g, '"');
  html = html.replace(/&#x27;/g, "'");
  html = html.replace(/&nbsp;/g, " ");
  // Clean up whitespace
  html = html.replace(/\r\n/g, "\n");
  html = html.replace(/\t/g, "");
  html = html.replace(/ +/g, " ");
  html = html.replace(/\n /g, "\n");
  html = html.replace(/ \n/g, "\n");
  return html.trim();
}

const REJECT_PATTERNS = [
  /no lyrics found/i,
  /lyrics not available/i,
  /we do not have the lyrics/i,
  /submit lyrics/i,
  /paroles introuvables/i,
  /n[ãa]o possui letra/i,
];

function cleanLyrics(text) {
  text = text.trim();
  // Collapse 3+ consecutive newlines into 2 (one blank line)
  text = text.replace(/\n{3,}/g, "\n\n");
  // Remove trailing spaces on each line
  text = text.replace(/ +\n/g, "\n");
  if (text.length < 20) throw new Error("No lyrics found");
  // Reject placeholder/error messages scraped from source pages
  if (text.length < 80 && REJECT_PATTERNS.some((re) => re.test(text))) {
    throw new Error("Scraped error message, not lyrics");
  }
  return text;
}

async function fetchHtml(url, options = {}) {
  const { rejectRedirects, ...fetchOptions } = options;
  const res = await fetch(url, {
    headers: { "User-Agent": USER_AGENT },
    redirect: "follow",
    signal: AbortSignal.timeout(FETCH_TIMEOUT),
    ...fetchOptions,
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  // Some sites redirect unknown songs to artist page or homepage
  if (rejectRedirects && res.redirected) {
    throw new Error("Redirected (likely no match)");
  }
  const body = await res.text();
  return cheerio.load(body);
}

// ── Sources ──────────────────────────────────────────────────

/**
 * Genius - largest lyrics database
 * Uses their internal search API then scrapes the lyrics page
 */
function fromGenius(title, artistName) {
  return fetch(
    "https://genius.com/api/search/multi?q=" +
      encodeURIComponent(artistName + " " + title),
    {
      headers: { "User-Agent": USER_AGENT },
      signal: AbortSignal.timeout(FETCH_TIMEOUT),
    },
  )
    .then((res) => {
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    })
    .then((data) => {
      const sections = data.response?.sections || [];
      const songSection = sections.find((s) => s.type === "song");
      const hits = songSection?.hits || [];
      if (hits.length === 0) throw new Error("No results");
      // Pick the best match by comparing artist name
      // Filter hits to only those whose title actually matches
      const matchingHits = hits.filter((hit) =>
        titleMatches(title, hit.result?.title || ""),
      );
      if (matchingHits.length === 0) throw new Error("No matching title");
      // Among matches, pick the closest artist name
      let bestHit = matchingHits[0];
      let bestScore = Infinity;
      for (const hit of matchingHits) {
        const score = levenshtein(
          artistName.toLowerCase(),
          (hit.result?.primary_artist?.name || "").toLowerCase(),
        );
        if (score < bestScore) {
          bestScore = score;
          bestHit = hit;
        }
      }
      return bestHit.result.url;
    })
    .then((url) => fetchHtml(url))
    .then(($) => {
      const containers = $('[data-lyrics-container="true"]');
      if (containers.length === 0) throw new Error("No lyrics container");
      // Process each container: replace <br> with newlines, strip tags
      let lyrics = "";
      containers.each((_, el) => {
        const $el = $(el);
        $el.find("br").replaceWith("\n");
        lyrics += $el.text() + "\n";
      });
      return cleanLyrics(lyrics.trim());
    });
}

/**
 * AZLyrics - good English song coverage
 * Direct URL construction
 */
function fromAZLyrics(title, artistName) {
  const artist = stripToAlphaNum(deburr(artistName)).replace(/^the/, "");
  const song = stripToAlphaNum(deburr(title));
  return fetchHtml(
    "https://www.azlyrics.com/lyrics/" + artist + "/" + song + ".html",
  ).then(($) => {
    // Lyrics are in an unnamed div after the .ringtone div
    const divs = $(".col-xs-12.col-lg-8.text-center div");
    let lyrics = "";
    divs.each((_, el) => {
      const $el = $(el);
      // The lyrics div has no class and no id
      if (
        !$el.attr("class") &&
        !$el.attr("id") &&
        $el.text().trim().length > 100
      ) {
        $el.find("br").replaceWith("\n");
        lyrics = $el.text().trim();
        return false; // break
      }
    });
    return cleanLyrics(lyrics);
  });
}

/**
 * Letras.mus.br - excellent international coverage
 */
function fromLetras(title, artistName) {
  const artist = kebabCase(deburr(artistName.trim()));
  const song = kebabCase(deburr(title.trim()));
  return fetchHtml("https://www.letras.mus.br/" + artist + "/" + song + "/", {
    rejectRedirects: true,
  }).then(
    ($) => {
      const el = $(".lyric-original p, .lyric-tra p");
      if (el.length === 0) throw new Error("Not found");
      let lyrics = "";
      el.each((_, p) => {
        const $p = $(p);
        $p.find("br").replaceWith("\n");
        lyrics += $p.text().trim() + "\n\n";
      });
      return cleanLyrics(lyrics.trim());
    },
  );
}

/**
 * Lyrics.com - search then scrape
 */
function fromLyricsCom(title, artistName) {
  return fetchHtml(
    "https://www.lyrics.com/serp.php?st=" +
      encodeURIComponent(title + " " + artistName) +
      "&stype=1",
  )
    .then(($) => {
      const results = $(".sec-lyric.clearfix");
      if (results.length === 0) throw new Error("No results");
      // Find the closest match by artist name
      let bestLink = null,
        bestScore = Infinity;
      results.each((_, el) => {
        const $el = $(el);
        const artist = $el.find(".lyric-meta-album-artist a").first().text();
        const resultTitle = $el.find("a.lyric-meta-title").text();
        const link = $el.find("a.lyric-meta-title").attr("href");
        // Only consider results where the title actually matches
        if (link && titleMatches(title, resultTitle)) {
          const score = levenshtein(
            artistName.toLowerCase(),
            artist.toLowerCase(),
          );
          if (score < bestScore) {
            bestScore = score;
            bestLink = link;
          }
        }
      });
      if (!bestLink) throw new Error("No matching result");
      const url = bestLink.startsWith("http")
        ? bestLink
        : "https://www.lyrics.com" + bestLink;
      return fetchHtml(url);
    })
    .then(($) => {
      const el = $("#lyric-body-text");
      if (el.length === 0) throw new Error("Not found");
      el.find("br").replaceWith("\n");
      return cleanLyrics(el.text().trim());
    });
}

/**
 * Paroles.net - French lyrics site, works well
 */
function fromParolesNet(title, artistName) {
  const lyricsUrl = (s) => kebabCase(deburr(s.trim().toLowerCase()));
  return fetchHtml(
    "https://www.paroles.net/" +
      lyricsUrl(artistName) +
      "/paroles-" +
      lyricsUrl(title),
    { rejectRedirects: true },
  ).then(($) => {
    const el = $("article.lyrics, .song-text").first();
    if (el.length === 0) throw new Error("Not found");
    // Remove header and ad divs that are mixed into lyrics
    el.find("h2").remove();
    el.find("div[id], div[class], div[style]").remove();
    return cleanLyrics(textln(el));
  });
}

/**
 * LyricsMania - multiple URL patterns
 */
function fromLyricsMania(title, artistName) {
  const maniaUrl = (s) => snakeCase(deburr(s.trim().toLowerCase()));
  const urls = [
    "https://www.lyricsmania.com/" +
      maniaUrl(title) +
      "_lyrics_" +
      maniaUrl(artistName) +
      ".html",
    "https://www.lyricsmania.com/" +
      maniaUrl(title) +
      "_" +
      maniaUrl(artistName) +
      ".html",
  ];
  return Promise.any(
    urls.map((url) =>
      fetchHtml(url, { rejectRedirects: true }).then(($) => {
        if ($(".lyrics-body").length === 0) throw new Error("Not found");
        return cleanLyrics(textln($(".lyrics-body")));
      }),
    ),
  );
}

/**
 * LRCLIB - open, community-maintained lyrics database with a free JSON API
 * (https://lrclib.net). Exact lookup first, then a search.
 */
const LRCLIB_HEADERS = {
  // LRCLIB asks clients to identify themselves.
  "User-Agent": "lyrics.ovh (https://github.com/NTag/lyrics.ovh)",
};

async function fromLrclib(title, artistName) {
  const plain = (r) =>
    r && !r.instrumental && r.plainLyrics ? cleanLyrics(r.plainLyrics) : null;
  const query = new URLSearchParams({
    artist_name: artistName,
    track_name: title,
  });
  const res = await fetch("https://lrclib.net/api/get?" + query, {
    headers: LRCLIB_HEADERS,
    signal: AbortSignal.timeout(FETCH_TIMEOUT),
  });
  if (res.ok) {
    const lyrics = plain(await res.json());
    if (lyrics) return lyrics;
  } else if (res.status !== 404) {
    throw new Error(`HTTP ${res.status}`);
  }
  // No exact match: search, keep results whose title matches, closest artist.
  const search = await fetch("https://lrclib.net/api/search?" + query, {
    headers: LRCLIB_HEADERS,
    signal: AbortSignal.timeout(FETCH_TIMEOUT),
  });
  if (!search.ok) throw new Error(`HTTP ${search.status}`);
  const results = (await search.json()).filter(
    (r) => r.plainLyrics && !r.instrumental && titleMatches(title, r.trackName || ""),
  );
  if (results.length === 0) throw new Error("No matching result");
  const best = results.reduce((a, b) =>
    levenshtein(artistName.toLowerCase(), (b.artistName || "").toLowerCase()) <
    levenshtein(artistName.toLowerCase(), (a.artistName || "").toLowerCase())
      ? b
      : a,
  );
  return plain(best);
}

/**
 * NetEase Cloud Music - large catalog (Western songs included), public JSON
 * API. Lyrics come as LRC: timestamps and credit lines are stripped.
 */
function artistMatches(requested, names) {
  const normalize = (s) => deburr(s).toLowerCase().replace(/[^a-z0-9]/g, "");
  const a = normalize(requested);
  if (!a) return false;
  return names.some((name) => {
    const b = normalize(name);
    if (!b) return false;
    if (a === b || a.includes(b) || b.includes(a)) return true;
    return levenshtein(a, b) / Math.max(a.length, b.length) <= 0.3;
  });
}

function lrcToText(lrc) {
  return lrc
    .split("\n")
    .map((line) => line.replace(/^(\s*\[\d+:\d+(?:[.:]\d+)?\])+\s*/, ""))
    // Metadata tags ([ti:…], [ar:…]) and credit lines ("作词 : …", "作曲 : …")
    .filter((line) => !/^\s*\[[a-z]+:.*\]\s*$/i.test(line))
    .filter((line) => !/^\s*[一-鿿]{1,8}\s*[:：]/.test(line))
    .join("\n");
}

async function fromNetease(title, artistName) {
  const search = await fetch(
    "https://music.163.com/api/search/get?" +
      new URLSearchParams({ s: artistName + " " + title, type: "1", limit: "10" }),
    {
      headers: { "User-Agent": USER_AGENT },
      signal: AbortSignal.timeout(FETCH_TIMEOUT),
    },
  );
  if (!search.ok) throw new Error(`HTTP ${search.status}`);
  const songs = (await search.json()).result?.songs || [];
  const song = songs.find(
    (s) =>
      titleMatches(title, s.name || "") &&
      artistMatches(artistName, (s.artists || []).map((a) => a.name || "")),
  );
  if (!song) throw new Error("No matching result");
  const res = await fetch(
    "https://music.163.com/api/song/lyric?id=" + song.id + "&lv=1",
    {
      headers: { "User-Agent": USER_AGENT },
      signal: AbortSignal.timeout(FETCH_TIMEOUT),
    },
  );
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const lrc = (await res.json()).lrc?.lyric;
  if (!lrc) throw new Error("No lyrics");
  // "纯音乐，请欣赏" = instrumental, enjoy
  if (lrc.includes("纯音乐")) throw new Error("Instrumental");
  return cleanLyrics(lrcToText(lrc));
}

/**
 * eLyrics.net - direct URL construction
 */
function fromElyrics(title, artistName) {
  const slug = (s) => kebabCase(deburr(s.trim().toLowerCase()));
  const artist = slug(artistName);
  const song = slug(title);
  if (!artist || !song) return Promise.reject(new Error("Empty name"));
  const letter = /[a-z]/.test(artist[0]) ? artist[0] : "0";
  return fetchHtml(
    `https://www.elyrics.net/read/${letter}/${artist}-lyrics/${song}-lyrics.html`,
    { rejectRedirects: true },
  ).then(($) => {
    const el = $("#inlyr");
    if (el.length === 0) throw new Error("Not found");
    el.find("div, script, ins").remove();
    // eLyrics adds the songwriters before the lyrics and the publishers'
    // copyright after them.
    const paragraphs = textln(el)
      .split(/\n\s*\n/)
      .filter((p, i, all) => {
        if (i === 0 && /^songwriters?:/i.test(p.trim())) return false;
        if (i === all.length - 1 && /©|ï¿½/.test(p)) return false;
        return true;
      });
    return cleanLyrics(paragraphs.join("\n\n"));
  });
}

// ── Main ─────────────────────────────────────────────────────

/**
 * Sources, by name. Each one can be turned off with LYRICS_DISABLED_SOURCES
 * (comma-separated names): lyrics sites often block datacenter IP addresses
 * while they keep working elsewhere, so they stay in the code. lrclib (an
 * open API) is asked first; the others, in parallel, only when it finds
 * nothing.
 */
const PRIMARY_SOURCES = {
  lrclib: fromLrclib,
};
const SECONDARY_SOURCES = {
  netease: fromNetease,
  genius: fromGenius,
  azlyrics: fromAZLyrics,
  parolesnet: fromParolesNet,
  lyricsmania: fromLyricsMania,
  letras: fromLetras,
  lyricscom: fromLyricsCom,
  elyrics: fromElyrics,
};
const DISABLED_SOURCES = new Set(
  (process.env.LYRICS_DISABLED_SOURCES || "")
    .split(",")
    .map((name) => name.trim().toLowerCase())
    .filter(Boolean),
);
// Per-source outcomes, logged every minute: shows at a glance a source that
// starts failing (blocked, rate-limited, timing out) in production.
const stats = {};
function count(name, outcome) {
  const s = (stats[name] ??= {});
  s[outcome] = (s[outcome] || 0) + 1;
}
function outcomeOf(error) {
  const m = /HTTP (\d+)/.exec(error?.message || "");
  if (m) return m[1] === "404" ? "miss" : "http" + m[1];
  if (error?.name === "TimeoutError" || error?.name === "AbortError") return "timeout";
  return "miss";
}
if (process.env.LYRICS_LOG_SOURCES) {
  setInterval(() => {
    if (Object.keys(stats).length === 0) return;
    console.log("[sources] " + JSON.stringify(stats));
    for (const k of Object.keys(stats)) delete stats[k];
  }, 60_000).unref();
}

// A source that answers 429 or 503 is rate-limiting us: leave it alone for a
// few seconds rather than keep hammering it (and risk a lasting ban).
const COOLDOWN = 5000;
const cooldownUntil = {};

const enabled = (sources) =>
  Object.entries(sources)
    .filter(([name]) => !DISABLED_SOURCES.has(name))
    .map(([name, source]) => (title, artistName) => {
      if (Date.now() < (cooldownUntil[name] || 0)) {
        count(name, "skipped");
        return Promise.reject(Object.assign(new Error(`${name} cooling down`), { unsure: true }));
      }
      return source(title, artistName).then(
        (lyrics) => {
          count(name, "found");
          return lyrics;
        },
        (error) => {
          const outcome = outcomeOf(error);
          if (outcome === "http429" || outcome === "http503") {
            cooldownUntil[name] = Date.now() + COOLDOWN;
          }
          if (outcome !== "miss") error.unsure = true;
          count(name, outcome);
          throw error;
        },
      );
    });

async function lookup(title, artistName) {
  try {
    return await Promise.any(enabled(PRIMARY_SOURCES).map((f) => f(title, artistName)));
  } catch {
    return Promise.any(enabled(SECONDARY_SOURCES).map((f) => f(title, artistName)));
  }
}

// Songs not found stay "not found" for a while, so that apps asking again
// and again for the same unknown song don't hit every source each time.
const MISS_TTL = 6 * 60 * 60 * 1000;
const MISS_MAX = 50000;
const misses = new Map();

function missFresh(key) {
  const at = misses.get(key);
  if (at === undefined) return false;
  if (Date.now() - at > MISS_TTL) {
    misses.delete(key);
    return false;
  }
  return true;
}

// A lookup failed only because a source was rate-limited, down or slow says
// nothing about the song: it must not be cached as a miss.
function unsure(error) {
  return Boolean(error?.unsure || error?.errors?.some(unsure));
}

function missSet(key) {
  misses.delete(key);
  misses.set(key, Date.now());
  while (misses.size > MISS_MAX) misses.delete(misses.keys().next().value);
}

/**
 * Find lyrics for a song by querying multiple sources in parallel.
 * Returns the first successful result.
 * @param {string} title
 * @param {string} artistName
 * @returns {Promise<string>}
 */
function findLyrics(title, artistName) {
  const key = artistName.toLowerCase() + "\n" + title.toLowerCase();
  const cached = cacheGet(key);
  if (cached) return Promise.resolve(cached);
  if (missFresh(key)) return Promise.reject(new Error("No lyrics found (cached)"));

  const promises = [lookup(title, artistName)];

  // If title has parentheses/brackets, also try without them
  if (/\(.*\)/.test(title) || /\[.*\]/.test(title)) {
    const cleanTitle = title.replace(/\(.*\)/g, "").replace(/\[.*\]/g, "").trim();
    promises.push(findLyrics(cleanTitle, artistName));
  }

  // If artist contains separators (feat., &, /), try with just the primary artist
  const primaryArtist = artistName
    .split(/\s*(?:feat\.?|ft\.?|featuring|&|\/|,|;)\s*/i)[0]
    .trim();
  if (primaryArtist && primaryArtist.length > 1 && primaryArtist !== artistName) {
    promises.push(findLyrics(title, primaryArtist));
  }

  // Titles taken from file names often start with a zero-padded track number
  // ("06 Alone", "01. Intro"). Only tried once everything else failed, so a
  // real title such as "99 Luftballons" never loses its number.
  const unnumberedTitle = title.replace(/^0\d\s*[-._)]?\s+(?=\S)/, "");
  let found = Promise.any(promises);
  if (unnumberedTitle !== title && unnumberedTitle.length > 1) {
    found = found.catch(() => findLyrics(unnumberedTitle, artistName));
  }

  return found.then(
    (lyrics) => {
      cacheSet(key, lyrics);
      return lyrics;
    },
    (error) => {
      if (!unsure(error)) missSet(key);
      throw error;
    },
  );
}

module.exports = {
  findLyrics,
  sources: { ...PRIMARY_SOURCES, ...SECONDARY_SOURCES },
};
