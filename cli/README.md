# solaraai

Make edited short videos with [Solara AI](https://solaraai.com) from a terminal or an AI agent.
Solara turns a talking-head recording into a short video: cuts, captions, zooms, b-roll and music
in a style you choose. The CLI uploads the clip, starts the edit, and exports the video once the
person has seen it and said yes.

```bash
npx -y solaraai --help      # nothing to install (Node.js 20 or newer)
npm i -g solaraai           # or install it: the command is `solara` (or `solaraai`)
```

One file, no dependencies. It reads the API key from the environment, so the key never appears in a
chat, and it never stores or prints the key.

## Setup

1. In Solara, open **Settings → API keys** and choose **Create API key**
   ([app.solaraai.com/settings/api-keys](https://app.solaraai.com/settings/api-keys)). Keys need a
   paid plan. Solara shows the key once.
2. Give it to the CLI as an environment variable, never in a chat or a committed file:

   ```bash
   export SOLARA_API_KEY="sol_live_..."
   solara login                # checks the key
   ```

## Make a video

```bash
solara styles                                  # pick a style id
solara upload talk.mp4                         # prints upload_id and duration_ms
solara start --upload <upload_id> --duration-ms <ms> --style <id> \
    --title "Runner tips" --prompt "A 30-second tip for new runners"
solara wait <video_id>                         # until the edit is ready (minutes)
# Show the person the edit link. Export only after they say yes.
solara export <video_id>                       # uses one of the plan's videos
solara wait <video_id> --until export
solara download <video_id> --out talk-edited.mp4
```

The recording is a link, not a file (a Google Drive or Dropbox share link, a video on a website)?
`solara upload-url "<link>"` has Solara fetch it, and prints the same `upload_id` and `duration_ms`.

`solara <command> --help` explains each command and its options. Every command takes `--json` to
print the API's answer. `status <video_id>` shows where a video is; `usage` shows the plan's exports
left this month; `calendar` reads the posting calendar (what posts when, and how each post went).

Exit codes: `0` done, `1` refused (the `next:` line on stderr says what to do), `2` bad arguments
or no key, `3` not ready yet (run the same command again later).

## For AI agents

- Show the person the edit link and get a yes before exporting. Each export uses one of the plan's
  videos for the month: export once per approved edit, never in a loop.
- Never post, publish or change billing; an API key can't. To post a video, photos or a text post,
  the person does it in Solara, or [connects an AI agent](https://docs.solaraai.com/agents/connect)
  to Solara's MCP server (they sign in and click **Allow**), which asks to post, and approves each
  post. That agent writes the caption from what the video says, unless the person gave one or asked
  for none, and tells them it with the approval link.
- On any error, do what the `next:` line says. Writes carry an Idempotency-Key and are retried with
  the same one, so a repeat never spends twice.

The [Solara skill](https://docs.solaraai.com/agents/skill-and-cli) teaches an agent all of this.

## Environment

| Variable | What |
| --- | --- |
| `SOLARA_API_KEY` | Required. A key from Settings → API keys. |
| `SOLARA_API_URL` | The API. Default `https://api.solaraai.com`. |
| `SOLARA_APP_URL` | The app, for edit links. Default: the API's address with `api` swapped for `app`. |
| `HTTPS_PROXY`, `HTTP_PROXY`, `NO_PROXY` | Used as curl uses them. |

`ffprobe`, when installed, reads a clip's length and orientation when the file itself doesn't say.

Docs: [docs.solaraai.com/agents/skill-and-cli](https://docs.solaraai.com/agents/skill-and-cli).
Help: [solaraai.com/contact](https://solaraai.com/contact). License: MIT.
