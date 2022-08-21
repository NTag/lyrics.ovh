const express = require("express");
const alltomp3 = require("alltomp3");
const request = require("request-promise");
const cors = require("cors");
var things = [];
let appApi = express();
let appFrontend = express();
const portApi = 8080;
const portFrontend = 8081;

appApi.use(cors());

appApi.get("/v1/:artist/:title", function (req, res) {
  if (!req.params.artist || !req.params.title) {
    return res.status(400).send({ error: "Artist or title missing" });
  }
  alltomp3
    .findLyrics(req.params.title, req.params.artist)
    .then((l) => {
      res.send({ lyrics: l });
    })
    .catch((e) => {
      // console.log(e);
      res.status(404).send({ error: "No lyrics found" });
    });
});

appApi.get("/suggest/:term", function (req, res) {
  request({
    uri: "http://api.deezer.com/search?limit=15&q=" + req.params.term,
    json: true,
  }).then((results) => {
    res.send(results);
  });
});

appFrontend.use(express.static("frontend"));

appApi.listen(portApi, function () {
  console.log("API listening on port " + portApi);
});

appFrontend.listen(portFrontend, function () {
  console.log("Frontend listening on port " + portFrontend);
});
