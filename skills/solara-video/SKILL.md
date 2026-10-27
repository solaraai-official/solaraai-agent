---
name: solara-video
description: Turn a talking-head recording into an edited, captioned short video with Solara AI (cuts, captions, zooms, b-roll, music in a chosen style), then export and download it. Use when the person asks to edit, caption or style a video with Solara, or to make a Reel, TikTok or YouTube Short from a clip they filmed. Needs a Solara API key in SOLARA_API_KEY.
compatibility: Node.js 20+ (the CLI runs with npx, nothing else to install) and internet access to api.solaraai.com and registry.npmjs.org. ffprobe is used when present.
metadata:
  openclaw:
    requires:
      env:
        - SOLARA_API_KEY
      bins:
        - npx
    primaryEnv: SOLARA_API_KEY
    envVars:
      - name: SOLARA_API_KEY
        required: true
        description: A Solara API key (sol_live_...), created in Solara under Settings, API keys.
      - name: SOLARA_API_URL
        required: false
        description: The API address. Defaults to https://api.solaraai.com.
      - name: SOLARA_APP_URL
        required: false
        description: The app address used in edit links. Defaults to https://app.solaraai.com.
    homepage: https://docs.solaraai.com/assistants/skill-and-cli
---

# Make a video with Solara AI

Solara edits a talking-head recording into a short video: cuts, captions, zooms, b-roll and
music in a chosen style. You upload the clip, start an edit, show the person the result, and
export it when they say yes.

If Solara's MCP tools are connected in this session (`list_styles`, `create_video`,
`get_status`, `export_video`), use them instead: they do the same with the person's sign-in.

## Setup

1. The person creates an API key in Solara: **Settings → API keys → Create API key**
   (https://app.solaraai.com/settings/api-keys). It is shown once. They put it in your
   environment as `SOLARA_API_KEY`, never in the chat.
2. Run Solara's CLI, the npm package `solaraai`, with `npx -y solaraai <command>` (Node.js 20+,
   nothing else to install). `npx -y solaraai login` checks the key; `npx -y solaraai --help` and
   `npx -y solaraai <command> --help` explain every command. Installed once with
   `npm i -g solaraai`, the same commands run as `solara <command>`.

## The happy path

```bash
npx -y solaraai styles                       # pick a style id
npx -y solaraai upload talk.mp4              # prints upload_id and duration_ms
npx -y solaraai start --upload <upload_id> --duration-ms <ms> \
    --style <style_id> --title "Runner tips" --prompt "A 30-second tip for new runners"
npx -y solaraai wait <video_id>              # until the edit is ready (minutes)
# Show the person the edit link it printed. Export only after they say yes.
npx -y solaraai export <video_id>
npx -y solaraai wait <video_id> --until export
npx -y solaraai download <video_id> --out talk-edited.mp4
```

`styles` prints each style's `id` and the `name` the app shows; they can differ (`lumen` is shown
as Halo). Pass the id to `--style` and `--caption-style`; say the name to the person.

Add `--json` to any command to read the API's answer. `status <video_id>` shows where a video is;
`usage` shows whether the plan is paid, its exports used and left this month (`exports_left`; check
it before exporting), and this key's new videos today. Give every video a `--title`: it is how the
person finds it in the app (without one it is "Untitled").

## What the person can ask for

Set these on `start`. They are fixed once the video starts: to change one, start a new video.

| The person says | Add to `start` |
| --- | --- |
| tight, snappy, fast-paced pauses | `--pause-ms 150` (Tight) |
| no pauses at all, rapid-fire | `--pause-ms 50` (Tightest) |
| natural pauses (the default) | nothing (Natural is 300 ms) |
| faster, speed it up | `--speed 1.1`, `1.25`, `1.5` or `2` (0.8 to 2; 1 is normal, the voice keeps its pitch) |
| landscape, horizontal, YouTube, 16:9 | `--aspect 16:9` (by default the video follows the clip: filmed sideways is 16:9 where landscape is offered, upright is 9:16; pass `--file <clip>` to `start` so it can read the clip) |
| vertical, upright, for phones, 9:16 | `--aspect 9:16` |
| subtle or bold edits | `--intensity light` / `medium` / `heavy` |
| a caption look | `--caption-style <id>` from `styles` |

If `start` is refused with `edit_timing_off` (pause length and speed) or `landscape_off` (16:9),
the workspace isn't offered that setting: tell the person and ask whether to go ahead without it;
don't drop it silently.

## Rules

1. **Show the edit before exporting.** Give the person the edit link, the style and the prompt
   you used, and wait for a yes. They can fine-tune it in Solara's editor at that link.
2. **Each export uses one of the plan's videos for the month.** Export once per approved edit.
   Never export "to check", never loop exports, never export a video nobody approved.
3. **Never post or schedule anything.** An API key can't, and you must not try another way.
4. **Never touch billing or the account.** Don't subscribe, upgrade, change an email or create
   keys. If the CLI says a plan is needed, tell the person.
5. **Keep the key secret.** Never print it, paste it into a chat, log it or commit it.
6. **On any error, follow the CLI's `next:` line.** Writes are sent with an Idempotency-Key and
   retried with the same one, so a repeat never spends twice. Don't retry with a new key on your
   own: run `status` first.

## Limits

- Clips: `.mp4`, `.mov` or `.webm`, up to 2 GB and 10 minutes.
- One API key starts at most 30 new videos a day (UTC).
- Keys work only while the workspace has a paid plan.

## Errors

The CLI prints the problem and a `next:` line on stderr. Exit codes: 0 done, 1 refused (read
`next:`), 2 bad arguments or no key, 3 not ready yet (run the same command again later).

| Code | What to do |
| --- | --- |
| `api_key_invalid` / `api_key_revoked` | Ask the person to copy the key again, or for a new one. |
| `api_key_not_allowed` / `insufficient_scope` | Keys can't do this; the person does it in Solara. |
| `agent_api_off` | API access is off for the workspace; the person contacts Solara support. |
| `plan_required` / `allowance_used` | No paid plan, or this month's videos are used; tell the person. |
| `api_key_daily_limit` | 30 new videos today for this key; wait until after midnight UTC. |
| `api_key_rate_limited` / `export_limit` | Wait for the Retry-After time the CLI prints. |
| `agent_spend_limit` | Today's agent work for the workspace is used; tell the person. |
| `idempotency_in_progress` | The same request is still running; run `status` first. |
| `idempotency_key_reused` | That key was used for another request; send without `--idempotency-key`. |
| `edit_timing_off` | Pause length and speed aren't offered here; ask the person whether to start without them. |
| `landscape_off` | 16:9 isn't offered here yet; ask the person whether to make it 9:16. |
| `project_not_found` | Check the video id. |
| `not_exported` / "has not been exported yet" | Export it first, after the person's yes. |
| a failed video (`no_speech`) | Nobody could be heard talking; try another clip. |
