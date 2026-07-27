# codex-imagegen

Generate images from the command line by delegating to **Codex CLI's built-in
`image_gen` tool**. No OpenAI API key, no browser automation, no third-party
dependencies — authentication rides on your existing Codex CLI login (a ChatGPT
plan).

```bash
imagegen "a bald eagle head, navy and red, flat illustration" -o public/eagle.png
```

<img src="docs/eagle-example.png" width="380" alt="Example output: a flat-illustration bald eagle head in navy and red on a cream background">

## Why this exists

The obvious way to script "ChatGPT image generation" is to drive the web UI with
Playwright. That path is a dead end: it violates OpenAI's terms, fights bot
detection, breaks whenever the DOM shifts, and risks your account.

It is also unnecessary. Codex CLI ships an `image_gen` tool that is enabled by
default (`codex features list` → `image_generation  stable  true`) and runs on
the same `gpt-image` models, billed to your ChatGPT subscription. This wrapper
just makes that tool scriptable and repeatable.

**The division of labor:** an orchestrator (you, or a coding agent) supplies art
direction; Codex renders. The wrapper assembles a labeled prompt spec in the
format Codex's own imagegen skill expects, pins the execution path to the
built-in tool, enforces the output location, and returns real file paths.

## Requirements

- [Codex CLI](https://developers.openai.com/codex/cli) installed and logged in
  (`codex login`) with a plan that includes image generation
- Node.js 20+

## Install

```bash
git clone https://github.com/<your-username>/codex-imagegen.git
cd codex-imagegen
npm link          # optional, puts `imagegen` on your PATH
node install-skill.mjs   # optional, registers the Claude Code skill
```

There are no npm dependencies to install.

## Usage

```bash
# Single image at an exact path
imagegen "a red barn at dusk" -o assets/barn.png

# Art-directed product shot
imagegen "a cast iron skillet on weathered oak beside fresh rosemary" \
  --use-case product-mockup \
  --size landscape \
  --style "warm rustic product photography" \
  --mood "soft morning window light" \
  --avoid "no text, no watermark, no hands"

# Three variants to choose from
imagegen "minimal logo mark for a hiking brand" -u logo-brand -n 3 -d concepts/

# Reference-guided generation
imagegen "the same mug in a kitchen setting" --ref brand/mug.png:"style reference"

# Inspect the assembled prompt without spending a generation
imagegen "a red barn" --dry-run
```

### Batch

Newline-delimited (`#` comments and blank lines ignored):

```text
a folded American flag on a walnut shelf
leather work gloves on a workbench
```

Or JSON, where each entry can override the shared flags:

```json
[
  { "prompt": "a folded American flag on a walnut shelf", "out": "flag.png", "size": "square" },
  { "prompt": "leather work gloves on a workbench", "size": "landscape" }
]
```

```bash
imagegen --batch assets.json -u product-mockup -d public/img
```

Batch runs are sequential with a 3s gap. A failed item does not abort the run;
every outcome is recorded in `<out-dir>/imagegen-results.json` with the failure
reason, so a partial batch is resumable rather than lost.

### Flags

| Flag | Description |
|---|---|
| `-o, --out <file>` | Exact output file (single image only) |
| `-d, --out-dir <dir>` | Output directory; filenames slugged from prompts |
| `-n, --count <n>` | Variants per prompt, 1–25 |
| `-s, --size <size>` | `square` `landscape` `portrait` `2k` `2k-landscape` `4k` `4k-portrait` `auto` or `WIDTHxHEIGHT` |
| `-u, --use-case <slug>` | Codex taxonomy slug, e.g. `logo-brand`, `ui-mockup` |
| `--asset-type <s>` | Where the asset will be used |
| `--style` `--mood` `--palette` `--composition` | Art direction |
| `--text <s>` | Text that must render verbatim |
| `--constraints` `--avoid` | Positive / negative constraints |
| `--ref <path[:role]>` | Reference image, repeatable |
| `-b, --batch <file>` | Batch file |
| `-m, --model <name>` | Codex model override |
| `--timeout <secs>` | Per-image timeout (default 300) |
| `--dry-run` | Print prompts, generate nothing |
| `--json` | Machine-readable results on stdout |
| `-q, --quiet` | Suppress Codex's streaming output |

Successful image paths go to stdout (one per line, pipeable); progress goes to
stderr. Exit code is `1` if any image failed, `2` on a usage error.

## Sizes

`gpt-image-2` constraints: max edge 3840px, both edges multiples of 16, aspect
ratio ≤ 3:1, total pixels between 655,360 and 8,294,400. Square renders
fastest.

| Name | Pixels |
|---|---|
| `square` | 1024×1024 |
| `landscape` | 1536×1024 |
| `portrait` | 1024×1536 |
| `2k` | 2048×2048 |
| `2k-landscape` | 2048×1152 |
| `4k` | 3840×2160 |
| `4k-portrait` | 2160×3840 |

## Transparency

The built-in tool has no true alpha channel. Generate on a flat chroma-key
background and strip it locally with the helper Codex already ships:

```bash
imagegen "a brass compass on a perfectly flat solid #00ff00 background, no shadows" -o tmp/compass.png
python "$CODEX_HOME/skills/.system/imagegen/scripts/remove_chroma_key.py" \
  --input tmp/compass.png --out compass.png \
  --auto-key border --soft-matte --despill
```

Use `#ff00ff` as the key color for green subjects.

## Claude Code integration

`node install-skill.mjs` writes a `generate-image` skill to
`~/.claude/skills/generate-image/SKILL.md` with this repo's path baked in. After
restarting Claude Code, asking for an image in any project triggers the skill:
Claude reads the destination context, writes the art direction, runs this
wrapper, looks at the output, and iterates. Re-run the installer if you move the
repo.

## How it works

```
prompt + flags
   ↓  lib/spec.js      assembles a labeled spec (use case, style, mood, palette,
   │                   composition, verbatim text, constraints) and wraps it in
   │                   instructions pinning the built-in tool and destination
   ↓  lib/codex.js     codex exec --skip-git-repo-check --sandbox workspace-write
   │                   Codex calls image_gen, writes to $CODEX_HOME/generated_images,
   │                   then copies to the destination
   ↓  verification     if the destination is missing, recover the newest image
                       Codex produced during this run and copy it ourselves
```

That last step matters. Codex's copy-to-destination is a model-issued shell
command, and models occasionally mangle or skip it. The wrapper treats the
destination as a contract: it either lands the file or reports a real failure —
it never claims success for a file that is not on disk.

## Development

```bash
npm test    # unit tests for parsing and prompt assembly; generates no images
```

`node --test test/cli.test.js` covers argument parsing, destination planning,
size resolution, and prompt assembly. Image generation itself is verified by
running the CLI against real prompts.

## License

MIT
