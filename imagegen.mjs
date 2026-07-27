#!/usr/bin/env node
/**
 * codex-imagegen: generate images by delegating to Codex CLI's built-in
 * image_gen tool.
 *
 * Auth and billing ride on the Codex CLI login (a ChatGPT plan), so no
 * OPENAI_API_KEY is involved. See README.md for the division of labor.
 */

import { readFile, writeFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { buildJobs, HELP, parseArgs, UsageError } from './lib/cli.js';
import { buildPrompt } from './lib/spec.js';
import { CodexError, generateImage } from './lib/codex.js';

/** Read a batch file as either JSON or newline-delimited prompts. */
async function readBatch(file) {
  const raw = await readFile(file, 'utf8');
  const trimmed = raw.trim();

  if (trimmed.startsWith('[')) {
    const parsed = JSON.parse(trimmed);
    if (!Array.isArray(parsed)) throw new UsageError(`${file} must contain a JSON array`);
    return parsed;
  }

  return trimmed
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'));
}

/**
 * Pause between images. Sequential generation with a gap keeps a long batch
 * from looking like a burst against rate limits.
 */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const opts = parseArgs(process.argv.slice(2));

  if (opts.help || (!opts.prompts.length && !opts.batch)) {
    process.stdout.write(HELP);
    return 0;
  }

  const prompts = opts.batch ? await readBatch(opts.batch) : opts.prompts;
  const plan = buildJobs(opts, prompts);

  for (const job of plan.jobs) {
    for (const ref of job.refs ?? []) {
      const info = await stat(ref.path).catch(() => null);
      if (!info?.isFile()) throw new UsageError(`Reference image not found: ${ref.path}`);
    }
  }

  const log = (msg) => {
    if (!plan.json) process.stderr.write(`${msg}\n`);
  };

  if (plan.dryRun) {
    for (const job of plan.jobs) {
      process.stdout.write(`${'='.repeat(70)}\n-> ${job.destination}\n${'='.repeat(70)}\n`);
      process.stdout.write(`${buildPrompt(job, job.destination)}\n\n`);
    }
    return 0;
  }

  const results = [];
  let failures = 0;

  for (const [index, job] of plan.jobs.entries()) {
    const label = `[${index + 1}/${plan.jobs.length}]`;
    log(`${label} ${job.prompt.slice(0, 70)}${job.prompt.length > 70 ? '...' : ''}`);

    try {
      const { path: saved, recovered } = await generateImage(
        buildPrompt(job, job.destination),
        job.destination,
        {
          refs: job.refs,
          model: plan.model,
          timeoutMs: plan.timeoutMs,
          onLine: plan.quiet ? undefined : (line) => {
            // Codex streams its whole transcript; surface only tool activity.
            if (/image_gen|generating|generated/i.test(line)) log(`      ${line.trim()}`);
          },
        },
      );

      const { size } = await stat(saved);
      log(`${label} saved ${path.relative(process.cwd(), saved)} (${Math.round(size / 1024)} KB)${recovered ? ' [recovered from Codex cache]' : ''}`);
      results.push({ ok: true, prompt: job.prompt, path: saved, bytes: size, recovered });
    } catch (error) {
      failures++;
      const reason = error instanceof CodexError ? error.message : String(error?.message ?? error);
      log(`${label} FAILED: ${reason}`);
      results.push({ ok: false, prompt: job.prompt, path: job.destination, error: reason });
    }

    if (index < plan.jobs.length - 1) await sleep(3000);
  }

  if (plan.jobs.length > 1) {
    const manifest = path.join(plan.outDir, 'imagegen-results.json');
    await writeFile(manifest, `${JSON.stringify(results, null, 2)}\n`);
    log(`\n${results.length - failures}/${results.length} generated. Manifest: ${manifest}`);
  }

  if (plan.json) {
    process.stdout.write(`${JSON.stringify({ results }, null, 2)}\n`);
  } else {
    // Bare paths on stdout so callers can pipe them.
    for (const r of results.filter((r) => r.ok)) process.stdout.write(`${r.path}\n`);
  }

  return failures === 0 ? 0 : 1;
}

main()
  .then((code) => process.exit(code))
  .catch((error) => {
    if (error instanceof UsageError) {
      process.stderr.write(`Error: ${error.message}\n\nRun with --help for usage.\n`);
      process.exit(2);
    }
    process.stderr.write(`${error?.stack ?? error}\n`);
    process.exit(1);
  });
