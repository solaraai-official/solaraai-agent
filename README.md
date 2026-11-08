# Solara AI MCP server: AI video editing for Claude, ChatGPT and any MCP client

Your AI agent turns a talking-head recording into an edited, captioned short video with
[Solara AI](https://solaraai.com): cuts, captions, zooms, b-roll and music in a style you choose.
It shows you the edit, exports only after your yes, and asks before it posts: you approve every post.

```text
https://api.solaraai.com/mcp
```

A remote MCP server (Streamable HTTP). You sign in to Solara and choose **Allow**: no API key to copy.

⭐ **[Star this repo][repo]** to follow new tools and agent features as they ship.

## Connect in 60 seconds

Every agent below opens Solara in your browser: sign in, check what it asks for, and choose **Allow**.
Then ask it: *"List the video styles I can use in Solara."*

### Claude (claude.ai, Claude Desktop, the mobile apps)

1. Go to **Customize → Connectors**
   ([open it](https://claude.ai/customize/connectors?modal=add-custom-connector)), click **+ Add**,
   then **Add custom connector**.
2. Name it **Solara AI**, paste `https://api.solaraai.com/mcp` and click **Continue**. Keep the
   settings Claude fills in, then click **Add** and **Connect**.
3. Sign in to Solara and choose **Allow**. In a chat, click **+**, then **Connectors**, and switch
   **Solara AI** on.

Works on every Claude plan; Claude Free has one custom connector. On Team and Enterprise, an Owner
adds it in **Organization settings → Connectors** first.
[Claude guide](https://docs.solaraai.com/agents/claude)

### ChatGPT (Business, Enterprise and Edu, on the web)

1. Open [chatgpt.com/plugins](https://chatgpt.com/plugins), select **+**, then **Add custom MCP server**.
2. Name it **Solara AI** and paste `https://api.solaraai.com/mcp` under **Connection**.
3. Set authentication to **OAuth**, tick **I understand and want to continue**, choose **Create as a
   plugin**, then sign in to Solara and choose **Allow**. In a chat, type `@` and pick **Solara AI**.

ChatGPT edits and posts only on its Business, Enterprise and Edu plans, on the web; in a Business
workspace, an admin or owner adds it. On ChatGPT Pro it can only read, and OpenAI doesn't list Plus
or Free. [ChatGPT guide](https://docs.solaraai.com/agents/chatgpt)

### Claude Code

The plugin adds the MCP server and the `solara-video` skill:

```text
/plugin marketplace add solaraai-official/solaraai-agent
/plugin install solaraai@solaraai
```

Then type `/mcp`, pick **plugin:solaraai:solara**, sign in and choose **Allow**. Or, without the plugin:

```bash
claude mcp add --transport http --scope user solara https://api.solaraai.com/mcp
claude mcp login solara
```

[Claude Code guide](https://docs.solaraai.com/agents/claude-code)

### Cursor

Add Solara to `~/.cursor/mcp.json` (every project) or `.cursor/mcp.json` (one project):

```json
{
  "mcpServers": {
    "solara": { "url": "https://api.solaraai.com/mcp" }
  }
}
```

Open Cursor's MCP settings on its **Customize** page: Solara is listed and asks you to sign in.
[Cursor guide](https://docs.solaraai.com/agents/cursor)

### Other agents

- **opencode:** add `"solara": { "type": "remote", "url": "https://api.solaraai.com/mcp" }` under
  `mcp` in `opencode.json`, then run `opencode mcp auth solara`.
  [Guide](https://docs.solaraai.com/agents/opencode)
- **Grok Bot:** send your Bot `Add this MCP server: https://api.solaraai.com/mcp`, confirm, then
  choose **Connect** on the card. [Guide](https://docs.solaraai.com/agents/grok-bot)
- **Any MCP client:** add a remote MCP server with the address above. Sign-in is OAuth, and the
  agent asks for every permission at once.
  [How connecting works](https://docs.solaraai.com/agents/connect)

### Your recording

Claude Code, Cursor, opencode and Claude Desktop sessions that can open your files upload the
recording themselves. ChatGPT, claude.ai in your browser and Grok Bot can't: paste a public link
instead (a Google Drive link shared as *Anyone with the link*, a Dropbox link, or a file on a
website), and Solara fetches it. Clips can be up to 10 minutes long (90 seconds on the free try).

## What your agent can ask for

| Permission | What the agent can do |
| --- | --- |
| Read | See your videos, styles, calendar and whether your posts went out |
| Edit | Upload footage and photos, and make and change videos |
| Export | Export a video, which uses one of your plan's videos, as it does in the app |
| Ask to post | Ask to post or schedule a video, photos or a text post. You approve each one in Solara |

## Tools

| Step | Tools | What they do |
| --- | --- | --- |
| Find | `list_styles`, `list_videos`, `list_folders`, `list_ready_videos` | The styles and caption styles, your videos and folders, finished videos not posted yet (read-only) |
| Bring in a recording | `start_upload`, `finish_upload`, `upload_from_url` | Upload a file from the agent's computer, or have Solara fetch a public link |
| Edit | `create_video`, `get_status`, `get_preview` | Start an edit in a style, caption style, speed, pause length and format (9:16 or 16:9), follow it, read the edit and its transcript |
| Change | `apply_edit`, `undo_agent_changes`, `swap_picture`, `new_music_track` | Change settings, captions, shots and zooms (one undo step each), take back the agent's own changes, a new b-roll picture or music track |
| Organize | `create_folder`, `move_videos` | Make a folder and file videos in it |
| Export | `export_video`, `get_download` | Render the MP4 after your yes, then download it |
| Post | `list_social_accounts`, `prepare_publish`, `prepare_photo_post`, `start_image_upload`, `finish_image_upload`, `prepare_text_post`, `create_post_from_upload` | Ask to post a video Solara edited, your own finished video as it is, photos or a text post, now or at a time you pick, with a caption the agent writes from what you said or one you give it. Nothing goes out until you approve |
| Follow up | `get_publish_status`, `list_scheduled_posts` | Where a request stands, and what's on your calendar (read-only) |

Tools that change or spend something of yours are marked destructive, so your agent can ask you
first. Every tool, with its inputs: [docs.solaraai.com/mcp/overview](https://docs.solaraai.com/mcp/overview).

## Things to ask

```text
Turn this recording into a Reel in the Brass style: <a Google Drive or Dropbox link>
Make the captions bigger, add music and fix how my name is spelled.
Switch to Energy Pill captions and speed it up a little.
Export it, write a caption and schedule it for Instagram and TikTok on Tuesday at 9 AM.
Post it again on Thursday on LinkedIn, with a longer caption for LinkedIn.
What's scheduled this week?
Which of my videos aren't posted yet?
```

## Nothing posts without your approval

- Your agent can only **ask** to post. Each post waits for you in Solara, where you see the video,
  the caption, the platforms and the time, and approve it or not.
- It shows you the edit link and waits for your yes before it exports.
- It sees only your workspace. It never touches billing or your account, and it can't connect or
  disconnect your social accounts.
- Disconnect it any time: in Solara, open the menu under your name, then **Connected apps**.

Posting goes to the Instagram, TikTok, Facebook and LinkedIn accounts you connect in Solara.
Videos can be in English or Hebrew.

## What you need

- A Solara account. AI agents work on every plan, within its limits. On the free try your first
  download is free; posting a video Solara edited comes with a plan
  ([solaraai.com/pricing](https://solaraai.com/pricing)).
- An AI agent that can use a remote MCP server.

## The skill and the CLI, for agents that run commands

```bash
npx skills add solaraai-official/solaraai-agent --skill solara-video -g
npx -y solaraai login      # Node.js 20 or newer, nothing to install
npx -y solaraai --help     # every command
```

The [`solara-video`][skill] skill teaches an agent Solara's CLI, the npm package
[`solaraai`](https://www.npmjs.com/package/solaraai). The CLI makes, edits and exports videos; it
never posts. It never prints a key or a token.

## Learn more

- [solaraai.com/agents](https://solaraai.com/agents): what an AI agent can do with Solara
- [docs.solaraai.com/agents/connect](https://docs.solaraai.com/agents/connect): every connect guide
- [docs.solaraai.com/mcp/overview](https://docs.solaraai.com/mcp/overview): every tool
- Help: [solaraai.com/contact](https://solaraai.com/contact), or the support chat in the app
- [Privacy policy](https://solaraai.com/privacy-policy) and [terms](https://solaraai.com/terms-of-service)
- A security problem? Report it privately, never in a public issue: see [SECURITY.md][security].

## In this repository

| Path | What it is |
| --- | --- |
| [.claude-plugin][claude-plugin], [.mcp.json][claude-mcp] | The Claude Code plugin and marketplace: the MCP server and the skill |
| [.cursor-plugin][cursor-plugin], [mcp.json][cursor-mcp] | The same plugin in Cursor's format |
| [skills/solara-video][skill] | The skill: its `SKILL.md` teaches an agent Solara's CLI |
| [cli][cli] | The source of the `solaraai` CLI, published to npm from here with provenance |

The MCP server itself is hosted by Solara at `https://api.solaraai.com/mcp`; nothing runs on your
machine.

## For maintainers

The CLI, the skill, the plugin manifests, this README, SECURITY.md and MAINTAINERS.md are copies:
their source is Solara's private monorepo, which syncs them here. Change them there, never here, or
the next sync undoes the change. Releases and checks: [MAINTAINERS.md][maintainers].

## License

See [LICENSE][license].

[repo]: https://github.com/solaraai-official/solaraai-agent
[skill]: https://github.com/solaraai-official/solaraai-agent/tree/main/skills/solara-video
[claude-plugin]: https://github.com/solaraai-official/solaraai-agent/tree/main/.claude-plugin
[claude-mcp]: https://github.com/solaraai-official/solaraai-agent/blob/main/.mcp.json
[cursor-plugin]: https://github.com/solaraai-official/solaraai-agent/tree/main/.cursor-plugin
[cursor-mcp]: https://github.com/solaraai-official/solaraai-agent/blob/main/mcp.json
[cli]: https://github.com/solaraai-official/solaraai-agent/tree/main/cli
[security]: https://github.com/solaraai-official/solaraai-agent/blob/main/SECURITY.md
[maintainers]: https://github.com/solaraai-official/solaraai-agent/blob/main/MAINTAINERS.md
[license]: https://github.com/solaraai-official/solaraai-agent/blob/main/LICENSE
