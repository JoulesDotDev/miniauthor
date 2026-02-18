<p align="center">
  <img src="./public/mini-author-icon.svg" alt="Mini Author .app logo" width="88" height="88" />
</p>

<h1 align="center">Mini Author .app</h1>

<p align="center">
  Minimal, distraction-free, offline-first manuscript editor with Dropbox sync and visual conflict resolution.
</p>

## Overview

Mini Author .app is built for focused long-form writing:

- one continuous manuscript canvas
- clean block-based editing
- local-first autosave (IndexedDB)
- optional Dropbox sync
- merge + visual diff conflict flow when edits overlap

The app is designed so writing works even without a cloud connection. Dropbox is optional.

## Core Features

### Writing experience

- Endless vertical writing strip (single manuscript, no page cards while writing).
- Fixed block types:
  - `Title` (exactly one, always first block, non-removable as structure root)
  - `Heading 1`
  - `Heading 2`
  - `Paragraph`
- Placeholders on empty structural blocks:
  - `Title` on first block
  - starter paragraph placeholder when document body is empty
- Constant typography sizes:
  - Title: `36px`
  - Heading 1: `30px`
  - Heading 2: `24px`
  - Paragraph: `16px`
- Inline styles:
  - Bold
  - Italic
- Selection toolbar appears on text selection (except when selection touches the Title block).

### Focused chrome and menus

- Menus are hidden by default.
- `Esc` toggles menu visibility.
- Floating controls:
  - list/map button (outline panel)
  - menu button (`esc` label on desktop, hamburger/close icon on real iOS/Android devices)
- Floating controls auto-fade on desktop when idle and reappear on pointer movement.
- Small app branding chip (`icon + Mini Author .app + 1.0.0`) appears only while a menu is open.
  - Desktop: top-left
  - Mobile: bottom-left

### Document map (outline)

- Right-side map panel with a tree-like outline.
- Includes: Title, Heading 1, Heading 2 entries.
- Active section highlights in real time based on caret location.
- Click any outline item to jump to that block.

### Sync + offline

- Local-first autosave to IndexedDB after 500ms idle.
- Manual Dropbox sync via button or shortcut (`Cmd/Ctrl + S`).
- Auto sync attempt when coming back online (if Dropbox is connected).
- OAuth PKCE flow with refresh token support (no client secret in frontend).
- Sync target file in Dropbox: `/manuscript.md`.

### Conflict resolution (visual diff)

- Clean non-overlapping edits are merged automatically via 3-way merge.
- Overlapping edits open a full-screen/large modal conflict resolver.
- Per-change actions:
  - Take from Dropbox
  - Take Local
  - Take Both
- Bulk actions:
  - Use All from Dropbox
  - Use All Local
- Per-change Markdown preview with rendered output.
- Save flow requires confirmation (`Save Resolution` -> `Are you sure?`).

### Export

- `Export Manuscript`:
  - One `.md` file with the whole draft.
- `Export Split Pages`:
  - Multiple `.md` files, split by each `Heading 1` boundary.

### Theming and branding

- Light + dark theme with browser preference default.
- Manual theme toggle in Settings.
- 1-second startup splash that respects the correct theme immediately.
- Shared icon used for:
  - splash branding
  - favicon
  - web app icon/manifest icon

### PWA/offline shell

- Service worker caches app shell and same-origin GET responses.
- Manifest included for installable app behavior.
- App icon/manifest branding is set to **Mini Author .app**.

## Keyboard Shortcuts

- `Esc`: open/close right-side menu
- `Cmd/Ctrl + S`: sync now
- `Cmd/Ctrl + B`: bold
- `Cmd/Ctrl + I`: italic
- `Cmd/Ctrl + 1`: Heading 1
- `Cmd/Ctrl + 2`: Heading 2
- `Cmd/Ctrl + 3`: Paragraph
- `Cmd/Ctrl + A`: select current block content (Notion-like block select)
- `Enter`:
  - in Title: jump to starter paragraph or create paragraph below title area as needed
  - in regular blocks: normal next block behavior

## Tech Stack

