// Every command, its arguments and options, and the help an agent meeting the CLI cold reads.
// `{cli}` in any text is how this run was started: `solara`, or `npx -y solaraai`.

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
  name: 'login' | 'styles' | 'upload' | 'start' | 'status' | 'wait' | 'export' | 'download' | 'usage';
  summary: string;
  args: { name: string; help: string }[];
  options: OptionSpec[];
  about: string[];
  examples: string[];
}

export const COMMANDS: CommandSpec[] = [
  {
    name: 'login',
    summary: 'where to get an API key, and whether the one in SOLARA_API_KEY works',
    args: [],
    options: [],
    about: [
      'Nothing to sign in to: the CLI reads the key from SOLARA_API_KEY on every run and never stores',
      'or prints it. With a key set, this checks it with one read. Exit 0: the key works; 2: no key.',
    ],
    examples: ['{cli} login'],
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
    summary: 'show where a video is: its state, its rev and the exported rev',
    args: [{ name: 'video_id', help: 'the video_id `start` printed' }],
    options: [],
    about: ['Run it before sending anything new after a failure.'],
    examples: ['{cli} status <video_id>'],
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
    'Setup: SOLARA_API_KEY must hold a key from Settings -> API keys in the Solara app (paid plans).',
    `       \`${cli} login\` says where to get one and checks the one you have.`,
    '',
    'The happy path:',
    `  ${cli} styles                       pick a style id`,
    `  ${cli} upload talk.mp4              prints upload_id and duration_ms`,
    `  ${cli} start --upload <upload_id> --duration-ms <ms> --style <id> \\`,
    '      --title "Runner tips" --prompt "A 30-second tip for new runners"',
    `  ${cli} wait <video_id>              until the edit is ready (minutes)`,
    '  # Show the person the edit link. Export only after they say yes.',
    `  ${cli} export <video_id>            uses one of the plan's videos`,
    `  ${cli} wait <video_id> --until export`,
    `  ${cli} download <video_id> --out talk-edited.mp4`,
    '',
    'Commands:',
    ...COMMANDS.map((command) => `  ${command.name.padEnd(width)}  ${command.summary}`),
    '',
    `Every command takes --json (print the API's answer) and --help (\`${cli} <command> --help\`).`,
    'Exit codes: 0 done, 1 refused (do what the `next:` line on stderr says), 2 bad arguments or no',
    'key, 3 not ready yet (run the same command again later).',
    '',
    'Rules: show the edit and get a yes before exporting; export once per approved edit, never in a',
    "loop; never post, publish or touch billing (an API key can't); never print the API key.",
    '',
    'Environment: SOLARA_API_KEY (required), SOLARA_API_URL (default https://api.solaraai.com),',
    'SOLARA_APP_URL (the app, for edit links), HTTPS_PROXY / NO_PROXY.',
    'Docs: https://docs.solaraai.com/assistants/skill-and-cli',
  ];
  return lines.join('\n');
}

function optionLabel(option: OptionSpec): string {
  return `--${option.name} ${option.choices ? option.choices.join('|') : option.value}`;
}

export function commandHelp(spec: CommandSpec, cli: string): string {
  const required = spec.options.filter((option) => option.required).map(optionLabel);
  const usage = [`${cli} ${spec.name}`, ...spec.args.map((arg) => `<${arg.name}>`), ...required];
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
    'Exit codes: 0 done, 1 refused (read `next:`), 2 bad arguments or no key, 3 not ready yet.',
  ].join('\n');
}
