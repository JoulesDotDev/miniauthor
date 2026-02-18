# Book Writer

Minimal, distraction-free writing app for long-form manuscripts.

## What It Does

- One endless A4-like writing strip
- Block-by-block markdown editing (`title`, `heading`, `paragraph`)
- Hidden UI by default; toggle controls with `Alt/Option`
- Left panel shortcut reference, right panel sync/export
- Top-center page counter (`current/total`) visible only when controls are shown
- Offline-first persistence with IndexedDB
- Dropbox OAuth + file sync (app-folder CRUD)
- Auto 3-way merge on reconnect, with conflict diff fallback
- Split export by section headline boundaries into multiple markdown files
- Service worker cache for offline app shell

## Run

```bash
pnpm install
pnpm dev
```

## Dropbox Setup (What You Need To Do)

1. Create a Dropbox app in the Dropbox App Console.
2. Choose scoped access and set permissions:
   - `files.content.read`
   - `files.content.write`
3. Enable offline access / refresh tokens.
4. Add a redirect URI:
   - Local: `http://localhost:5173/`
   - Production: your deployed app URL
5. Copy your Dropbox app key.
6. Create `.env` from `.env.example` and fill values.

## Environment Variables

```bash
VITE_DROPBOX_APP_KEY=your_dropbox_app_key
VITE_DROPBOX_REDIRECT_URI=http://localhost:5173/
```

If `VITE_DROPBOX_REDIRECT_URI` is omitted, the app uses the current page URL.

## Sync Model

- Local writing is always saved first in IndexedDB.
- On sync/reconnect, app reads/writes one Dropbox file:
  - `manuscript.md`
- A single main headline (`#`) is always kept as the first block.
- Section headlines (`##`) are treated as automatic page starts for page counting and split export.
- Merge strategy:
  - clean non-overlapping changes auto-merge
  - overlapping edits open side-by-side diff resolver
- Conflict resolver lets you choose local/remote/base or edit resolved markdown manually.

## Keyboard Shortcuts

- `Alt/Option`: Toggle settings panels + page counter
- `Cmd/Ctrl + S`: Sync now
- `Cmd/Ctrl + B`: Toggle bold formatting
- `Cmd/Ctrl + I`: Toggle italic formatting
- `Cmd/Ctrl + 1`: Section headline block
- `Cmd/Ctrl + 2`: Paragraph block
- `Cmd/Ctrl + A`: Select current block content
- `Enter`: New paragraph block

## Notes

- Editor engine is now Lexical for stable caret/selection behavior and block-level formatting controls.
