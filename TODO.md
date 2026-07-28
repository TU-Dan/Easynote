# Project TODOs

## Status (updated 2026-07-17)

**Done & deployed:**
- Batch 1 — #1 kanban shows ☐/☑ records without summary + rolling 7-day; #2 keyboard collapses on save; #3 records compact/timestamped/expandable/swipe-delete
- Batch 2 — #4 Today page auto-organizes (hash-gated) + auto-adds to kanban; #5 kanban keyword search; #6 TODO prompt + parser hardened (cross-section dedup, completion wins, strips numbering/☐☑)
- Batch 3 — #7 letter archive (信箱); #8 elegant "warm stationery" letter view; #9 share letter (native share / clipboard, letter text + date only); #10 swipe-right to go back
- Bug fix — kanban: completed cards could not be un-checked (record re-materialized them); fixed
- Letter length shortened (2-3 short paragraphs, 150-280 chars)
- #16 launch splash removes login-screen flash
- #17 + #18 Today organize no longer resurfaces old/completed kanban items
- Security hardening — static-only Service Worker cache, escaped Markdown, explicit sync tombstones
- Reliability — safe local-data recovery, tested sync/kanban/storage modules, accessible dialogs and forms
- #13 switched production HTTPS from interim port 8443 to standard 443 (8443 retained temporarily for old PWA clients)

**Pending:**
- #11 server-side scheduled daily letter at 23:00 CST (after deploy/filing)
- **#12 automatic database backup — HIGH PRIORITY (data is still single-copy on the server, no backup yet)**
- #14 security cleanup (reset the cloud DB password exposed during migration; least-privilege CAM key for acme.sh)
- #15 research: voice-to-text vs rely on keyboard dictation

Detailed specs below (kept for reference).

## Batch 1: Capture + raw-record kanban visibility

These should be done together because they all touch the home capture flow, raw records, and how records become actionable items before AI summary generation.

### 1. Fix: kanban is empty before generating a daily summary

Problem:
- When the user has not clicked "生成总结", the kanban page can be empty.
- Switching the kanban date filter to "近 7 日" still does not show any records.

Expected behavior:
- The kanban should not depend on generating a daily summary.
- Rename the kanban date filter from "本周" to "近 7 日".
- The "近 7 日" filter should use a rolling 7-day window, not calendar-week boundaries.
- The "近 7 日" filter should show relevant unfinished and finished items that already exist in records or kanban storage.
- Raw records with checkbox markers (`☐` / `☑`) should be visible as kanban candidates before summary generation.

Acceptance criteria:
- Add records containing `☐` or `☑`.
- Do not click "生成总结".
- Open kanban and switch to "近 7 日".
- Relevant items are visible, with correct open/done status.

### 2. Fix: keyboard should collapse after saving a home record

Problem:
- After recording from the home page, the keyboard can stay open.

Expected behavior:
- Tapping the save button saves the record and collapses the keyboard.
- Tapping the keyboard check/done action also saves the record and collapses the keyboard.

Acceptance criteria:
- On mobile, enter text on the home page.
- Tap "保存"; the record is saved and the keyboard closes.
- Enter text again; tap the keyboard check/done action; the record is saved and the keyboard closes.

### 3. Update: home records should be compact, timestamped, expandable, and deletable

Expected behavior:
- Home page records show time for each item.
- Each record shows one line by default.
- Long records are collapsed; tapping a record expands/collapses it.
- Left swipe deletes a record.

Acceptance criteria:
- A long record appears as one line by default.
- Tapping it expands the full content.
- Swiping left reveals delete, and deleting updates local + synced data.

## Batch 2: Today automation + kanban intelligence

These should be done together because they change the contract between today's summary, generated TODOs, and the kanban.

### 4. Update: entering the Today page should automatically organize today

Expected behavior:
- Opening the Today page automatically generates today's整理 when needed.
- After整理 finishes, recognized actionable items are automatically added to the kanban.
- If the app detects meaningful edits to today's records or summary, it should regenerate/reorganize and update the kanban without creating duplicates.
- "重新整理" and "编辑" controls should be placed at the top of the Today page, because they are primary actions.

