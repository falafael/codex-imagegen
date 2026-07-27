/**
 * Builds the prompt text sent to Codex.
 *
 * Codex's built-in imagegen skill expects a labeled spec rather than a bare
 * sentence, so we assemble one and wrap it in instructions that pin down the
 * execution path (built-in tool, one image, exact destination).
 */

/** Use-case slugs from Codex's imagegen taxonomy. Passed through verbatim. */
export const USE_CASES = [
  'photorealistic-natural',
  'product-mockup',
  'ui-mockup',
  'infographic-diagram',
  'scientific-educational',
  'ads-marketing',
  'productivity-visual',
  'logo-brand',
  'illustration-story',
  'stylized-concept',
  'historical-scene',
  'text-localization',
  'identity-preserve',
  'precise-object-edit',
  'lighting-weather',
  'background-extraction',
  'style-transfer',
  'compositing',
  'sketch-to-render',
];

/** Named sizes accepted by gpt-image-2, plus their pixel dimensions. */
export const SIZES = {
  square: '1024x1024',
  landscape: '1536x1024',
  portrait: '1024x1536',
  '2k': '2048x2048',
  '2k-landscape': '2048x1152',
  '4k': '3840x2160',
  '4k-portrait': '2160x3840',
  auto: 'auto',
};

export function resolveSize(size) {
  if (!size) return null;
  const key = String(size).toLowerCase();
  if (SIZES[key]) return SIZES[key];
  if (/^\d+x\d+$/.test(key) || key === 'auto') return key;
  throw new Error(
    `Unknown --size "${size}". Use WIDTHxHEIGHT or one of: ${Object.keys(SIZES).join(', ')}`,
  );
}

const line = (label, value) => (value ? `${label}: ${value}` : null);

/**
 * Assemble the labeled spec block. Only fields with values are emitted so the
 * model is not handed a form full of blanks.
 */
export function buildSpec(job) {
  const parts = [
    line('Use case', job.useCase),
    line('Asset type', job.assetType),
    line('Primary request', job.prompt),
    line('Style/medium', job.style),
    line('Composition/framing', job.composition),
    line('Lighting/mood', job.mood),
    line('Color palette', job.palette),
    line('Dimensions', job.size),
    job.text ? `Text (verbatim): "${job.text}"` : null,
    line('Constraints', job.constraints),
    line('Avoid', job.avoid),
  ];

  if (job.refs?.length) {
    const roles = job.refs.map((ref, i) => `Image ${i + 1}: ${ref.role || 'reference'}`);
    parts.splice(3, 0, `Input images: ${roles.join('; ')}`);
  }

  return parts.filter(Boolean).join('\n');
}

/**
 * Wrap the spec in execution instructions. The negatives matter: without them
 * Codex sometimes offers the CLI fallback and asks for an OPENAI_API_KEY, or
 * substitutes hand-written SVG for a raster asset.
 */
export function buildPrompt(job, destination) {
  return `Generate exactly ONE image using your built-in image_gen tool, then save it to a specific path.

Rules:
- Use the built-in image_gen tool. Do NOT use the CLI fallback, do NOT write or run image-generation code, and do NOT ask for an OPENAI_API_KEY.
- Do NOT substitute SVG, HTML, or CSS. The deliverable is a raster image.
- Generate one image only.
- After generating, copy the final image to exactly this absolute path, overwriting any existing file:
  ${destination}
- Print that absolute path as the final line of your response, with no other commentary on that line.

${buildSpec(job)}`;
}
