// Where `solara login` keeps its sign-in: one JSON file only this user may read
// (~/.config/solaraai/credentials.json, mode 600, its folder 700), one entry per API address. The
// tokens in it are never printed, logged or sent anywhere but the API's own token endpoint.
//
// Every write is a whole new file renamed over the old, so a crash never leaves half a file. A
// refresh holds a lock file beside it, so two commands running at once never spend the same
// refresh token twice (the second would revoke the sign-in: reuse detection).

import { randomBytes } from 'node:crypto';
import { chmod, mkdir, open, readFile, rename, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { LIMITS } from './http';

export const CREDENTIALS_FILE = 'credentials.json';
/**
 * A lock older than this was left by a command that died: longer than the slowest refresh it
 * guards can take (a proxy's CONNECT, then the request's whole deadline, with room to spare), so a
 * slow refresh's lock is never broken while it runs (a second refresh would spend the same token).
 */
export const LOCK_STALE_MS = LIMITS.idleMs + LIMITS.requestMs + 30_000;
/** How long a command waits for the lock: until a holder that died would count as stale. */
const LOCK_WAIT_MS = LOCK_STALE_MS + 10_000;

/** One sign-in: the tokens for one API address. */
export interface SignIn {
  client_id: string;
  access_token: string;
  /** Milliseconds since the epoch. */
  access_expires_at: number;
  refresh_token: string;
  scope: string;
  signed_in_at: string;
}

interface CredentialsFile {
  version: 1;
  sign_ins: Record<string, SignIn>;
}

/** The folder the CLI keeps its sign-in in, from the environment only (never a guess): null when
 * none is set, and then nothing is stored. */
export function configDir(env: NodeJS.ProcessEnv): string | null {
  if (env.SOLARA_CONFIG_DIR) return env.SOLARA_CONFIG_DIR;
  if (env.XDG_CONFIG_HOME) return join(env.XDG_CONFIG_HOME, 'solaraai');
  if (env.HOME) return join(env.HOME, '.config', 'solaraai');
  if (env.APPDATA) return join(env.APPDATA, 'solaraai');
  if (env.USERPROFILE) return join(env.USERPROFILE, '.config', 'solaraai');
  return null;
}

function isSignIn(value: unknown): value is SignIn {
  const v = value as Partial<SignIn> | null;
  return (
    typeof v === 'object' &&
    v !== null &&
    typeof v.access_token === 'string' &&
    typeof v.refresh_token === 'string' &&
    typeof v.access_expires_at === 'number' &&
    typeof v.client_id === 'string'
  );
}

export class CredentialStore {
  readonly dir: string;
  readonly path: string;

  constructor(dir: string) {
    this.dir = dir;
    this.path = join(dir, CREDENTIALS_FILE);
  }

  /** The sign-in for apiUrl, or null. A file others may read is made the user's alone first. */
  async read(apiUrl: string): Promise<SignIn | null> {
    const file = await this.readFile();
    const entry = file.sign_ins[apiUrl];
    return isSignIn(entry) ? entry : null;
  }

  /** Stores (or, with null, forgets) the sign-in for apiUrl. */
  async write(apiUrl: string, signIn: SignIn | null): Promise<void> {
    const file = await this.readFile();
    if (signIn) file.sign_ins[apiUrl] = signIn;
    else delete file.sign_ins[apiUrl];
    if (Object.keys(file.sign_ins).length === 0) {
      await rm(this.path, { force: true });
      return;
    }
    await mkdir(this.dir, { recursive: true, mode: 0o700 });
    await chmod(this.dir, 0o700).catch(() => undefined);
    const temporary = `${this.path}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`;
    const handle = await open(temporary, 'wx', 0o600);
    try {
      await handle.writeFile(`${JSON.stringify(file, null, 2)}\n`);
      await handle.sync();
    } finally {
      await handle.close();
    }
    try {
      await rename(temporary, this.path);
    } catch (error) {
      await rm(temporary, { force: true });
      throw error;
    }
    await chmod(this.path, 0o600).catch(() => undefined);
  }

  /** Runs work holding the lock beside the file: one refresh at a time across processes. */
  async locked<T>(work: () => Promise<T>): Promise<T> {
    await mkdir(this.dir, { recursive: true, mode: 0o700 });
    const lock = `${this.path}.lock`;
    const deadline = Date.now() + LOCK_WAIT_MS;
    for (;;) {
      try {
        const handle = await open(lock, 'wx', 0o600);
        await handle.close();
        break;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
        const held = await stat(lock).catch(() => null);
        if (held && Date.now() - held.mtimeMs > LOCK_STALE_MS) {
          await rm(lock, { force: true }); // a command that died holding it
          continue;
        }
        if (Date.now() > deadline) throw new Error(`another solara command holds ${lock}`);
        await new Promise((done) => setTimeout(done, 100));
      }
    }
    try {
      return await work();
    } finally {
      await rm(lock, { force: true });
    }
  }

  private async readFile(): Promise<CredentialsFile> {
    let raw: string;
    try {
      const info = await stat(this.path);
      if (process.platform !== 'win32' && (info.mode & 0o077) !== 0) await chmod(this.path, 0o600);
      raw = await readFile(this.path, 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { version: 1, sign_ins: {} };
      throw error;
    }
    try {
      const parsed = JSON.parse(raw) as Partial<CredentialsFile>;
      const signIns = parsed && typeof parsed.sign_ins === 'object' && parsed.sign_ins ? parsed.sign_ins : {};
      return { version: 1, sign_ins: { ...signIns } };
    } catch {
      // A file that is not ours to read is replaced by the next sign-in, never half-trusted.
      return { version: 1, sign_ins: {} };
    }
  }
}
