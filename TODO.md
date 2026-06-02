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
