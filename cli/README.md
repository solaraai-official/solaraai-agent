# solaraai

Make edited short videos with [Solara AI](https://solaraai.com) from a terminal or an AI agent.
Solara AI turns a talking-head recording into a short video: cuts, captions, zooms and b-roll in a
style you choose. On a paid plan the b-roll also has AI clips, made with the video's model (Gemini
Omni Flash, unless the person picks MiniMax H3 Max or MiniMax H3 Max Turbo in the editor). Inside
Claude Code (`CLAUDECODE=1`) every call says `Solara-Generated-Media: off`, and Solara AI adds no
AI-generated b-roll pictures or clips and makes no AI music for it. The CLI uploads the clip, starts
the edit, and exports the video once the person has seen it and said yes.

```bash
npx -y solaraai --help      # nothing to install (Node.js 20 or newer)
npm i -g solaraai           # or install it: the command is `solaraai`
```

One file, no dependencies. You sign in once in your browser, so no key or token ever passes
through a chat, and the CLI never prints one.

## Sign in

```bash
solaraai login    # prints a link and a code; open the link, check the code, choose Allow
solaraai status   # the workspace you are signed in to (`whoami` too)
solaraai logout   # ends the sign-in in Solara AI and deletes it here
```

An agent runs `login` itself and gives you the link and the code; you open it on any device and
choose **Allow**. It then says `Signed in to <workspace>`. The CLI asks only to read, edit and export:
none of its commands posts, so it never asks for that.

`login` uses the OAuth device flow: the link opens on any device, so it works over SSH and from an
agent's sandbox, where no browser can reach the machine. The sign-in is kept in
`~/.config/solaraai/credentials.json` (readable by your user only; `SOLARAAI_CONFIG_DIR` moves it),
refreshed on its own, and listed in Solara AI under **AI agents** in the sidebar, where you can
disconnect it.

### On a server or in CI

Where nobody can sign in, use an API key: in Solara AI, **Settings → API keys → Create API key**
([app.solaraai.com/settings/api-keys](https://app.solaraai.com/settings/api-keys)), then put it in
the environment, never in a chat or a committed file:

```bash
export SOLARAAI_API_KEY="sol_live_..."
solaraai status
```

**A sign-in wins over `SOLARAAI_API_KEY`.** With both, the CLI uses the sign-in; `solaraai logout` to
use the key.

## Make a video

```bash
solaraai styles                                # pick a style id
solaraai upload talk.mp4                       # prints upload_id and duration_ms
solaraai start --upload <upload_id> --duration-ms <ms> --style <id> \
    --title "Runner tips" --prompt "A 30-second tip for new runners"
solaraai wait <video_id>                       # until the edit is ready (minutes)
# Show the person the edit link. Export only after they say yes.
solaraai export <video_id>                     # uses one of the plan's videos
solaraai wait <video_id> --until export
solaraai download <video_id> --out talk-edited.mp4
```

The recording is a link, not a file (a Google Drive or Dropbox share link, a video on a website)?
`solaraai upload-url "<link>"` has Solara AI fetch it, and prints the same `upload_id` and `duration_ms`.

`solaraai <command> --help` explains each command and its options. Every command takes `--json` to
print the API's answer. `status <video_id>` shows where a video is; `videos` lists the workspace's
videos; `usage` shows the plan's exports left this month; `calendar` reads the posting calendar (what
posts when, and how each post went).

Exit codes: `0` done, `1` refused (the `next:` line on stderr says what to do), `2` bad arguments
or not signed in, `3` not ready yet (run the same command again later).

## For AI agents

- Show the person the edit link and get a yes before exporting. Each export uses one of the plan's
  videos for the month: export once per approved edit, never in a loop.
- Sign in by running `login` yourself and giving the person the link and code it prints, then tell
  them the `Signed in to <workspace>` line. Never ask for a key or a token in the chat.
- Never post, publish or change billing; the CLI can't. To post a video, photos or a text post,
  the person does it in Solara AI, or [connects an AI agent](https://docs.solaraai.com/agents/connect)
  to Solara AI's MCP server (they sign in and click **Allow**), which asks to post, and approves each
  post. That agent writes the caption from what the video says, unless the person gave one or asked
  for none, and tells them it with the approval link.
- On any error, do what the `next:` line says. Writes carry an Idempotency-Key and are retried with
  the same one, so a repeat never spends twice.

The [Solara AI skill](https://docs.solaraai.com/agents/skill-and-cli) teaches an agent all of this.

## Environment

| Variable | What |
| --- | --- |
| `SOLARAAI_API_KEY` | For servers and CI: a key from Settings → API keys. A sign-in wins over it. |
| `SOLARAAI_CONFIG_DIR` | Where the sign-in is kept. Default `~/.config/solaraai`. |
| `SOLARAAI_API_URL` | The API. Default `https://api.solaraai.com`. |
| `SOLARAAI_APP_URL` | The app, for edit links. Default: the API's address with `api` swapped for `app`. |
| `HTTPS_PROXY`, `HTTP_PROXY`, `NO_PROXY` | Used as curl uses them. |

The names before 0.4.0, `SOLARA_API_KEY`, `SOLARA_CONFIG_DIR`, `SOLARA_API_URL` and `SOLARA_APP_URL`,
still work when the new one is unset. So does the command `solara`: it says once that it is now
`solaraai`, then runs the same command.

`ffprobe`, when installed, reads a clip's length and orientation when the file itself doesn't say.

Docs: [docs.solaraai.com/agents/skill-and-cli](https://docs.solaraai.com/agents/skill-and-cli).
Help: [solaraai.com/contact](https://solaraai.com/contact). License: MIT.
