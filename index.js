const express = require('express');
const alltomp3 = require('alltomp3');
var things = [];
let appApi = express();
let appFront = express();
const portApi = 8080;
const portFront = 8081;

appApi.get('/v1/:artist/:title', function (req, res) {
  if (!req.params.artist || !req.params.title) {
    return res.status(400).send({error: "Artist or title missing"});
  }
  alltomp3.findLyrics(req.params.title, req.params.artist).then(l => {
    res.send({lyrics: l});
  }).catch(e => {
    console.log(e);
    res.status(404).send({error: "No lyrics found"});
  });
});

appApi.listen(portApi, function () {
  console.log('API listening on port ' + portApi);
});
