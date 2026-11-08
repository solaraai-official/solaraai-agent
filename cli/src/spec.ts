// Every command, its arguments and options, and the help an agent meeting the CLI cold reads.
// `{cli}` in any text is how this run was started: `solara`, or `npx -y solaraai`.

import { FETCH_TIMEOUT_SECONDS } from './fetch-upload';
import { ASPECTS, DEFAULT_STYLE, INTENSITIES, PAUSE_MS_RANGE, SPEED_RANGE } from './video';

export interface OptionSpec {
  name: string;
  kind: 'string' | 'int' | 'number';
  value: string;
  help: string;
  choices?: readonly string[];
  required?: boolean;
  default?: string;
}

export interface CommandSpec {
  name:
    | 'login'
    | 'logout'
    | 'whoami'
    | 'videos'
    | 'styles'
    | 'upload'
    | 'upload-url'
    | 'start'
    | 'status'
    | 'wait'
    | 'export'
    | 'download'
    | 'usage'
    | 'calendar';
  summary: string;
  /** A positional argument; an optional one may be left out (only the last ones may be). */
  args: { name: string; help: string; optional?: boolean }[];
  options: OptionSpec[];
  about: string[];
  examples: string[];
}

export const COMMANDS: CommandSpec[] = [
  {
    name: 'login',
    summary: 'sign in to Solara: you run it, the person confirms its code in their browser, once',
    args: [],
    options: [
      {
        name: 'browser',
        kind: 'string',
        value: '<when>',
        help: 'open the link in a browser on this machine (auto: unless over SSH or without a display)',
        choices: ['auto', 'never'],
        default: 'auto',
      },
    ],
    about: [
      'An agent runs it itself: it prints a link and a code (on stderr) and waits up to 10 minutes. Give the',
      'person both: they open the link on any device, sign in to Solara, check the code and choose Allow.',
      'Works where no browser can reach this machine (a sandbox, SSH). Then it prints only "Signed in to',
      '<workspace>": tell the person that line. It asks only for what the commands use (read, edit,',
      'export; never posting), ends an older sign-in first, and keeps the new one in',
      '~/.config/solaraai/credentials.json (this user only), refreshed on its own and never printed. It',
      'wins over SOLARA_API_KEY. Run it in the background or with a long timeout.',
    ],
    examples: ['{cli} login', '{cli} login --browser never'],
  },
  {
    name: 'logout',
    summary: 'sign out: end the sign-in in Solara and delete it from this machine',
    args: [],
    options: [],
    about: ['SOLARA_API_KEY, if set, is not touched.'],
    examples: ['{cli} logout'],
  },
  {
    name: 'whoami',
    summary: 'the same as `status` with no video: who the CLI is signed in as',
    args: [],
    options: [],
    about: ['Checks the sign-in (or SOLARA_API_KEY) with one read. Exit 0: it works; 2: not signed in.'],
    examples: ['{cli} whoami'],
  },
  {
    name: 'styles',
    summary: 'list the styles and caption styles, by id',
    args: [],
    options: [],
    about: [
      "Prints each style's id and the name the app shows; they can differ (lumen is shown as Halo).",
      'Pass the id to `start --style` and `--caption-style`; say the name to the person.',
    ],
    examples: ['{cli} styles', '{cli} styles --json'],
  },
  {
    name: 'upload',
    summary: 'upload a recording (.mp4, .mov or .webm, up to 2 GB and 10 minutes)',
    args: [{ name: 'file', help: 'the video file' }],
    options: [],
    about: [
      "Prints the upload_id and the clip's length in ms (duration_ms): `start` needs both.",
      'A part that fails is tried up to 4 times; after that, run the same command again (a fresh upload).',
    ],
    examples: ['{cli} upload talk.mp4'],
  },
  {
    name: 'upload-url',
    summary: 'have Solara fetch a recording from a public link (Google Drive, Dropbox, a website)',
    args: [{ name: 'link', help: 'the public link to the video file the person gave' }],
    options: [
      {
        name: 'timeout',
        kind: 'number',
        value: '<seconds>',
        help: 'stop waiting for the fetch after this long',
        default: String(FETCH_TIMEOUT_SECONDS),
      },
      {
        name: 'idempotency-key',
        kind: 'string',
        value: '<key>',
        help: 'pick up a fetch already started, with the key it printed',
      },
    ],
    about: [
      'For a recording the person gives as a link, not a file: Solara downloads it itself (.mp4, .mov or',
      ".webm, up to 2 GB and 10 minutes). Prints the upload_id and, when the file says it, the clip's length",
      "(duration_ms): `start` needs both. A link that isn't public is refused with what to ask the person.",
      'Exit 3 when the timeout comes first: run it again with the --idempotency-key it printed (nothing is',
      'fetched twice).',
    ],
    examples: ['{cli} upload-url "https://drive.google.com/file/d/<id>/view?usp=sharing"'],
  },
  {
    name: 'start',
    summary: 'make a video from an upload and start editing it',
    args: [],
    options: [
      { name: 'upload', kind: 'string', value: '<upload_id>', help: 'the upload_id `upload` printed', required: true },
      { name: 'duration-ms', kind: 'int', value: '<ms>', help: "the clip's length, printed by `upload`" },
      {
        name: 'file',
        kind: 'string',
        value: '<path>',
        help: 'read the length from the clip instead; also lets a clip filmed sideways come out 16:9',
      },
      { name: 'style', kind: 'string', value: '<id>', help: 'a style id from `styles`', default: DEFAULT_STYLE },
      {
        name: 'title',
        kind: 'string',
        value: '<text>',
        help: 'the name the person sees in the app (default Untitled)',
      },
      { name: 'prompt', kind: 'string', value: '<text>', help: 'what the video is for, in a sentence or two' },
      { name: 'caption-style', kind: 'string', value: '<id>', help: 'a caption style id from `styles`' },
      { name: 'intensity', kind: 'string', value: '<level>', help: 'how much editing', choices: INTENSITIES },
      {
        name: 'pause-ms',
        kind: 'int',
        value: '<ms>',
        help: `pause kept between phrases, ${PAUSE_MS_RANGE.join('-')}: 150 tight, 50 rapid-fire (default 300)`,
      },
      {
        name: 'speed',
        kind: 'number',
        value: '<x>',
        help: `playback speed, ${SPEED_RANGE.join('-')}: 1.1, 1.25, 1.5 or 2 (the voice keeps its pitch)`,
      },
      {
        name: 'aspect',
        kind: 'string',
        value: '<ratio>',
        help: 'the frame (default: follows the clip; 9:16 upright)',
        choices: ASPECTS,
      },
      {
        name: 'idempotency-key',
        kind: 'string',
        value: '<key>',
        help: 'repeat a start safely with the key it printed',
      },
    ],
    about: [
      'Prints the video_id and the edit link. Give every video a --title: it is how the person finds it.',
      'The settings are fixed once the video starts: to change one, start a new video. Refused with',
      'edit_timing_off (pause, speed) or landscape_off (16:9)? Tell the person and ask whether to go on',
      'without it. The request carries an Idempotency-Key (printed on stderr): a retry never makes two.',
    ],
    examples: [
      '{cli} start --upload <upload_id> --duration-ms 31540 --style brass \\',
      '    --title "Runner tips" --prompt "A 30-second tip for new runners" --pause-ms 150',
    ],
  },
  {
    name: 'status',
    summary: 'show where a video is (its state, rev and exported rev), or, alone, who you are signed in as',
    args: [{ name: 'video_id', help: 'the video_id `start` printed (leave out: the sign-in)', optional: true }],
    options: [],
    about: [
      'With a video: run it before sending anything new after a failure.',
      'Alone: the workspace and how the CLI signs in, checked with one read. Exit 2: not signed in.',
    ],
    examples: ['{cli} status <video_id>', '{cli} status'],
  },
  {
    name: 'videos',
    summary: "list the workspace's videos, newest change first, with their state",
    args: [],
    options: [
      { name: 'search', kind: 'string', value: '<words>', help: 'only videos whose title or words hold these' },
      { name: 'limit', kind: 'int', value: '<n>', help: 'at most this many, 1-100', default: '20' },
    ],
    about: ['Find a video the person means without asking for its id. Read-only.'],
    examples: ['{cli} videos', '{cli} videos --search "runner tips"'],
  },
  {
    name: 'wait',
    summary: 'wait until the edit (or, with --until export, the export) is ready',
    args: [{ name: 'video_id', help: 'the video_id `start` printed' }],
    options: [
      {
        name: 'until',
        kind: 'string',
        value: '<what>',
        help: 'what to wait for',
        choices: ['edit', 'export'],
        default: 'edit',
      },
      { name: 'timeout', kind: 'number', value: '<seconds>', help: 'stop waiting after this long', default: '1800' },
    ],
    about: [
      'An edit usually takes a few minutes. Exit 3 when the timeout comes first: run it again.',
      'When the edit is ready, show the person the edit link and get a yes before `export`.',
    ],
    examples: ['{cli} wait <video_id>', '{cli} wait <video_id> --until export'],
  },
  {
    name: 'export',
    summary: "export the edit as an MP4 (uses one of the plan's videos for the month)",
    args: [{ name: 'video_id', help: 'the video_id `start` printed' }],
    options: [
      { name: 'rev', kind: 'int', value: '<n>', help: 'the rev to export (default: the current one)' },
      {
        name: 'idempotency-key',
        kind: 'string',
        value: '<key>',
        help: 'repeat an export safely with the key it printed',
      },
    ],
    about: [
      'Only after the person said yes to the edit. Export once per approved edit, never in a loop:',
      'a rev already exported or exporting is not sent again. Then: `wait <video_id> --until export`.',
    ],
    examples: ['{cli} export <video_id>'],
  },
  {
    name: 'download',
    summary: 'save the exported video',
    args: [{ name: 'video_id', help: 'the video_id `start` printed' }],
    options: [{ name: 'out', kind: 'string', value: '<path>', help: 'where to save it (default <video_id>.mp4)' }],
    about: ['The link is fetched fresh each time; the API key is never sent with the file.'],
    examples: ['{cli} download <video_id> --out talk-edited.mp4'],
  },
  {
    name: 'usage',
    summary: "whether the plan is paid, its exports used and left this month, this key's videos today",
    args: [],
    options: [],
    about: ['Check exports_left before exporting.'],
    examples: ['{cli} usage'],
  },
  {
    name: 'calendar',
    summary: "read the person's posting calendar: what posts when, and how each post went",
    args: [],
    options: [
      {
        name: 'from',
        kind: 'string',
        value: '<date>',
        help: 'start of the window, a date or time (default: Monday 00:00 UTC of this week)',
      },
      {
        name: 'to',
        kind: 'string',
        value: '<date>',
        help: 'end of the window, not included (default: from + 14 days)',
      },
      { name: 'limit', kind: 'int', value: '<n>', help: 'at most this many posts, 1-100', default: '50' },
    ],
    about: [
      'Every post in the window, in publish order: its status (scheduled, publishing, published, failed,',
      '...), its time in UTC, its platforms and how each platform went. Read-only: the CLI cannot post,',
      'move or retry a post; the person does that in the Solara calendar.',
    ],
    examples: ['{cli} calendar', '{cli} calendar --from 2026-11-09 --to 2026-11-16'],
  },
];

