const express = require("express");
const { findLyrics } = require("./lyrics");
const cors = require("cors");

const appApi = express();
const appFrontend = express();
const portApi = 8060;
const portFrontend = 8061;

appApi.use(cors());

appApi.get("/v1/:artist/:title", function (req, res) {
  if (!req.params.artist || !req.params.title) {
    return res.status(400).send({ error: "Artist or title missing" });
  }
  findLyrics(req.params.title, req.params.artist)
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
