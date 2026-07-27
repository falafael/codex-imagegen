/**
 * Runs `codex exec` and guarantees a file lands at the requested destination.
 *
 * Codex always writes generated images into $CODEX_HOME/generated_images/ and
 * copies them onward as a shell step. That copy is the flaky part -- the model
 * can garble the destination or skip it. So we verify the destination and, if
 * it is missing, recover the newest image Codex produced during this run.
 */

import { spawn } from 'node:child_process';
import { copyFile, mkdir, readdir, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const CODEX_HOME = process.env.CODEX_HOME || path.join(os.homedir(), '.codex');
const GENERATED_DIR = path.join(CODEX_HOME, 'generated_images');

export class CodexError extends Error {
  constructor(message, { stdout = '', stderr = '', code } = {}) {
    super(message);
    this.name = 'CodexError';
    this.stdout = stdout;
    this.stderr = stderr;
    this.code = code;
  }
}

/**
 * Invoke Codex non-interactively. stdin is closed because `codex exec` will
 * otherwise wait on it and hang.
 */
function execCodex(prompt, { cwd, refs = [], model, timeoutMs, onLine }) {
  const args = ['exec', '--skip-git-repo-check', '--sandbox', 'workspace-write'];
  if (model) args.push('--model', model);
  for (const ref of refs) args.push('--image', ref.path);
  args.push(prompt);

  return new Promise((resolve, reject) => {
    const child = spawn('codex', args, {
      cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });

    let stdout = '';
    let stderr = '';
    let pending = '';
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, timeoutMs);

    child.stdout.on('data', (chunk) => {
      const text = chunk.toString();
      stdout += text;
      if (!onLine) return;
      pending += text;
      const lines = pending.split(/\r?\n/);
      pending = lines.pop() ?? '';
      for (const l of lines) onLine(l);
    });

    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    child.on('error', (err) => {
      clearTimeout(timer);
      reject(
        err.code === 'ENOENT'
          ? new CodexError('`codex` not found on PATH. Install Codex CLI and run `codex login`.')
          : err,
      );
    });

    child.on('close', (code) => {
      clearTimeout(timer);
      if (timedOut) {
        reject(new CodexError(`Codex timed out after ${Math.round(timeoutMs / 1000)}s`, { stdout, stderr }));
      } else if (code !== 0) {
        reject(new CodexError(`codex exec exited with code ${code}`, { stdout, stderr, code }));
      } else {
        resolve({ stdout, stderr });
      }
    });
  });
}

/** Newest image under $CODEX_HOME/generated_images written after `since`. */
async function newestGeneratedImage(since) {
  if (!existsSync(GENERATED_DIR)) return null;

  let best = null;
  const sessions = await readdir(GENERATED_DIR, { withFileTypes: true });

  for (const session of sessions) {
    if (!session.isDirectory()) continue;
    const dir = path.join(GENERATED_DIR, session.name);
    let files;
    try {
      files = await readdir(dir);
    } catch {
      continue;
    }
    for (const file of files) {
      if (!/\.(png|jpe?g|webp)$/i.test(file)) continue;
      const full = path.join(dir, file);
      const info = await stat(full).catch(() => null);
      if (!info || info.mtimeMs < since) continue;
      if (!best || info.mtimeMs > best.mtimeMs) best = { path: full, mtimeMs: info.mtimeMs };
    }
  }

  return best?.path ?? null;
}

/**
 * Generate one image and place it at `destination`.
 *
 * @returns {Promise<{path: string, recovered: boolean, stdout: string}>}
 */
export async function generateImage(prompt, destination, options = {}) {
  const { refs = [], model, timeoutMs = 300_000, onLine } = options;

  await mkdir(path.dirname(destination), { recursive: true });
  // Sub-second filesystem timestamp rounding can make a file written moments
  // ago look older than the run, so give the window a small margin.
  const startedAt = Date.now() - 2000;

  const { stdout } = await execCodex(prompt, {
    cwd: path.dirname(destination),
    refs,
    model,
    timeoutMs,
    onLine,
  });

  if (existsSync(destination)) return { path: destination, recovered: false, stdout };

  const fallback = await newestGeneratedImage(startedAt);
  if (!fallback) {
    throw new CodexError(
      'Codex produced no image. It may have refused the prompt or hit a rate limit.',
      { stdout },
    );
  }

  await copyFile(fallback, destination);
  return { path: destination, recovered: true, stdout };
}

export { GENERATED_DIR };
