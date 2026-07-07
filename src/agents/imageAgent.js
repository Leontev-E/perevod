'use strict';
// Image agent. Detects translatable text / offer name in an image (Claude
// vision), then rewrites it with GPT Image 2 (image-to-image), forcing the
// result back to the ORIGINAL pixel dimensions and format so layout never shifts.
const sharp = require('sharp');
const { langDirective } = require('../util/lang');
const cfg = require('../config');
const kie = require('../kie');

const MIME = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif' };
function mimeForExt(ext) { return MIME[ext.toLowerCase()] || 'image/png'; }

async function meta(buffer) {
  try { const m = await sharp(buffer).metadata(); return { width: m.width, height: m.height, format: m.format }; }
  catch { return { width: 0, height: 0, format: null }; }
}

// ---- Claude vision: what's on the image? ----
async function analyzeImage(buffer, mime, params) {
  // Downscale big images for the vision call to save tokens.
  let visBuf = buffer, visMime = mime;
  try {
    const m = await sharp(buffer).metadata();
    if ((m.width || 0) > 1024) { visBuf = await sharp(buffer).resize({ width: 1024 }).png().toBuffer(); visMime = 'image/png'; }
  } catch { /* use original */ }

  const prompt =
`Classify this image from a product landing page (being localized to ${langDirective(params)} for ${params.country}; new product name "${params.offerName}").
Return STRICT JSON:
{"category":"product_hero|lifestyle|text_graphic|leave","hasText":true/false,"textItems":["readable words/phrases, verbatim"],"brandOnImage":true/false,"note":"short"}
- category:
  • "product_hero" = the product being sold or its packaging (bottle, box, tube, jar, blister, sachet) shown clearly — whether isolated on a plain background OR inside a certificate/document/badge layout (a CE/ISO conformity certificate that PICTURES the product jar/box still counts as product_hero, because the product itself is visible and should be swapped to the new offer).
  • "lifestyle" = a real photograph of a person or scene holding/using the product (testimonial / review / UGC style). Keep it real.
  • "text_graphic" = a PURE text graphic with NO visible product — a banner, headline, discount %, feature list, guarantee text, or a certificate/document that is TEXT-ONLY (no product photo on it). If the image shows the actual product package, classify it as product_hero, NOT text_graphic.
  • "leave" = decorative element, icon, logo, background, arrow, a person WITHOUT the product, an anatomical/medical diagram, first-aid/cross symbol, or anything with no translatable words and no product/brand.
- hasText / textItems: readable WORDS (ignore pure numbers/symbols like "100%").
- brandOnImage: does a product/brand NAME appear anywhere on it? true/false.
Return ONLY the JSON.`;
  const content = [
    { type: 'text', text: prompt },
    { type: 'image', source: { type: 'base64', media_type: visMime, data: visBuf.toString('base64') } }
  ];
  const { obj } = await kie.claudeJson({ messages: [{ role: 'user', content }], maxTokens: 700, temperature: 0 });
  if (!obj || typeof obj !== 'object') return { category: 'leave', hasText: false, textItems: [], brandOnImage: false };
  const cat = ['product_hero', 'lifestyle', 'text_graphic', 'leave'].includes(obj.category) ? obj.category : 'leave';
  return {
    category: cat,
    hasText: !!obj.hasText,
    textItems: Array.isArray(obj.textItems) ? obj.textItems : [],
    brandOnImage: !!obj.brandOnImage,
    note: obj.note || ''
  };
}

