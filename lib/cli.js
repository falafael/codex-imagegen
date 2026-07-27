/**
 * Argument parsing and job construction. Kept separate from execution so the
 * flag surface can be tested without generating images.
 */

import path from 'node:path';
import { resolveSize, USE_CASES } from './spec.js';

const FLAGS_WITH_VALUES = new Set([
  '--out', '-o',
  '--out-dir', '-d',
  '--count', '-n',
  '--size', '-s',
  '--use-case', '-u',
  '--asset-type',
  '--style',
  '--composition',
  '--mood',
  '--palette',
  '--text',
  '--constraints',
  '--avoid',
  '--ref',
  '--batch', '-b',
  '--model', '-m',
  '--timeout',
]);

const ALIASES = {
  '-o': '--out',
  '-d': '--out-dir',
  '-n': '--count',
  '-s': '--size',
  '-u': '--use-case',
  '-b': '--batch',
  '-m': '--model',
};

export class UsageError extends Error {}

/** Turn a prompt into a filesystem-safe basename. */
export function slugify(text, maxLength = 48) {
  const slug = text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, maxLength)
    .replace(/-+$/, '');
  return slug || 'image';
}

export function parseArgs(argv) {
  const opts = { refs: [], prompts: [] };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];

    if (arg === '--help' || arg === '-h') {
      opts.help = true;
      continue;
    }
    if (arg === '--dry-run') {
      opts.dryRun = true;
      continue;
    }
    if (arg === '--quiet' || arg === '-q') {
      opts.quiet = true;
      continue;
    }
    if (arg === '--json') {
      opts.json = true;
      continue;
    }

    if (arg.startsWith('-') && arg !== '-') {
      const [rawFlag, inlineValue] = arg.includes('=') ? arg.split(/=(.*)/s) : [arg, undefined];
      const flag = ALIASES[rawFlag] ?? rawFlag;

      if (!FLAGS_WITH_VALUES.has(rawFlag) && !FLAGS_WITH_VALUES.has(flag)) {
        throw new UsageError(`Unknown flag: ${rawFlag}`);
      }

      const value = inlineValue ?? argv[++i];
      if (value === undefined) throw new UsageError(`${rawFlag} needs a value`);

      // --ref repeats; "path:role" attaches a role label for the prompt.
      if (flag === '--ref') {
        const match = /^(.*?):([a-z][a-z ._-]*)$/i.exec(value);
        opts.refs.push(
          match
            ? { path: path.resolve(match[1]), role: match[2].trim() }
            : { path: path.resolve(value), role: 'reference' },
        );
        continue;
      }

      opts[flag.replace(/^--/, '')] = value;
      continue;
    }

    opts.prompts.push(arg);
  }

  return opts;
}

/**
 * Validate parsed options and expand them into concrete jobs, one per output
 * image. A job carries everything the renderer needs and nothing more.
 */
export function buildJobs(opts, prompts) {
  const count = opts.count ? Number(opts.count) : 1;
  if (!Number.isInteger(count) || count < 1 || count > 25) {
    throw new UsageError('--count must be a whole number between 1 and 25');
  }

  if (opts['use-case'] && !USE_CASES.includes(opts['use-case'])) {
    throw new UsageError(
      `Unknown --use-case "${opts['use-case']}".\nValid values:\n  ${USE_CASES.join('\n  ')}`,
    );
  }

  const size = resolveSize(opts.size);
  const outDir = path.resolve(opts['out-dir'] ?? '.');
  const explicitOut = opts.out ? path.resolve(opts.out) : null;

  if (explicitOut && (prompts.length > 1 || count > 1)) {
    throw new UsageError('--out names a single file; use --out-dir when generating multiple images');
  }

  const shared = {
    useCase: opts['use-case'],
    assetType: opts['asset-type'],
    style: opts.style,
    composition: opts.composition,
    mood: opts.mood,
    palette: opts.palette,
    text: opts.text,
    constraints: opts.constraints,
    avoid: opts.avoid,
    size,
    refs: opts.refs,
  };

  const jobs = [];
  for (const entry of prompts) {
    // Batch-file entries may be objects carrying their own overrides.
    const spec = typeof entry === 'string' ? { prompt: entry } : entry;
    if (!spec.prompt?.trim()) throw new UsageError('Every prompt must be non-empty');

    for (let variant = 1; variant <= count; variant++) {
      const base = spec.name ? slugify(spec.name) : slugify(spec.prompt);
      const suffix = count > 1 ? `-${variant}` : '';
      const destination =
        explicitOut ??
        (spec.out ? path.resolve(outDir, spec.out) : path.join(outDir, `${base}${suffix}.png`));

      jobs.push({
        ...shared,
        ...spec,
        refs: spec.refs ? spec.refs.map((r) => ({ path: path.resolve(r.path ?? r), role: r.role ?? 'reference' })) : shared.refs,
        variant,
        variantCount: count,
        destination: destination.endsWith('.png') || /\.(jpe?g|webp)$/i.test(destination)
          ? destination
          : `${destination}.png`,
      });
    }
  }

  if (jobs.length === 0) throw new UsageError('No prompts given');

  return {
    jobs,
    model: opts.model,
    timeoutMs: opts.timeout ? Number(opts.timeout) * 1000 : 300_000,
    dryRun: Boolean(opts.dryRun),
    quiet: Boolean(opts.quiet),
    json: Boolean(opts.json),
    outDir,
  };
}

export const HELP = `codex-imagegen - generate images through Codex's built-in image_gen tool

Usage:
  imagegen "<prompt>" [options]
  imagegen --batch prompts.json [options]

Output:
  -o, --out <file>        Exact output file (single image only)
  -d, --out-dir <dir>     Directory for outputs, filenames slugged from prompts (default: .)
  -n, --count <n>         Variants per prompt, 1-25 (default: 1)

Art direction (all optional, all folded into the prompt spec):
  -s, --size <size>       square | landscape | portrait | 2k | 2k-landscape | 4k | 4k-portrait
                          | auto | WIDTHxHEIGHT
  -u, --use-case <slug>   Codex taxonomy slug, e.g. logo-brand, product-mockup, ui-mockup
      --asset-type <s>    Where the asset will be used, e.g. "landing page hero"
      --style <s>         Medium, e.g. "flat vector illustration"
      --composition <s>   Framing, e.g. "centered, generous negative space"
      --mood <s>          Lighting and mood
      --palette <s>       Color palette notes
      --text <s>          Exact text to render verbatim in the image
      --constraints <s>   Must-keeps
      --avoid <s>         Negative constraints
      --ref <path[:role]> Reference image, repeatable

Execution:
  -b, --batch <file>      JSON array or newline-delimited prompt file
  -m, --model <name>      Codex model override
      --timeout <secs>    Per-image timeout (default: 300)
      --dry-run           Print the prompts that would be sent, generate nothing
      --json              Machine-readable result summary on stdout
  -q, --quiet             Suppress Codex's streaming output
  -h, --help              This message

Examples:
  imagegen "bald eagle head, navy and red, flat illustration" -o public/eagle.png
  imagegen "cast iron skillet on oak" -u product-mockup -s landscape -d public/img
  imagegen "app dashboard" -u ui-mockup -n 3 -d mockups
  imagegen --batch assets.json -d public/img

Batch file formats:
  Newline-delimited: one prompt per line, blank lines and # comments ignored.
  JSON: [{"prompt": "...", "out": "hero.png", "size": "landscape"}, ...]
`;
