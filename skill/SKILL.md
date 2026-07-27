---
name: generate-image
description: Use when the user asks for a generated image, illustration, photo, logo concept, mockup, texture, sprite, hero image, banner, or any raster asset that does not exist yet - including "make me an image of X", "generate a hero for this page", "I need an icon set", or asset placeholders while building a UI. Delegates rendering to Codex CLI's built-in image_gen tool via the codex-imagegen wrapper. Do not use for editing existing SVG/vector assets or for charts and diagrams that should be code-native.
---

# Generating Images

You art-direct; Codex renders. Your job is to turn a loose request into a precise
spec, run the wrapper, look at the result, and iterate. Never hand the user an
image you have not looked at.

## The tool

```bash
node {{IMAGEGEN_PATH}} "<prompt>" [flags]
```

Auth rides on the Codex CLI login (a ChatGPT plan). There is no API key. If the
command reports `codex not found`, tell the user to install Codex CLI and run
`codex login` — do not fall back to writing an OpenAI API script, and do not
suggest browser automation.

Run `node .../imagegen.mjs --help` for the full flag list. The ones that matter
most:

| Flag | Use |
|---|---|
| `-o <file>` | exact output path, single image |
| `-d <dir>` | output directory, filenames slugged from prompts |
| `-n <count>` | variants of one prompt, for picking a favorite |
| `-s <size>` | `square`, `landscape`, `portrait`, `2k`, `4k`, or `WIDTHxHEIGHT` |
| `-u <slug>` | use-case slug (see below) — sets the model's polish level |
| `--style`, `--mood`, `--palette`, `--composition` | art direction |
| `--text "..."` | text that must render verbatim in the image |
| `--avoid "..."` | negative constraints |
| `--ref <path:role>` | reference image, repeatable |
| `--batch <file>` | JSON array or newline-delimited prompts |
| `--dry-run` | show the assembled prompt without generating |

Use-case slugs: `photorealistic-natural`, `product-mockup`, `ui-mockup`,
`infographic-diagram`, `scientific-educational`, `ads-marketing`,
`productivity-visual`, `logo-brand`, `illustration-story`, `stylized-concept`,
`historical-scene`.

## Workflow

1. **Read the destination context first.** If the image goes into a project,
   check where similar assets live and what the surrounding design looks like
   (palette, illustration style, aspect ratios). An asset that ignores the
   project's visual language is a failed asset even if it is a nice picture.
2. **Pick the use-case slug and size** from where the asset will actually be
   used. Hero banners are `landscape`, app icons are `square`, phone screens
   are `portrait`.
3. **Write real art direction.** Convert a vague request into concrete
   `--style`, `--mood`, `--palette`, and `--composition` values. Add
   `--avoid "no text, no watermark"` by default unless text is wanted — stray
   garbled lettering is the most common defect.
4. **Generate.** Use `-n 3` when the user is exploring a look and has not
   committed to a direction; use `-n 1` when they have.
5. **Look at every image** with the Read tool. Check the subject, the style,
   the composition, that any `--text` rendered correctly and is spelled right,
   and that nothing on the avoid list slipped in.
6. **Iterate with one change at a time.** Adjust a single dimension and
   regenerate. Changing three things at once makes it impossible to tell what
   helped.
7. **Report the saved paths** and, if the asset is project-bound, wire it into
   the consuming code.

## Prompt shape

Order the description scene → subject → details → constraints. Be concrete
about medium and light; those two do most of the work.

Weak: `a coffee mug`
Strong: `a matte white ceramic mug on a pale concrete surface, single sprig of
steam` with `--style "editorial product photography, 85mm"` `--mood "soft
diffused north light, low contrast"` `--composition "centered, generous
negative space above for headline copy"` `--avoid "no text, no watermark, no
hands"`.

For text in an image, quote it exactly via `--text` and spell out tricky words
letter by letter in the prompt. Image models garble long strings — keep
rendered copy to a few words.

## Reference images

Pass local files with `--ref path:role`, labeling the role so the model knows
what to do with it: `--ref brand.png:"style reference"`,
`--ref photo.jpg:"edit target"`. Reference the roles in your prompt text
("match the palette of Image 1").

## Limits

- **Transparency:** the built-in tool has no true alpha channel. For a cutout,
  generate on a flat `#00ff00` background and strip it with
  `python "$CODEX_HOME/skills/.system/imagegen/scripts/remove_chroma_key.py"
  --input src.png --out final.png --auto-key border --soft-matte --despill`.
  Use `#ff00ff` as the key if the subject is green.
- **Not for everything raster-shaped:** icons and logos that must match an
  existing SVG system should be edited as vectors. Charts and diagrams should
  be built in code — load the `dataviz` skill instead.
- **Rate limits:** batches pace themselves 3s apart, but a long run can still
  hit plan limits. Failures land in `imagegen-results.json` with reasons, so a
  partial batch is resumable rather than lost.
