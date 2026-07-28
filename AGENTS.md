# 轻松记 Project Rules

## Project Shape

- This is a small static PWA for Easy Note / 轻松记.
- Main UI and behavior live in `index.html`, `style.css`, `app.js`, and `api.js`.
- Supabase auth and sync live in `supabase-sync.js`, with public config in `supabase-config.js`.
- Service worker behavior lives in `sw.js`; update cache strategy/version carefully when release behavior changes.

## Local Development

- Serve the repo root with `python3 -m http.server 4173`.
- Open `http://127.0.0.1:4173/`.
- For local UI testing, use the localhost-only `本地测试，不登录` entry instead of changing production login logic.

## Verification

- Run `node --test tests/*.test.mjs` after behavior, storage, sync, security, or parser changes.
- Run `node --check app.js` after JS edits.
- Run `node --check api.js` after API/prompt/parser edits.
- For frontend behavior changes, test in a browser with service workers disabled or a cache-busting URL to avoid stale `sw.js` cache.

## Engineering Notes

- Do not change Supabase auth or sync behavior unless the task explicitly asks for it.
- Preserve user data semantics: Supabase data is keyed by user, while local dev mode stays local only.
- Keep UI hierarchy quiet and mobile-first; records and timelines are secondary to capture, summary, and board actions.
- Do not commit `.DS_Store`.
