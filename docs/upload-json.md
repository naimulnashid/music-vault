# Song details as JSON

The upload screen on every app can fill a song's details from pasted JSON. Use
**Paste details** at the top of the upload screen to fill every file a pasted
song matches by title, or the paste button on one file to fill just that file.
Only the fields you include change, and every field stays editable before you
upload.

The parser is [packages/core/src/uploadJson.ts](../packages/core/src/uploadJson.ts)
(Android: `data/vault/UploadJson.kt`).

## Template

One song:

```json
{
  "title": "",
  "artist": "",
  "featured_artists": "",
  "album": "",
  "genre": "",
  "subgenre": "",
  "secondary_genres": "",
  "mood": "",
  "vocals": "",
  "language": "",
  "country": "",
  "release_date": "YYYY-MM-DD",
  "lyrics": "",
  "synced_lyrics": "[00:12.00] First line\n[00:15.50] Second line"
}
```

Several songs are an array of these: `[ { … }, { … } ]`.

## Fields

| Key | What it holds | Several values |
|---|---|---|
| `title` | The song's title; also how a pasted song finds its file | |
| `artist` | Main artists | yes |
| `featured_artists` | Guest artists | yes |
| `album` | Album | |
| `genre` | Main genre | yes |
| `subgenre` | A narrower genre | |
| `secondary_genres` | Other genres the song belongs to | yes |
| `mood` | How the song feels, such as `Romantic, Yearning` | yes |
| `vocals` | `Male`, `Female`, `Male and Female` or `Instrumental` | |
| `language` | Language | yes |
| `country` | The singer's country (a duet lists both) | yes |
| `release_date` | `2019`, `2019-05` or `2019-05-14`; a number such as `2019` works too | |
| `lyrics` | Plain lyrics | |
| `synced_lyrics` | Timed lyrics as LRC lines, `[mm:ss.xx] text`, one per line (`\n` in JSON) | |

"Several values" fields take a comma-separated string (`"Hindi, Punjabi"`) or
an array (`["Hindi", "Punjabi"]`); both are stored as `Hindi, Punjabi`.

## Rules

- A key that is missing, `null` or `""` leaves that field as it was (the
  file's own tag, or what you typed). The template's placeholders
  (`YYYY-MM-DD` and the sample LRC lines) count as empty too.
- Pasted lyrics replace the file's own lyrics, and appear as editable fields
  on that file once pasted.
- **Paste details** at the top pairs each pasted song with the file whose
  title matches (ignoring case, accents and punctuation), else whose file name
  does. One pasted song and one file pair up whatever their titles. Songs that
  match no file are listed so you can paste them on that file directly.
- Keys the upload form has no field for, such as links to covers or lyrics,
  are ignored and named in the result. Covers are chosen with the cover
  picker as before.

## Names from a research file

A metadata file with these names works as it is:

| Its key | Fills |
|---|---|
| `track_title` | `title` |
| `primary_genre` | `genre` |
| `vocal_type` | `vocals` |
| `languages` | `language`, when `language` is empty |
| `plain_lyrics` | `lyrics` |
| `synchronized_lyrics` | `synced_lyrics` |
