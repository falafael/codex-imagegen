#!/usr/bin/env node
/**
 * Installs the generate-image skill into ~/.claude/skills/ so Claude Code can
 * reach this tool from any project, with the wrapper's absolute path baked in.
 *
 * Re-run after moving the repo.
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.dirname(fileURLToPath(import.meta.url));
const entryPoint = path.join(repoRoot, 'imagegen.mjs');
const skillDir = path.join(os.homedir(), '.claude', 'skills', 'generate-image');
const target = path.join(skillDir, 'SKILL.md');

const template = await readFile(path.join(repoRoot, 'skill', 'SKILL.md'), 'utf8');
// Forward slashes work on every platform and avoid escaping issues in the
// markdown code fences.
const rendered = template.replaceAll('{{IMAGEGEN_PATH}}', entryPoint.replaceAll('\\', '/'));

await mkdir(skillDir, { recursive: true });
await writeFile(target, rendered);

process.stdout.write(`Installed skill -> ${target}\nWrapper path -> ${entryPoint}\n\nRestart Claude Code, then ask for an image or run /generate-image.\n`);
