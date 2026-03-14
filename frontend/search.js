"use strict";

var apiUrl = "https://api.lyrics.ovh";
// var apiUrl = "http://localhost:8060";

var searchInput = document.getElementById("search-input");
var resultsList = document.getElementById("results");
var lyricsDiv = document.getElementById("lyrics");
var debounceTimer;

searchInput.addEventListener("input", function () {
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(fetchSuggestions, 300);
});

function clearResults() {
  resultsList.innerHTML = "";
}

function escapeHtml(str) {
  var div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

function fetchSuggestions() {
  var term = searchInput.value.trim();
  if (!term) {
    clearResults();
    return;
  }

  fetch(apiUrl + "/suggest/" + encodeURIComponent(term))
    .then(function (res) {
      return res.json();
    })
    .then(function (data) {
      clearResults();
      if (!data.data) return;

      var seen = [];
      var count = 0;

      data.data.forEach(function (item) {
        if (count >= 5) return;
        var key = item.title + " - " + item.artist.name;
        if (seen.indexOf(key) >= 0) return;
        seen.push(key);
        count++;

        var li = document.createElement("li");
        li.className = "result";
        li.textContent = key;
        li.addEventListener("click", function () {
          fetchLyrics(item.artist.name, item.title, key);
        });
        resultsList.appendChild(li);
      });
    });
}

function fetchLyrics(artist, title, display) {
  clearResults();
  searchInput.value = display;

  lyricsDiv.innerHTML = '<div class="loading">Searching lyrics...</div>';

  fetch(
    apiUrl +
      "/v1/" +
      encodeURIComponent(artist) +
      "/" +
      encodeURIComponent(title),
  )
    .then(function (res) {
      return res.json();
    })
    .then(function (data) {
      if (data.error) {
        lyricsDiv.innerHTML = '<div class="error">No lyrics found.</div>';
        return;
      }

      var html = '<h2 class="lyrics-title">' + escapeHtml(display) + "</h2>";
      html += '<div class="lyrics-actions">';
      html += '<button class="copy-btn" id="copy-btn">Copy lyrics</button>';
      html += "</div>";
      html +=
        '<div class="lyrics-text" id="lyrics-text">' +
        escapeHtml(data.lyrics) +
        "</div>";

      lyricsDiv.innerHTML = html;

      document
        .getElementById("copy-btn")
        .addEventListener("click", function () {
          navigator.clipboard.writeText(data.lyrics).then(function () {
            document.getElementById("copy-btn").textContent = "Copied!";
            setTimeout(function () {
              document.getElementById("copy-btn").textContent = "Copy lyrics";
            }, 2000);
          });
        });
    })
    .catch(function () {
      lyricsDiv.innerHTML = '<div class="error">Something went wrong.</div>';
    });
}