// ---- Edit text/brand on an image, keep everything else. ----
// Primary: GPT Image 2 (best text fidelity). Fallback: Grok Imagine
// (nsfw_checker:false — passes medical/health content GPT Image 2 refuses, and
// renders Cyrillic cleanly). Result is forced back to original dims & format.
async function editImage(buffer, fileName, mime, analysis, params, brief, opts = {}) {
  const dims = await meta(buffer);
  const aspect = pickAspect(dims.width, dims.height);
  const uploadName = 'src_' + Math.abs(hashCode(fileName)) + extFromMime(mime);
  const url = await kie.uploadBase64(buffer, uploadName, mime, 'perevod-src');

  // COMPOSITE mode: an offer photo was uploaded and this image shows the product
  // in a real/review scene → put the NEW offer's package INTO the scene (keep the
  // person/scene), instead of relabeling the OLD product. Triggers for lifestyle
  // photos AND review/testimonial images — vision often labels a review shot
  // "product_hero" because the product is prominent, so the pipeline passes an
  // explicit isReviewImg flag.
  const composite = !!opts.offerRefUrl && (analysis.category === 'lifestyle' || !!opts.isReviewImg);
  let instruction, inputUrls;
  if (composite) {
    instruction =
`The FIRST image is a real photo showing a product. Replace the product/package shown in the FIRST image with the product from the SECOND image — match the SECOND image's packaging shape, colour, label and brand name "${params.offerName}". ` +
`Keep the person, hands, pose, facial expression, background, lighting, framing and composition of the FIRST image EXACTLY as they are — change ONLY the product package. ` +
`Any other visible text must be in ${langDirective(params)}. Keep it photorealistic; do not change the image dimensions.`;
    inputUrls = [url, opts.offerRefUrl];
  } else {
    const keepScene = analysis.category === 'lifestyle'
      ? `This is a real photo — keep the person, pose, hands, scene, lighting and background EXACTLY; only change the text/label on the product. ` : '';
    instruction =
`This is a product marketing image. Rewrite ONLY the text on it, keeping the exact same layout, fonts, sizes, colors, background, product shape and composition. ` +
keepScene +
`Translate every visible word into ${langDirective(params)} (write the text specifically in ${langDirective(params)} — do not use any other local/ethnic language). ` +
`IMPORTANT: any product or brand name shown anywhere (on the packaging, bottle, box, label) must be REPLACED with the brand name "${params.offerName}" — do not keep the original brand name. ` +
(brief && brief.sourceOfferNames && brief.sourceOfferNames.length ? `The old brand names to replace are: ${JSON.stringify(brief.sourceOfferNames).slice(0, 200)}. ` : '') +
`Do not add, remove or move any graphic element. Do not change the image dimensions or crop. Keep it photorealistic and clean. ` +
(analysis.textItems && analysis.textItems.length ? `Text currently on the image (translate these; replace any brand name with "${params.offerName}"): ${JSON.stringify(analysis.textItems).slice(0, 500)}.` : '');
    inputUrls = [url];
  }

  let resultBuf, credits = 0, via = composite ? 'gpt-image-2(composite)' : 'gpt-image-2', resultUrl;
  try {
    const taskId = await kie.createImageTask({ prompt: instruction, inputUrls, aspectRatio: aspect, resolution: '1K' });
    const r = await kie.pollImageTask(taskId, { timeoutMs: 300000, intervalMs: 4000 });
    if (!r.urls || !r.urls.length) throw new Error('no result url');
    resultUrl = r.urls[0]; credits = r.credits || 0;
    resultBuf = await kie.downloadBuffer(resultUrl);
  } catch (e1) {
    // Less-censored fallback chain (Grok → Flux-2 …). For COMPOSITE we pass BOTH
    // images so the fallback can ALSO swap the product to the new offer instead of
    // relabeling the old one.
    const fbPrompt = instruction.replace(/SECOND image/g, 'second reference image');
    const fbInputs = composite ? [url, opts.offerRefUrl] : [url];
    let lastErr = e1, done = false;
    for (const model of cfg.kie.imageFallbacks) {
      try {
        const g = await kie.editImageFallback(model, { prompt: fbPrompt, inputUrls: fbInputs, aspectRatio: aspect });
        resultUrl = g.url; credits = g.credits || 0; via = composite ? g.via + '(composite)' : g.via;
        resultBuf = await kie.downloadBuffer(resultUrl); done = true; break;
      } catch (e2) { lastErr = e2; }
    }
    if (!done) {
      // A COMPOSITE we could not produce must NEVER fall back to relabeling the OLD
      // product — that ships "old product with the new name" (the exact bug). Leave
      // the review/lifestyle image UNCHANGED instead (real photo, old brand stays).
      if (composite) return { buffer, credits: 0, resultUrl: null, dims, via: 'left-composite-failed', unchanged: true };
      throw lastErr;
    }
  }

  const finalBuf = await refit(resultBuf, dims);
  return { buffer: finalBuf, credits, resultUrl, dims, via };
}

async function refit(resultBuf, dims) {
  let out = sharp(resultBuf).resize(dims.width || null, dims.height || null, { fit: 'fill' });
  const fmt = (dims.format || 'png').toLowerCase();
  if (fmt === 'jpeg' || fmt === 'jpg') out = out.jpeg({ quality: 90 });
  else if (fmt === 'webp') out = out.webp({ quality: 90 });
  else out = out.png();
  return out.toBuffer();
}

// Re-encode an edited raster into a sibling format (e.g. png -> webp) so <picture>
// variants stay in sync.
async function reencode(buffer, targetExt, refDims) {
  let s = sharp(buffer);
  if (refDims && refDims.width) s = s.resize(refDims.width, refDims.height, { fit: 'fill' });
  const e = targetExt.toLowerCase();
  if (e === '.webp') return s.webp({ quality: 90 }).toBuffer();
  if (e === '.jpg' || e === '.jpeg') return s.jpeg({ quality: 90 }).toBuffer();
  if (e === '.png') return s.png().toBuffer();
  return buffer;
}

// Replace a product-image slot with the buyer's real offer photo, fitted to the
// original slot's dimensions and format (no distortion — letterboxed to fit).
async function fitReplace(uploadedBuf, refDims, fmt) {
  const w = refDims && refDims.width, h = refDims && refDims.height;
  const format = (fmt || 'png').toLowerCase();
  const transparent = (format === 'png' || format === 'webp');
  let s = sharp(uploadedBuf);
  if (w && h) s = s.resize(w, h, { fit: 'contain', background: transparent ? { r: 0, g: 0, b: 0, alpha: 0 } : { r: 255, g: 255, b: 255, alpha: 1 } });
  if (format === 'jpeg' || format === 'jpg') return s.jpeg({ quality: 90 }).toBuffer();
  if (format === 'webp') return s.webp({ quality: 90 }).toBuffer();
  return s.png().toBuffer();
}

function pickAspect(w, h) {
  if (!w || !h) return 'auto';
  const r = w / h;
  const options = [['1:1', 1], ['3:2', 1.5], ['2:3', 0.666], ['16:9', 1.777], ['9:16', 0.5625], ['4:3', 1.333], ['3:4', 0.75]];
  let best = 'auto', bd = Infinity;
  for (const [name, val] of options) { const d = Math.abs(val - r); if (d < bd) { bd = d; best = name; } }
  return best;
}
function extFromMime(m) { for (const k of Object.keys(MIME)) if (MIME[k] === m) return k; return '.png'; }
function hashCode(s) { let h = 0; for (let i = 0; i < s.length; i++) { h = (h << 5) - h + s.charCodeAt(i); h |= 0; } return h; }

module.exports = { analyzeImage, editImage, reencode, fitReplace, meta, mimeForExt };