- React + TypeScript + Vite
- Lexical editor engine
- Tailwind v4 + shadcn styles + custom CSS variables
- IndexedDB for local persistence
- Dropbox HTTP APIs (OAuth + files content endpoints)
- Service worker + web manifest for offline shell/PWA behavior

## Project Structure (high level)

- `src/App.tsx`: app orchestration, menu state, sync/map panels, branding chip
- `src/components/editor/EditorCanvas.tsx`: Lexical editor shell + keyboard/selection behavior
- `src/components/editor/SelectionToolbar.tsx`: floating formatting controls
- `src/components/editor/SyncPanel.tsx`: sync/export/theme/shortcuts UI
- `src/components/editor/MapPanel.tsx`: manuscript outline tree
- `src/components/editor/ConflictModal.tsx`: diff-based conflict resolver
- `src/hooks/useDropboxSync.ts`: local<->Dropbox sync lifecycle
- `src/hooks/useManuscriptEditor.ts`: editor integration state and actions
- `src/lib/merge.ts`: 3-way merge + diff hunks utilities
- `src/lib/markdown.ts`: block <-> markdown conversion and split export logic
- `src/lib/lexical-manuscript.ts`: hard manuscript structure rules for Lexical
- `src/lib/storage.ts`: IndexedDB storage layer

## Setup

### 1. Install

```bash
pnpm install
```

### 2. Configure environment

Create `.env` from `.env.example`:

```bash
cp .env.example .env
```

Set:

```bash
VITE_DROPBOX_APP_KEY=your_dropbox_app_key
VITE_DROPBOX_REDIRECT_URI=http://localhost:5173/
```

Notes:

- `VITE_DROPBOX_APP_KEY` is required only for Dropbox connection.
- `VITE_DROPBOX_REDIRECT_URI` is optional. If omitted, runtime URL is used.
- Redirect URI must exactly match what is configured in Dropbox App Console.

### 3. Run

```bash
pnpm dev
```

## Dropbox App Configuration (Step-by-step)

1. Go to Dropbox App Console.
2. Create app with **Scoped access**.
3. Choose **App folder** access (recommended minimum scope).
4. Enable scopes:
   - `files.content.read`
   - `files.content.write`
5. Add redirect URI(s):
   - `http://localhost:5173/` (dev)
   - your production URL (if deployed)
6. Copy app key -> `VITE_DROPBOX_APP_KEY`.

Implementation details:

- OAuth uses PKCE + `token_access_type=offline`.
- Refresh token is stored locally and used to rotate access tokens.

## Local Data Model

IndexedDB database: `book-writer-db`

Stored keys:

- `manuscript`: blocks + metadata (`updatedAt`, `lastSyncedAt`, base markdown, remote rev)
- `dropbox-token`: token state (access + refresh + expiry)

## Sync and Merge Behavior

### Normal sync

1. Serialize current blocks to markdown.
2. Download `/manuscript.md` from Dropbox.
3. Run 3-way merge: `base` vs `local` vs `dropbox`.
4. If merge is clean:
   - update local editor with merged result
   - upload when remote differs

### First-sync protection

If both local and Dropbox already contain meaningful writing and no prior sync base exists, app opens conflict resolver directly instead of guessing.

### Conflict mode

- Diff hunks are generated line-by-line.
- You choose what to keep per hunk (Dropbox/Local/Both).
- Save writes final resolved markdown back to Dropbox and updates local state.

## Mobile Behavior

- Sync panel and map panel open full-screen.
- Menu button uses hamburger/close icon only on real iOS/Android detection.
- Shortcut list is hidden on real iOS/Android.

## Scripts

- `pnpm dev` - run development server
- `pnpm build` - typecheck + production build
- `pnpm preview` - preview production build locally

## Testing Offline

Service worker is only registered in production builds.

Use:

```bash
pnpm build
pnpm preview
```

Then test with DevTools offline mode / disconnected network.

## Current Scope / Non-goals (for now)

- No real-time multi-user collaboration.
- No Dropbox share-link creation flow yet.
- No backend server; app is frontend-only + Dropbox API calls.

---

If you want, this README can be split next into:
- user guide (`docs/user-guide.md`)
- developer guide (`docs/dev-guide.md`)
- Dropbox setup quick card (`docs/dropbox-setup.md`)
