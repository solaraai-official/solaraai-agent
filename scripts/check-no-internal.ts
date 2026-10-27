#!/usr/bin/env bun
// Fails when this repository names something of Solara's that is not public: a Solara host other
// than the public ones, a cluster, an internal host or service, a deploy tag, an AWS account, a
// database id, an email address, an address on someone's machine, a non-production API host, or a
// CI/deploy host. The rules are shapes, never names: this file is public too, so it lists no
// internal host, account or service by name.
//
//   bun scripts/check-no-internal.ts               every tracked file (else every file here)
//   bun scripts/check-no-internal.ts <path>...     those files and folders
//   bun scripts/check-no-internal.ts --history     every line any commit added, and every message
//   bun scripts/check-no-internal.ts --authors     every author's and committer's email address (run it
//                                                  before the first push; CI does not, since outside
//                                                  contributors' addresses are theirs to publish)
//   bun scripts/check-no-internal.ts --self-test   proves each rule catches its shape
//
// A line that has to say one of these (a documented example) carries the marker `no-internal: allow`.
// Exit codes: 0 clean, 1 found something, 2 bad arguments.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';

interface Rule {
  name: string;
  pattern: RegExp;
  isAllowed?: (match: string) => boolean;
}

interface Hit {
  where: string;
  rule: string;
  match: string;
}

const PUBLIC_SOLARA_HOSTS = new Set([
  'solaraai.com',
  'www.solaraai.com',
  'app.solaraai.com',
  'api.solaraai.com',
  'docs.solaraai.com',
]);
const PUBLIC_EMAILS = new Set(['contact@solaraai.com', 'git@github.com', 'noreply@github.com']);
// GitHub's private commit addresses (Settings → Emails → Keep my email addresses private).
const GITHUB_NOREPLY = /@users\.noreply\.github\.com$/i;
// Ports every framework's docs use; a port of ours on this machine is not one of them.
const EXAMPLE_PORTS = new Set(['3000', '5173', '8000', '8080']);
const ALLOW_MARKER = 'no-internal: allow';
const SKIPPED_DIRS = new Set(['.git', 'node_modules', 'dist']);
const MAX_FILE_BYTES = 5 * 1024 * 1024;

export const RULES: Rule[] = [
  {
    name: 'a Solara host that is not public',
    pattern: /\b(?:[a-z0-9-]+\.)*solaraai[a-z0-9-]*\.[a-z]{2,}\b/gi,
    isAllowed: (match) => PUBLIC_SOLARA_HOSTS.has(match.toLowerCase()),
  },
  { name: 'a cluster name', pattern: /\beks-[a-z0-9][a-z0-9-]*/gi },
  // `.internal` as a host's last label (as cloud providers name private hosts), and Kubernetes DNS.
  { name: 'an internal host', pattern: /\b[a-z0-9.-]+\.internal(?![a-z0-9.-])|\bsvc\.cluster\.local\b/gi },
  {
    name: 'an internal service name',
    pattern: /\b[a-z][a-z0-9-]*-internal\b/gi,
    // This script's own name and marker.
    isAllowed: (match) => /(?:^|-)no-internal$/i.test(match),
  },
  { name: 'an image tag of a commit', pattern: /\bsha-[0-9a-f]{7,40}\b/g },
  // Twelve digits standing alone (not inside a hash or a longer number): an AWS account id.
  { name: 'an AWS account id', pattern: /(?<![0-9A-Za-z+/=])[0-9]{12}(?![0-9A-Za-z+/=])/g },
  // Solara's database ids are UUIDv7.
  {
    name: 'a database id',
    pattern: /\b[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/gi,
  },
  {
    name: 'an email address that is not public',
    pattern: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}\b/g,
    isAllowed: (match) => PUBLIC_EMAILS.has(match.toLowerCase()) || GITHUB_NOREPLY.test(match),
  },
  {
    name: 'an address on a local machine',
    pattern: /\b(?:localhost|127\.0\.0\.1|0\.0\.0\.0):\d{2,5}\b/gi,
    isAllowed: (match) => EXAMPLE_PORTS.has(match.split(':').pop() ?? ''),
  },
  { name: 'a non-production API or app host', pattern: /\b(?:dev|stg|staging|qa|test|preview)-(?:api|app|admin)\./gi },
  { name: 'a CI or deploy host', pattern: /\b(?:jenkins|argocd|argo-cd)[a-z0-9-]*(?:\.[a-z0-9-]+)*\.[a-z]{2,}\b/gi },
];

