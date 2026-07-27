/**
 * Tests for argument parsing and job planning -- the parts that can be checked
 * without generating an image. Run with `node --test test/`.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { buildJobs, parseArgs, slugify, UsageError } from '../lib/cli.js';
import { buildPrompt, buildSpec, resolveSize } from '../lib/spec.js';

const plan = (argv) => {
  const opts = parseArgs(argv);
  return buildJobs(opts, opts.prompts);
};

test('slugify produces safe basenames', () => {
  assert.equal(slugify('Bald Eagle, navy & red!'), 'bald-eagle-navy-red');
  assert.equal(slugify('***'), 'image');
  assert.ok(slugify('x'.repeat(200)).length <= 48);
});

test('resolveSize accepts names, explicit dimensions, and auto', () => {
  assert.equal(resolveSize('landscape'), '1536x1024');
  assert.equal(resolveSize('4K'), '3840x2160');
  assert.equal(resolveSize('1920x1088'), '1920x1088');
  assert.equal(resolveSize('auto'), 'auto');
  assert.equal(resolveSize(undefined), null);
  assert.throws(() => resolveSize('enormous'), /Unknown --size/);
});

test('single prompt with --out targets that exact file', () => {
  const { jobs } = plan(['a red barn', '-o', 'public/barn.png']);
  assert.equal(jobs.length, 1);
  assert.equal(jobs[0].destination, path.resolve('public/barn.png'));
});

test('destination defaults to a slug in --out-dir and gains a .png extension', () => {
  const { jobs } = plan(['A Red Barn at dusk', '-d', 'assets']);
  assert.equal(jobs[0].destination, path.resolve('assets/a-red-barn-at-dusk.png'));
});

test('--count fans out numbered variants', () => {
  const { jobs } = plan(['logo', '-n', '3', '-d', 'out']);
  assert.deepEqual(
    jobs.map((j) => path.basename(j.destination)),
    ['logo-1.png', 'logo-2.png', 'logo-3.png'],
  );
  assert.deepEqual(jobs.map((j) => j.variant), [1, 2, 3]);
});

test('--out with multiple images is rejected', () => {
  assert.throws(() => plan(['a', 'b', '-o', 'one.png']), UsageError);
  assert.throws(() => plan(['a', '-n', '2', '-o', 'one.png']), UsageError);
});

test('invalid counts and use-cases are rejected', () => {
  assert.throws(() => plan(['a', '-n', '0']), /between 1 and 25/);
  assert.throws(() => plan(['a', '-n', '2.5']), /between 1 and 25/);
  assert.throws(() => plan(['a', '-u', 'not-a-slug']), /Unknown --use-case/);
  assert.throws(() => parseArgs(['a', '--nope', 'x']), /Unknown flag/);
  assert.throws(() => parseArgs(['a', '--size']), /needs a value/);
});

test('--ref parses an optional role suffix and is repeatable', () => {
  const opts = parseArgs(['a', '--ref', 'a.png:style reference', '--ref', 'b.png']);
  assert.equal(opts.refs.length, 2);
  assert.equal(opts.refs[0].role, 'style reference');
  assert.equal(opts.refs[1].role, 'reference');
  assert.ok(path.isAbsolute(opts.refs[0].path));
});

test('inline flag values (--size=landscape) work', () => {
  const { jobs } = plan(['a', '--size=landscape']);
  assert.equal(jobs[0].size, '1536x1024');
});

test('spec omits empty fields and quotes verbatim text', () => {
  const spec = buildSpec({ prompt: 'a barn', text: 'OPEN', useCase: 'ads-marketing' });
  assert.match(spec, /^Use case: ads-marketing$/m);
  assert.match(spec, /^Primary request: a barn$/m);
  assert.match(spec, /^Text \(verbatim\): "OPEN"$/m);
  assert.doesNotMatch(spec, /Color palette/);
  assert.doesNotMatch(spec, /Lighting/);
});

test('spec labels reference images by index', () => {
  const spec = buildSpec({
    prompt: 'a barn',
    refs: [{ path: 'a.png', role: 'style reference' }, { path: 'b.png', role: 'edit target' }],
  });
  assert.match(spec, /Input images: Image 1: style reference; Image 2: edit target/);
});

test('prompt pins the destination and forbids the CLI fallback', () => {
  const prompt = buildPrompt({ prompt: 'a barn' }, 'C:\\out\\barn.png');
  assert.match(prompt, /built-in image_gen tool/);
  assert.match(prompt, /do NOT ask for an OPENAI_API_KEY/i);
  assert.match(prompt, /C:\\out\\barn\.png/);
  assert.match(prompt, /exactly ONE image/);
});

test('batch entries can override destination and size per item', () => {
  const opts = parseArgs(['-d', 'out']);
  const { jobs } = buildJobs(opts, [
    { prompt: 'first', out: 'hero.png' },
    { prompt: 'second', size: 'portrait' },
  ]);
  assert.equal(jobs[0].destination, path.resolve('out/hero.png'));
  assert.equal(path.basename(jobs[1].destination), 'second.png');
  assert.equal(jobs[1].size, 'portrait');
});

test('empty prompts are rejected', () => {
  assert.throws(() => buildJobs(parseArgs([]), ['  ']), /non-empty/);
  assert.throws(() => buildJobs(parseArgs([]), []), /No prompts/);
});
