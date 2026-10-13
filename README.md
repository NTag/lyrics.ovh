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

[LRCLIB](https://lrclib.net), an open lyrics database with a free API, is asked
first. When it has nothing, the other sources are queried in parallel and the
first result wins:

- [LRCLIB](https://lrclib.net) (first)
- [NetEase Cloud Music](https://music.163.com)
- [eLyrics.net](https://www.elyrics.net)
- [Genius](https://genius.com)
- [AZLyrics](https://www.azlyrics.com)
- [Paroles.net](https://www.paroles.net)
- [LyricsMania](https://www.lyricsmania.com)
- [Letras.mus.br](https://www.letras.mus.br)
- [Lyrics.com](https://www.lyrics.com)

Lyrics sites often block datacenter IP addresses while they keep working from
other networks. Turn sources off with `LYRICS_DISABLED_SOURCES`, a
comma-separated list of names: `lrclib`, `netease`, `elyrics`, `genius`,
`azlyrics`, `parolesnet`, `lyricsmania`, `letras`, `lyricscom`. lyrics.ovh's
own server runs with `genius,azlyrics,lyricsmania,letras,lyricscom` disabled.

Results are cached in memory, and so are misses (for 6 hours), so that clients
asking again and again for an unknown song don't hit every source each time.

## Docker

```
docker build -t lyrics.ovh .
docker run -p 8080:8080 -p 8081:8081 lyrics.ovh
```