/** Every hit on one line of text. */
export function scanLine(line: string, where: string): Hit[] {
  if (line.includes(ALLOW_MARKER)) return [];
  const hits: Hit[] = [];
  for (const rule of RULES) {
    for (const found of line.matchAll(rule.pattern)) {
      if (!rule.isAllowed?.(found[0])) hits.push({ where, rule: rule.name, match: found[0] });
    }
  }
  return hits;
}

function scanText(text: string, name: string): Hit[] {
  return text.split('\n').flatMap((line, i) => scanLine(line, `${name}:${i + 1}`));
}

function isTextFile(path: string): boolean {
  const size = statSync(path).size;
  if (size > MAX_FILE_BYTES) return false;
  return !readFileSync(path).subarray(0, 8192).includes(0);
}

function filesUnder(path: string): string[] {
  const info = statSync(path);
  if (info.isFile()) return [path];
  if (!info.isDirectory()) return [];
  return readdirSync(path)
    .filter((name) => !SKIPPED_DIRS.has(name))
    .flatMap((name) => filesUnder(join(path, name)));
}

function git(args: string[]): string | null {
  const ran = spawnSync('git', args, { encoding: 'utf8', maxBuffer: 512 * 1024 * 1024 });
  return ran.status === 0 ? ran.stdout : null;
}

/** The files to scan: those named, else every tracked file, else every file under here. */
function filesToScan(paths: string[]): string[] {
  if (paths.length > 0) return paths.flatMap(filesUnder);
  const tracked = (git(['ls-files', '-z']) ?? '').split('\0').filter(Boolean);
  return tracked.length > 0 ? tracked : filesUnder('.');
}

function scanFiles(paths: string[]): Hit[] {
  return filesToScan(paths)
    .filter(isTextFile)
    .flatMap((file) => scanText(readFileSync(file, 'utf8'), relative('.', file) || file));
}

function gitOrExit(args: string[], mode: string): string {
  const out = git(args);
  if (out === null) {
    console.error(`${mode} needs a git repository`);
    process.exit(2);
  }
  return out;
}

/** Every line a commit added, and every commit message, on every branch and tag. */
function scanHistory(): Hit[] {
  const log = gitOrExit(['log', '--all', '--no-color', '--format=commit %H', '-p', '-U0'], '--history');
  const messages = gitOrExit(['log', '--all', '--format=%H%x1f%B%x1e'], '--history');
  const hits: Hit[] = [];
  let commit = '';
  let file = '';
  for (const line of log.split('\n')) {
    if (line.startsWith('commit ')) commit = line.slice(7, 19);
    else if (line.startsWith('+++ ')) file = line.replace(/^\+\+\+ (b\/)?/, '');
    else if (line.startsWith('+')) hits.push(...scanLine(line.slice(1), `${commit} ${file}`));
  }
  for (const entry of messages.split('\x1e')) {
    const [sha = '', body = ''] = entry.trim().split('\x1f');
    if (sha) hits.push(...scanText(body, `${sha.slice(0, 12)} (message)`));
  }
  return hits;
}

/** Every author's and committer's email address, on every branch and tag. */
function scanAuthors(): Hit[] {
  const people = gitOrExit(['log', '--all', '--format=%h author %ae, committer %ce'], '--authors');
  return people
    .split('\n')
    .filter(Boolean)
    .flatMap((line) => scanLine(line, `${line.split(' ')[0]} (author or committer)`));
}

