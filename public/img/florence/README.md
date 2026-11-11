# Florence restaurant photos

Put each photo file in this folder and list it in `photos.json`, keyed by the
place id from `florence.js` (for example `fi:sostanza`). The first photo of a
place is its cover in the app.

```json
{
  "fi:sostanza": [
    { "file": "sostanza-pollo-al-burro.jpg", "credit": "Trattoria Sostanza", "source": "https://…", "license": "used with permission" }
  ]
}
```

- `file`: the file name in this folder (JPEG or WebP, about 1600 px wide, under 400 KB).
- `credit`: shown under the photo as "Photo: …".
- `source` and `license`: where it came from and on what terms. Only add photos
  the app may use: your own, the restaurant's with permission, or freely
  licensed ones (for example Wikimedia Commons, with the photographer credited).

A place with no photo here shows a nearby Wikimedia Commons photo, or drawn art.
The server reads this list when it starts, so redeploy after changing it.
