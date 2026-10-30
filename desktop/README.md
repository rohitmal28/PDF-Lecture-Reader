# PDF Lecture Reader — desktop app source

The Electron app behind the Windows installer, now also set up for macOS.

| Folder | What it is |
|---|---|
| `app/` | The app: `main.js` (window, menus, file opening), `preload.js`, `index.html` (the whole reader, with PDF.js inlined), fonts, icon |
| `build/` | Build resources: the icon and the ad-hoc signing step for Mac |
| `resources/` | `LICENSE.txt` and `THIRD-PARTY-NOTICES.txt`, copied next to the app |

## Run it from source

```
npm install
npm start
```

If the installed app is already open, close it first: only one copy runs at a time.

## Build the Mac version

A Mac app has to be built on a Mac. You don't need one: GitHub builds it.

1. Push this repository to GitHub.
2. Open the repository's **Actions** tab, pick **Build Mac app**, click **Run workflow**.
3. After about 10 minutes, open the finished run and download **PDF-Lecture-Reader-mac** at the bottom.
   Inside is `PDF-Lecture-Reader-1.0.0-mac.dmg`.

To publish it, attach the DMG to a release on the repository's **Releases** page, and put its size and sha256 in the website's `releases.json`.

On a Mac you can also build it yourself: `npm ci && npm run dist:mac`.

The DMG is **universal**: one file for Apple Silicon (M1–M4) and Intel Macs, macOS 11 Big Sur or newer.

## Opening it on a Mac the first time

The app is not signed with a paid Apple Developer ID (USD 99/year), so macOS blocks it the first time:

1. Open the DMG and drag **PDF Lecture Reader** onto **Applications**.
2. Open it from Applications. macOS says it "cannot be opened" / "could not verify". Click **Done** (not Move to Bin).
3. Open **System Settings → Privacy & Security**, scroll down, click **Open Anyway** next to PDF Lecture Reader, and confirm.

After that it opens normally. To remove the warning for everyone, sign it with a Developer ID and notarize it: set `mac.identity`, `hardenedRuntime: true` and `notarize` in `package.json`, and delete `build/adhoc-sign.js`.

## Mac differences

- Menus follow Mac conventions (app menu with About and Quit, Edit and Window menus, ⌘ shortcuts, ⌃⌘F full screen).
- PDFs open from Finder with **right-click → Open With → PDF Lecture Reader**, or by dropping them on the Dock icon. The app doesn't make itself the default PDF app.
- Closing the window keeps the app in the Dock, like other Mac apps.
- Voices come from macOS. Better ones: **System Settings → Accessibility → Spoken Content → System voice → Manage Voices**, then pick an English (India) or "Enhanced" voice and restart the app. macOS's novelty voices (Bells, Zarvox…) are hidden.
