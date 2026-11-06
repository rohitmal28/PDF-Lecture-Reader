# StudyDesk PDF — desktop app source

StudyDesk PDF (formerly PDF Lecture Reader) has two parts: **Lecture Reader** (reads PDFs aloud) and **PDF Tools** (merge, images to PDF, edit).

The Electron app behind the Windows installer, now also set up for macOS.

| Folder | What it is |
|---|---|
| `app/` | The app: `main.js` (window, menus, file opening, saving), `preload.js`, `index.html` (the whole reader, with PDF.js inlined), `tools.js` + `tools.css` (merge, images to PDF, editor), `pdf-lib.min.js`, fonts, icon |
| `build/` | Build resources: the icon, the ad-hoc signing step for Mac, and `installer.nsh` (extra Windows installer steps) |
| `resources/` | `LICENSE.txt` and `THIRD-PARTY-NOTICES.txt`, copied next to the app |

## Run it from source

```
npm install
npm start
```

If the installed app is already open, close it first: only one copy runs at a time.

## PDF tools

`tools.js` adds Merge PDFs, Images to PDF and Edit a PDF. The same file (with `tools.css` and `pdf-lib.min.js`) is used by the browser extension, so copy it there when it changes. pdf.js shows the pages; [pdf-lib](https://pdf-lib.js.org) 1.17.1 writes the new PDF. In the app, File › Merge PDFs / Images to PDF / Edit PDF (Ctrl+E) open them, and the right-click menu in File Explorer has "Edit with StudyDesk PDF" (starts the app with `--edit`).

## Build the Windows installer

On Windows:

```
npm ci
npm run dist:win
```

This makes `dist/StudyDesk-PDF-Setup-<version>.exe`: license page, install just for you or for everyone, choice of folder, an extras page (desktop shortcut, right-click menu for PDFs), Start menu shortcut and uninstaller. It uses the Apps entry `PDFLectureReader`, so it installs over 1.0.0 and later versions. Copy the .exe into the website's `downloads` folder and add it to `releases.json`.

## Microsoft Store (installs without the "Windows protected your PC" warning)

`npm run dist:store` makes `dist/StudyDesk-PDF-<version>-store.appx`. The Store signs it, so no certificate is needed here.

1. Create a free individual developer account at https://partner.microsoft.com/dashboard (Apps and games).
2. Create a new app and reserve the name **StudyDesk PDF**.
3. Open **Product management → Product identity** and copy three values into `package.json` → `build.appx`:
   `Package/Identity/Name` → `identityName`, `Package/Identity/Publisher` → `publisher` (starts with `CN=`), `Package/Properties/PublisherDisplayName` → `publisherDisplayName`.
4. Run `npm run dist:store` again and upload the .appx in a new submission (category Productivity or Education, free, age rating questionnaire, screenshots).
5. When it is live, put the Store link on the website's Windows download card.

The Store version opens PDFs from inside the app; the File Explorer right-click entries come only with the regular installer.

## Build the Mac version

A Mac app has to be built on a Mac. You don't need one: GitHub builds it.

1. Push this repository to GitHub.
2. Open the repository's **Actions** tab, pick **Build Mac app**, click **Run workflow**.
3. After about 10 minutes, open the finished run and download **StudyDesk-PDF-mac** at the bottom.
   Inside is `StudyDesk-PDF-<version>-mac.dmg`.

To publish it, attach the DMG to a release on the repository's **Releases** page, and put its size and sha256 in the website's `releases.json`.

On a Mac you can also build it yourself: `npm ci && npm run dist:mac`.

The DMG is **universal**: one file for Apple Silicon (M1–M4) and Intel Macs, macOS 11 Big Sur or newer.

## Opening it on a Mac the first time

The app is not signed with a paid Apple Developer ID (USD 99/year), so macOS blocks it the first time:

1. Open the DMG and drag **StudyDesk PDF** onto **Applications**.
2. Open it from Applications. macOS says it "cannot be opened" / "could not verify". Click **Done** (not Move to Bin).
3. Open **System Settings → Privacy & Security**, scroll down, click **Open Anyway** next to StudyDesk PDF, and confirm.

After that it opens normally. To remove the warning for everyone, sign it with a Developer ID and notarize it: set `mac.identity`, `hardenedRuntime: true` and `notarize` in `package.json`, and delete `build/adhoc-sign.js`.

## Mac differences

- Menus follow Mac conventions (app menu with About and Quit, Edit and Window menus, ⌘ shortcuts, ⌃⌘F full screen).
- PDFs open from Finder with **right-click → Open With → StudyDesk PDF**, or by dropping them on the Dock icon. The app doesn't make itself the default PDF app.
- Closing the window keeps the app in the Dock, like other Mac apps.
- Voices come from macOS. Better ones: **System Settings → Accessibility → Spoken Content → System voice → Manage Voices**, then pick an English (India) or "Enhanced" voice and restart the app. macOS's novelty voices (Bells, Zarvox…) are hidden.
