# lyrics.ovh: Only the lyrics

Source of the website https://lyrics.ovh — find the lyrics for any song, quickly and without ads.

A Chrome Extension is also available, thanks to Varal7: https://github.com/Varal7/lyrics-chrome-extension.

## API

An API is available to get the lyrics of a song:

```
GET https://api.lyrics.ovh/v1/{artist}/{title}
```

Returns `{ "lyrics": "..." }` or a 404 error.

A suggestion endpoint is also available:

```
GET https://api.lyrics.ovh/suggest/{search term}
```

Returns search results from Deezer.

## How to start

```
npm install
node .
```

Then uncomment line 6 of `frontend/search.js` to use the local API.

- Frontend: http://localhost:8081
- API: http://localhost:8080

## Lyrics sources

Lyrics are fetched from multiple sources in parallel, and the first result wins:

- [Genius](https://genius.com)
- [AZLyrics](https://www.azlyrics.com)
- [Paroles.net](https://www.paroles.net)
- [LyricsMania](https://www.lyricsmania.com)
- [Letras.mus.br](https://www.letras.mus.br)
- [Lyrics.com](https://www.lyrics.com)

## Docker

```
docker build -t lyrics.ovh .
docker run -p 8080:8080 -p 8081:8081 lyrics.ovh
```
