const cheerio = require("cheerio");

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

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

function textln(html) {
  html.find("br").replaceWith("\n");
  html.find("script").replaceWith("");
  html.find("#video-musictory").replaceWith("");
  html.find("strong").replaceWith("");
  let text = html.text().trim();
  text = text.replace(/\r\n\n/g, "\n");
  text = text.replace(/\t/g, "");
  text = text.replace(/\n\r\n/g, "\n");
  text = text.replace(/ +/g, " ");
  text = text.replace(/\n /g, "\n");
  return text;
}

function cleanLyrics(text) {
  text = text.trim();
  // Collapse 3+ consecutive newlines into 2 (one blank line)
  text = text.replace(/\n{3,}/g, "\n\n");
  // Remove trailing spaces on each line
  text = text.replace(/ +\n/g, "\n");
  if (text.length < 20) throw new Error("No lyrics found");
  return text;
}

async function fetchHtml(url, options = {}) {
  const res = await fetch(url, {
    headers: { "User-Agent": USER_AGENT },
    redirect: "follow",
    ...options,
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
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
    { headers: { "User-Agent": USER_AGENT } },
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
      let bestHit = hits[0];
      let bestScore = Infinity;
      for (const hit of hits) {
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
  return fetchHtml("https://www.letras.mus.br/" + artist + "/" + song + "/").then(
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
        const link = $el.find("a.lyric-meta-title").attr("href");
        if (link) {
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
      fetchHtml(url).then(($) => {
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

  return Promise.any(promises);
}

module.exports = { findLyrics };
