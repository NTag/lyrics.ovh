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
    const el = $(".song-text");
    if (el.length === 0) throw new Error("Not found");
    // Remove header and ad divs that are mixed into lyrics
    el.find("h2").remove();
    el.find("div[id], div[class]").remove();
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

// ── Main ─────────────────────────────────────────────────────

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

  const promises = [
    fromGenius(title, artistName),
    fromAZLyrics(title, artistName),
    fromParolesNet(title, artistName),
    fromLyricsMania(title, artistName),
    fromLetras(title, artistName),
    fromLyricsCom(title, artistName),
  ];

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

  return Promise.any(promises).then((lyrics) => {
    cacheSet(key, lyrics);
    return lyrics;
  });
}

module.exports = { findLyrics };