/** Plants one line per rule (built from pieces, so this file itself stays clean) and checks that
 * each is caught, and that the public forms are not. */
function selfTest(): number {
  const planted: Record<string, string> = {
    'a Solara host that is not public': `see https://admin.${'solaraai'}staging.com/x`,
    'a cluster name': `kubectl --context ${'eks'}-prod-tunnel`,
    'an internal host': `postgres://db.${'internal'}:5432`,
    'an internal service name': `http://billing-api-${'internal'}:8080/x`,
    'an image tag of a commit': `image: web:${'sha'}-0123abcd`,
    'an AWS account id': `arn:aws:iam::${'1234'}${'56789012'}:role/x`,
    'a database id': `workspace ${['01890a5d', 'ac96', '774b', 'bcce', 'b302099a8057'].join('-')}`,
    'an email address that is not public': `mail ${'someone'}@${'example'}.org`,
    'an address on a local machine': `open http://${'localhost'}:19080`,
    'a non-production API or app host': `https://${'dev'}-api.example.com`,
    'a CI or deploy host': `https://${'jenkins'}.example.com/job/x`,
  };
  const clean = [
    'https://app.solaraai.com/settings/api-keys and https://docs.solaraai.com',
    'write to contact@solaraai.com; git remote add origin git@github.com:solaraai-official/x.git',
    'author 12345+someone@users.noreply.github.com, committer noreply@github.com',
    'npx -y solaraai@0.1.0 --version; http://localhost:8080 and http://127.0.0.1:3000',
    `run https://${'dev'}-api.example.com # ${ALLOW_MARKER} (a documented example)`,
    'sha512-9wkRDXUXK124pEnAutE6n/l18j+i9GC5IAHK8TmX/2nlySETmky0OU6yL5U8pW1AoKh++AN9auDCr647BfurjQ==',
  ];
  let failures = 0;
  for (const [rule, line] of Object.entries(planted)) {
    if (!scanLine(line, 'planted').some((hit) => hit.rule === rule)) {
      console.error(`self-test: "${rule}" did not catch: ${line}`);
      failures++;
    }
  }
  for (const hit of clean.flatMap((line) => scanLine(line, 'clean'))) {
    console.error(`self-test: a public form was caught as ${hit.rule}: ${hit.match}`);
    failures++;
  }
  // And through a file on disk, as a real run reads one.
  const dir = mkdtempSync(join(tmpdir(), 'check-no-internal-'));
  try {
    writeFileSync(join(dir, 'planted.txt'), Object.values(planted).join('\n'));
    const found = scanFiles([dir]).length;
    if (found < Object.keys(planted).length) {
      console.error(`self-test: a planted file gave ${found} hit(s), not ${Object.keys(planted).length}`);
      failures++;
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  console.log(
    failures ? `self-test: ${failures} failure(s)` : `self-test: all ${RULES.length} rules catch their shape`,
  );
  return failures ? 1 : 0;
}

function report(hits: Hit[]): number {
  // Public CI logs show where and what kind, not the value itself.
  const shown = (match: string) => (process.env.GITHUB_ACTIONS === 'true' ? `${match.slice(0, 4)}…` : match);
  for (const hit of hits) console.error(`${hit.where}: ${hit.rule}: ${shown(hit.match)}`);
  if (hits.length > 0) {
    console.error(
      `\n${hits.length} internal name(s) found. Remove them, or mark a documented example with "${ALLOW_MARKER}".`,
    );
    return 1;
  }
  console.log('no internal names found');
  return 0;
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  if (args.includes('--self-test')) process.exit(selfTest());
  if (args.some((arg) => arg.startsWith('-') && arg !== '--history' && arg !== '--authors')) {
    console.error('usage: bun scripts/check-no-internal.ts [--history | --authors | --self-test | <path>...]');
    process.exit(2);
  }
  if (args.includes('--history')) process.exit(report(scanHistory()));
  if (args.includes('--authors')) process.exit(report(scanAuthors()));
  process.exit(report(scanFiles(args)));
}