Acceptance criteria:
- Add records, then open Today.
- The app starts organizing without manually tapping "生成总结".
- Recognized open/done items are added to kanban automatically.
- Editing today's content triggers a clean update, reusing existing kanban IDs where possible.

### 5. Update: kanban supports keyword search

Expected behavior:
- Kanban has a keyword search input.
- Search works together with type, status, and date filters.
- Search should match card text and useful metadata such as date/type where appropriate.

Acceptance criteria:
- Search a keyword that appears in a card.
- Only matching cards remain visible.
- Clearing search restores the filtered list.

### 6. Optimize: generated TODO prompt is unstable

Problem:
- The generated TODO output is inconsistent and sometimes misclassifies items.

Expected behavior:
- Improve the prompt and parser contract for TODO extraction.
- The model should preserve user intent, distinguish open vs done, and avoid inventing tasks.
- The output format should be stable enough for automatic kanban insertion.

Acceptance criteria:
- Records with mixed `☐`, `☑`, reminders, thoughts, and plain text produce consistent sections.
- Completed items are not re-added as open TODOs.
- Similar regenerated TODOs reuse existing kanban items instead of multiplying duplicates.

## Batch 3: Daily letter archive + sharing

These should be done together because they define the "letter" experience, archive UI, reflection, and sharing.

### 7. Feature: automatic daily summary archive

Goal:
- Automatically generate one daily summary every day.
- Store it as an archived "letter" that the user can revisit later.

Experience:
- The archive should feel like a folder of daily letters.
- Each daily summary should be a one-page, readable artifact, not just a utility output.
- Users can open past summaries at any time.
- Users can add extra reflections or follow-up thoughts to an archived day.

Data expectations:
- Each archived summary belongs to a user ID.
- Each day should have one primary summary artifact.
- User-added reflections should be stored separately from the generated summary text, so regeneration does not overwrite personal notes.

Acceptance criteria:
- A daily summary can be generated without the user manually pressing the button.
- Past summaries are listed by date.
- Opening a past date shows the generated summary in a letter-like reading layout.
- The user can add or edit extra thoughts for that day.

### 8. Update: letter view should feel more like an elegant letter

Expected behavior:
- The mailbox letter detail page should look and read like a real letter.
- It should feel warmer, quieter, and more elegant than a normal utility card.
- Typography, spacing, date/title treatment, and reflection area should support slow reading.

Acceptance criteria:
- Opening a letter feels visually distinct from kanban/today utility screens.
- The summary is readable as a self-contained page.
- User reflections feel attached to the letter without cluttering it.

### 9. Feature: share a letter with friends

Expected behavior:
- Add a share button on the letter detail page.
- Prefer native share sheet where supported.
- The shared output should be tasteful and useful: either a text excerpt, a shareable image/card, or a public/private share link depending on implementation constraints.

Questions to resolve:
- Should shared letters expose private data through a public link, or only use local/native sharing?
- Should share output include user reflections or only generated letter text?

Acceptance criteria:
- Tap share on a letter.
- On mobile, the native share sheet opens when available.
- The shared content is formatted cleanly and does not expose unintended private data.

### 10. UX: swipe-right to go back from a letter

- On the letter detail page, support a right-swipe gesture to return to the archive list, not only the 返回 button.
- Should feel native and not interfere with text selection in the letter or the reflection textarea.

## Batch 4: Server automation after deployment

### 11. Feature: server-side scheduled daily letter (post-deploy)

Context:
- Current letter generation is client-side backfill on app open.
- After the app is deployed on the server, move daily letter writing to a scheduled server job.

Goal:
- Every day at 23:00 Beijing time (CST, UTC+8), automatically write that day's letter for each user.
- No need for the user to open the app.

