const cheerio = require("cheerio");

/**
 * Simple Levenshtein distance implementation
 */
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

function lyricsUrl(title) {
  return kebabCase(deburr(title.trim().toLowerCase()));
}

function lyricsManiaUrl(title) {
  return snakeCase(deburr(title.trim().toLowerCase()));
}

function lyricsManiaUrlAlt(title) {
  title = title.trim().toLowerCase();
  title = title.replace(/'/g, "");
  title = title.replace(/ /g, "_");
  title = title.replace(/_+/g, "_");
  return title;
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

async function fetchAndParse(url, options = {}) {
  const res = await fetch(url, options);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const body = await res.text();
  return cheerio.load(body);
}

/**
 * Find lyrics for a song by querying multiple sources
 * @param {string} title
 * @param {string} artistName
 * @returns {Promise<string>}
 */
async function findLyrics(title, artistName) {
  const promises = [];

  const reqWikia = fetchAndParse(
    "http://lyrics.wikia.com/wiki/" +
      encodeURIComponent(artistName) +
      ":" +
      encodeURIComponent(title),
  ).then(($) => textln($(".lyricbox")));

  const reqParolesNet = fetchAndParse(
    "http://www.paroles.net/" +
      lyricsUrl(artistName) +
      "/paroles-" +
      lyricsUrl(title),
  ).then(($) => {
    if ($(".song-text").length === 0) throw new Error("Not found");
    return textln($(".song-text"));
  });

  const reqLyricsMania1 = fetchAndParse(
    "http://www.lyricsmania.com/" +
      lyricsManiaUrl(title) +
      "_lyrics_" +
      lyricsManiaUrl(artistName) +
      ".html",
  ).then(($) => {
    if ($(".lyrics-body").length === 0) throw new Error("Not found");
    return textln($(".lyrics-body"));
  });

  const reqLyricsMania2 = fetchAndParse(
    "http://www.lyricsmania.com/" +
      lyricsManiaUrl(title) +
      "_" +
      lyricsManiaUrl(artistName) +
      ".html",
  ).then(($) => {
    if ($(".lyrics-body").length === 0) throw new Error("Not found");
    return textln($(".lyrics-body"));
  });

  const reqLyricsMania3 = fetchAndParse(
    "http://www.lyricsmania.com/" +
      lyricsManiaUrlAlt(title) +
      "_lyrics_" +
      encodeURIComponent(lyricsManiaUrlAlt(artistName)) +
      ".html",
  ).then(($) => {
    if ($(".lyrics-body").length === 0) throw new Error("Not found");
    return textln($(".lyrics-body"));
  });

  const reqSweetLyrics = fetchAndParse(
    "http://www.sweetslyrics.com/search.php",
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ search: "title", searchtext: title }),
    },
  )
    .then(($) => {
      let closestLink,
        closestScore = -1;
      $(".search_results_row_color").each((_, e) => {
        const artist = $(e)
          .text()
          .replace(/ - .+$/, "");
        const currentScore = levenshtein(artistName, artist);
        if (closestScore === -1 || currentScore < closestScore) {
          closestScore = currentScore;
          closestLink = $(e).find("a").last().attr("href");
        }
      });
      if (!closestLink) throw new Error("Not found");
      return fetchAndParse("http://www.sweetslyrics.com/" + closestLink);
    })
    .then(($) => textln($(".lyric_full_text")));

  if (/\(.*\)/.test(title) || /\[.*\]/.test(title)) {
    promises.push(
      findLyrics(
        title.replace(/\(.*\)/g, "").replace(/\[.*\]/g, ""),
        artistName,
      ),
    );
  }

  promises.push(reqWikia);
  promises.push(reqParolesNet);
  promises.push(reqLyricsMania1);
  promises.push(reqLyricsMania2);
  promises.push(reqLyricsMania3);
  promises.push(reqSweetLyrics);

  return Promise.any(promises);
}

module.exports = { findLyrics };
