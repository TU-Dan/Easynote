# Project TODOs

## 1. Fix: kanban is empty before generating a daily summary

Problem:
- When the user has not clicked "生成总结", the kanban page can be empty.
- Switching the kanban date filter to "近 7 日" still does not show any records.

Expected behavior:
- The kanban should not depend on generating a daily summary.
- Rename the kanban date filter from "本周" to "近 7 日".
- The "近 7 日" filter should use a rolling 7-day window, not calendar-week boundaries.
- The "近 7 日" filter should show relevant unfinished and finished items that already exist in records or kanban storage.

Questions to resolve:
- Should raw records with checkbox markers (`☐` / `☑`) appear directly on kanban before summary generation?
- Should this only include checkbox-style records, or should all records be converted into lightweight kanban candidates?

Acceptance criteria:
- Add records containing `☐` or `☑`.
- Do not click "生成总结".
- Open kanban and switch to "近 7 日".
- Relevant items are visible, with correct open/done status.

## 2. Feature: automatic daily summary archive

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

## 3. Feature: server-side scheduled daily letter (post-deploy)

Context:
- Current letter generation is client-side backfill on app open (only past days, only when the app is opened).
- After the app is deployed on the server (post-ICP filing), move daily letter writing to a scheduled server job.

Goal:
- Every day at 23:00 Beijing time (CST, UTC+8), automatically write that day's letter for each user.
- No need for the user to open the app.

Implementation notes:
- Options: Supabase pg_cron + an edge function, or a system cron on the server calling a small script.
- The job needs each user's DeepSeek API key + base_url, which live in `qsj_user_settings`. Read per-user, generate the letter, upsert into `qsj_summaries.letter`.
- Only write when that day has records and no existing letter (same idempotent rule as the client backfill — never overwrite an existing letter or the user's reflection).
- Keep the client-side backfill as a fallback for days the cron missed.

Acceptance criteria:
- At ~23:00 CST, a letter is generated for each user's current day without opening the app.
- Existing letters and user reflections are never overwritten.
- Days without records are skipped.

## 4. Ops: automatic database backup (high priority)

Context:
- All data now lives only on the single Shanghai server (self-hosted Postgres volume). No backup yet.
- If the server is lost or the volume is deleted, all user data is gone. The cloud Supabase copy is only a pre-migration snapshot, not in sync.

Goal:
- Daily automated `pg_dump` of the self-hosted database, stored off the server.

Implementation notes:
- Cron on the host: `docker compose exec -T db pg_dump ...` → gzip → store.
- Two layers (near zero cost):
  1. On-server copy under e.g. `~/backups/` — free, guards against accidental table drop / bad migration.
  2. Off-site copy to Tencent COS — guards against losing the whole server (deletion, expiry, reclaim). Cost is negligible for this tiny DB (~cents/month; new-user free tier likely covers it). Requires activating COS (pay-as-you-go).
- Free alternative to COS: scheduled download of the dump to the Mac / another machine.
- Keep rolling retention (e.g., last 7-14 days); prune older.
- Verify a restore at least once.
- Reminder: also avoid loss-by-expiry — keep the Lighthouse instance renewed (paid through 2027 currently).

Acceptance criteria:
- A dated dump is produced daily and stored off-server.
- A restore has been tested successfully at least once.

## 5. Post-filing: switch interim HTTPS:8443 to standard 443

Context:
- Interim setup (pre-ICP) serves the app on a non-standard port: https://easynote.brainpowerai.com.cn:8443, cert via acme.sh DNS-01, Caddy reverse-proxying to Kong:8000.
- After ICP filing clears, move to the standard 443 so the URL has no port suffix.

Tasks:
- Open 443 (and 80) in the server firewall once filed.
- Point Caddy/site at :443; keep DNS-01 cert (or switch to normal HTTP-01 once 80 is allowed).
- Update `supabase-config.js` url to `https://easynote.brainpowerai.com.cn` (no :8443).
- Complete 公安备案 (public-security filing) if the province requires it; add the filing number to the site footer.

## 6. Security cleanup

- Reset the cloud Supabase database password (it was exposed in chat during migration). Then pause or delete the now-unused cloud Supabase project once a final backup is taken.
- Replace the Tencent main-account API key used by acme.sh with a least-privilege CAM sub-user key (DNS permission only), since it stays on the server for cert renewal.

## 7. UX: swipe-right to go back from a letter

- On the 信箱 letter detail page, support a right-swipe gesture to return to the archive list, not only the 返回 button.
- Should feel native (follow the finger / threshold to dismiss), and not interfere with text selection in the letter or the reflection textarea.

## 8. Research: voice-to-text — rely on keyboard dictation or build it?

Context:
- The app icon is a microphone, but EasyNote has no in-app voice-to-text yet.
- Most phone keyboards already have built-in dictation (iOS keyboard mic / 听写; Android Gboard 语音输入), which types into any text field, including our capture textarea.

Investigate:
- Which keyboards/OS versions ship usable built-in dictation by default (iOS dictation, Gboard, 搜狗/讯飞/百度输入法 voice), and how good Chinese recognition is.
- Whether the built-in mic already satisfies the need (user taps keyboard mic, speaks, text lands in the capture box) — i.e., no development required.

Decide:
- If keyboard dictation is good enough → no build; just document/hint it to users.
- If not (e.g., want one-tap record button, long-form transcription, or independence from keyboard) → scope an in-app recording + speech-to-text feature (Web Speech API where supported, or a server-side STT).