export function commandSpec(name: string): CommandSpec | undefined {
  return COMMANDS.find((command) => command.name === name);
}

function fill(text: string, cli: string): string {
  return text.replaceAll('{cli}', cli);
}

export function mainHelp(cli: string, version: string): string {
  const width = Math.max(...COMMANDS.map((command) => command.name.length));
  const lines = [
    `solara ${version}: make edited short videos with Solara AI, from a terminal or an AI agent.`,
    '',
    'Solara edits a talking-head recording into a short video: cuts, captions, zooms, b-roll and',
    'music in a chosen style. Upload the clip, start an edit, show the person the edit link, and',
    'export it only when they say yes.',
    '',
    `Usage: ${cli} <command> [arguments] [--json]`,
    '       npx -y solaraai <command> ...   (nothing to install; Node 20+)',
    '',
    `Setup: run \`${cli} status\`; if it is not signed in, run \`${cli} login\` yourself and give the person`,
    '       the link and the code it prints. On a server or in CI, SOLARA_API_KEY can hold a key instead.',
    '',
    'The happy path:',
    `  ${cli} login                        once: the person confirms a code in Solara`,
    `  ${cli} styles                       pick a style id`,
    `  ${cli} upload talk.mp4              prints upload_id and duration_ms`,
    `  ${cli} start --upload <upload_id> --duration-ms <ms> --style <id> \\`,
    '      --title "Runner tips" --prompt "A 30-second tip for new runners"',
    `  ${cli} wait <video_id>              until the edit is ready (minutes)`,
    '  # Show the person the edit link. Export only after they say yes.',
    `  ${cli} export <video_id>            uses one of the plan's videos`,
    `  ${cli} wait <video_id> --until export`,
    `  ${cli} download <video_id> --out talk-edited.mp4`,
    `A link instead of a file (Google Drive, Dropbox): \`${cli} upload-url <link>\`, then \`start\` as above.`,
    '',
    'Commands:',
    ...COMMANDS.map((command) => `  ${command.name.padEnd(width)}  ${command.summary}`),
    '',
    `Every command takes --json (print the API's answer) and --help (\`${cli} <command> --help\`).`,
    'Exit codes: 0 done, 1 refused (do what the `next:` line on stderr says), 2 bad arguments or not',
    'signed in, 3 not ready yet (run the same command again later).',
    '',
    'Rules: show the edit and get a yes before exporting; export once per approved edit, never in a',
    'loop; never post, publish or touch billing; never print, ask for or paste a key or a token.',
    'To post a video, photos or a text post, the person does it in Solara, or connects an AI agent',
    "through Solara's MCP server and approves each post: https://docs.solaraai.com/agents/connect",
    '',
    'Environment: SOLARA_API_KEY (used when there is no sign-in), SOLARA_API_URL (default',
    'https://api.solaraai.com), SOLARA_APP_URL (the app, for edit links), SOLARA_CONFIG_DIR (where the',
    'sign-in is kept; default ~/.config/solaraai), HTTPS_PROXY / NO_PROXY.',
    'Docs: https://docs.solaraai.com/agents/skill-and-cli',
  ];
  return lines.join('\n');
}

