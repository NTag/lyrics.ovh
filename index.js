const express = require("express");
const { findLyrics } = require("./lyrics");
const cors = require("cors");

const appApi = express();
const appFrontend = express();
const portApi = 8080;
const portFrontend = 8081;

appApi.use(cors());

// Decode + as space in path params (some clients use + instead of %20)
appApi.use("/v1", function (req, res, next) {
  req.url = req.url.replace(/\+/g, "%20");
  next();
});

const GARBAGE = new Set([
  "artist",
  "title",
  "unknown",
  "undefined",
  "null",
  "no song playing",
  "_",
  "",
]);

appApi.get("/v1/:artist/:title", function (req, res) {
  const artist = req.params.artist;
  const title = req.params.title;
  if (!artist || !title) {
    return res.status(400).send({ error: "Artist or title missing" });
  }
  if (GARBAGE.has(artist.toLowerCase()) || GARBAGE.has(title.toLowerCase())) {
    return res.status(400).send({ error: "Invalid artist or title" });
  }
  findLyrics(title, artist)
    .then((l) => {
      res.send({ lyrics: l });
    })
    .catch((e) => {
      res.status(404).send({ error: "No lyrics found" });
    });
});

appApi.get("/suggest/:term", async function (req, res) {
  try {
    const response = await fetch(
      "http://api.deezer.com/search?limit=15&q=" +
        encodeURIComponent(req.params.term),
    );
    const results = await response.json();
    res.send(results);
  } catch (e) {
    res.status(500).send({ error: "Failed to fetch suggestions" });
  }
});

appFrontend.use(express.static("frontend"));

appApi.listen(portApi, function () {
  console.log("API listening on port " + portApi);
});

appFrontend.listen(portFrontend, function () {
  console.log("Frontend listening on port " + portFrontend);
});