Implementation notes:
- Options: Supabase pg_cron + an edge function, or a system cron on the server calling a small script.
- The job needs each user's DeepSeek API key + base_url, which live in `qsj_user_settings`.
- Only write when that day has records and no existing letter.
- Keep client-side backfill as a fallback for missed days.

Acceptance criteria:
- At ~23:00 CST, a letter is generated for each user's current day without opening the app.
- Existing letters and user reflections are never overwritten.
- Days without records are skipped.

## Batch 5: Operations + security

### 12. Ops: automatic database backup (high priority)

Context:
- All data now lives only on the single Shanghai server/self-hosted Postgres volume.
- If the server is lost or the volume is deleted, all user data is gone.

Goal:
- Daily automated `pg_dump` of the self-hosted database, stored off the server.

Implementation notes:
- Cron on the host: `docker compose exec -T db pg_dump ...` -> gzip -> store.
- Keep an on-server copy and an off-site copy such as Tencent COS.
- Keep rolling retention, e.g. last 7-14 days.
- Verify a restore at least once.

Acceptance criteria:
- A dated dump is produced daily and stored off-server.
- A restore has been tested successfully at least once.

### 13. Post-filing: switch interim HTTPS:8443 to standard 443

Tasks:
- Open 443 and 80 in the server firewall once filed.
- Point Caddy/site at `:443`.
- Update `supabase-config.js` url to `https://easynote.brainpowerai.com.cn` with no `:8443`.
- Complete 公安备案 if required; add the filing number to the site footer.

### 14. Security cleanup

- Reset the cloud Supabase database password that was exposed during migration.
- Pause or delete the now-unused cloud Supabase project once a final backup is taken.
- Replace the Tencent main-account API key used by acme.sh with a least-privilege CAM sub-user key for DNS only.

## Batch 6: Research

### 15. Research: voice-to-text — rely on keyboard dictation or build it?

Context:
- The app icon is a microphone, but EasyNote has no in-app voice-to-text yet.
- Most phone keyboards already have built-in dictation.

Investigate:
- Which keyboards/OS versions ship usable built-in dictation by default.
- Whether built-in keyboard dictation already satisfies the need.

Decision:
- If keyboard dictation is good enough, document or hint it to users.
- If not, scope an in-app recording + speech-to-text feature.

## Batch 7: Launch & today-organize polish

### 16. Fix: login screen flashes on launch even when already logged in

Cause:
- index.html shows `#auth-screen` (the login form) by default; `#app-shell` is hidden.
- On launch `initAuth()` awaits an async session check (read stored session + possible token refresh over the network — a few seconds on weak mobile) before `enterApp()` hides the login form. So an already-logged-in user sees the login page for a few seconds.

Fix:
- Show a neutral splash on launch (app name / a rotating "每日一句话"); keep both the login form and the app hidden until the session resolves, then route to app or login.
- Optionally persist a "was-logged-in" flag in localStorage so the splash (not the login form) is the default for returning users.

Acceptance:
- Launching while logged in shows splash → app, never the login form.
- Launching while logged out shows splash → login form.

### 17 + 18. Fix: Today-organize resurfaces old / completed kanban items

Symptoms:
- #17 old open kanban items get re-added into today's TODO.
- #18 already-completed items reappear in today's organize.

Cause (shared):
- Today-organize only reads today's records (`e.date === today`), but `buildDailySummaryPrompt` feeds the entire kanban (all open + done cards) as "看板现有状态" context. The model re-emits those reference items into the Todo / 已完成 sections, and they get re-added with today's date.
- Insert-time dedup uses fuzzy `textSimilarity >= 0.65`, so rephrased items slip through.

Fix:
- Stop feeding existing kanban items into the today-summary prompt (remove the kanban context block), so the model organizes only today's records.
- On insert (`addSummaryTextToKanban`), dedup by normalized text against ALL existing cards (any date, any status) with exact match — never re-add a card whose text already exists; completed ones are never re-listed.

Acceptance:
- Add a record today, organize: only today's new items are added; old open items and completed items are not duplicated into today.