function optionLabel(option: OptionSpec): string {
  return `--${option.name} ${option.choices ? option.choices.join('|') : option.value}`;
}

export function commandHelp(spec: CommandSpec, cli: string): string {
  const required = spec.options.filter((option) => option.required).map(optionLabel);
  const usage = [
    `${cli} ${spec.name}`,
    ...spec.args.map((arg) => (arg.optional ? `[<${arg.name}>]` : `<${arg.name}>`)),
    ...required,
  ];
  if (spec.options.some((option) => !option.required)) usage.push('[options]');
  usage.push('[--json]');
  const rows: [string, string][] = [
    ...spec.args.map((arg): [string, string] => [`<${arg.name}>`, arg.help]),
    ...spec.options.map((option): [string, string] => {
      const notes = [option.required ? 'required' : '', option.default ? `default ${option.default}` : ''];
      const suffix = notes.filter(Boolean).join(', ');
      return [optionLabel(option), suffix ? `${option.help} (${suffix})` : option.help];
    }),
    ['--json', "print the API's answer as JSON"],
    ['--help', 'this help'],
  ];
  const width = Math.max(...rows.map(([label]) => label.length));
  return [
    `${cli} ${spec.name}: ${spec.summary}.`,
    '',
    `Usage: ${usage.join(' ')}`,
    '',
    ...rows.map(([label, help]) => `  ${label.padEnd(width)}  ${help}`),
    '',
    ...spec.about,
    '',
    'Example:',
    ...spec.examples.map((example) => `  ${fill(example, cli)}`),
    '',
    'Exit codes: 0 done, 1 refused (read `next:`), 2 bad arguments or not signed in, 3 not ready yet.',
  ].join('\n');
}
