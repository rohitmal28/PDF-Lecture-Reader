# PDF Lecture Reader — download website

The website people use to download PDF Lecture Reader. It counts every completed download.

No packages to install. It only needs **Node.js 18 or newer** (https://nodejs.org).

## Run it on this computer

Double-click **`Start website.cmd`**. It opens http://localhost:8080 in your browser.

Or from a terminal in this folder:

```
node server.js
```

Stop it with **Ctrl+C**, or by closing its window.

## Pages

| Address | What it is |
|---|---|
| `/` | Home page with the download button and live counter |
| `/download/windows` | Downloads the latest installer (counted) |
| `/download/1.0.0` | Downloads a specific version (counted) |
| `/stats` | Download stats: all time, last 7 days, today, last 30 days |
| `/license` | The end user license agreement |
| `/api/stats` | The numbers as JSON |

## How the counter works

- A download is counted when the **whole installer** has been sent. Cancelled downloads are not counted.
- Resumed downloads (Range requests) and repeat clicks from the same address within 15 seconds are not counted again.
- Counts are saved in `data/downloads.json` (with a `.bak` backup). Don't delete this folder, or the count starts from 0.
- Days are counted in India time (UTC+05:30).

## Where the installer goes

The server looks for each installer listed in `releases.json` in:

1. the `downloads` folder, then
2. the folder above this one (where it is now on your PC).

When you publish the site, copy the `.exe` into `downloads`.

## Releasing a new version

1. Put the new installer, for example `PDF-Lecture-Reader-Setup-1.1.0.exe`, in `downloads`.
2. Add it to the **top** of `releases.json` (the first available entry is "latest"):
   ```json
   { "version": "1.1.0", "file": "PDF-Lecture-Reader-Setup-1.1.0.exe",
     "platform": "Windows 10 and 11, 64-bit", "released": "2026-12-01",
     "notes": ["What changed"] }
   ```
   Dates in this file are written YYYY-MM-DD. The site shows them as DD/MM/YYYY.
3. Restart the server. Old versions stay downloadable at `/download/<version>`.

## Publishing it later

The counter needs a server that runs Node.js and keeps files between restarts. Static hosts such as GitHub Pages or plain Netlify will show the page but **cannot count downloads**.

Good options: a small VPS (DigitalOcean, Hetzner, AWS Lightsail, Oracle Cloud free tier), or Render / Railway with a persistent disk.

On the server:

```
HOST=0.0.0.0 PORT=8080 node server.js
```

| Setting | Default | Meaning |
|---|---|---|
| `PORT` | `8080` | Port to listen on |
| `HOST` | `127.0.0.1` | Use `0.0.0.0` so other computers can reach it |
| `DATA_DIR` | `./data` | Where the counter is saved; point it at the persistent disk |
| `TRUST_PROXY` | off | Set to `1` behind Nginx, Cloudflare or a platform proxy so repeat clicks are matched by the visitor's real address |

Put HTTPS in front of it (Caddy, Nginx with Let's Encrypt, or the platform's built-in HTTPS). Browsers warn about `.exe` downloads from plain `http://` sites.

The installer is about 78 MB, so check your host's bandwidth allowance.
