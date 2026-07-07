'use strict';
const path = require('path');

// All configuration in one place. Secrets come from env; sane defaults for the rest.
const config = {
  port: parseInt(process.env.PORT || '3000', 10),
  // Single shared password gate (see PASSWORD env). Sessions are signed cookies.
  password: process.env.APP_PASSWORD || 'changeme',
  sessionSecret: process.env.SESSION_SECRET || 'perevod-dev-secret-change-me',
  publicBaseUrl: process.env.PUBLIC_BASE_URL || 'https://perevod.boostclicks.ru',

  // Where jobs live on disk (uploads, extracted trees, outputs, previews).
  dataDir: process.env.DATA_DIR || path.join(__dirname, '..', 'data'),

  // kie.ai
  kie: {
    key: process.env.KIE_API_KEY || '',
    // chat (orchestrator) — OpenAI "responses" flavored
    gptUrl: 'https://api.kie.ai/codex/v1/responses',
    gptModel: process.env.KIE_GPT_MODEL || 'gpt-5-5',
    // text agent — Anthropic messages flavored
    claudeUrl: 'https://api.kie.ai/claude/v1/messages',
    claudeModel: process.env.KIE_CLAUDE_MODEL || 'claude-sonnet-5',
    // stronger model, tried on the hardest single fragments Sonnet 5 can't
    // resolve (quality tier). Empty string disables it. Opus 4.8 verified live
    // on kie.ai as `claude-opus-4-8` (2026-07-07; slower, so used selectively).
    claudeStrongModel: process.env.KIE_CLAUDE_STRONG_MODEL || 'claude-opus-4-8',
    // Whole-site "Site Context Artifact" pass: reasons over ALL fragments at once
    // to pin one-name-per-person, terminology, tone & offer name. Opus 4.8 (large
    // context) is the point of this pass; its OUTPUT is compact maps, not prose,
    // so the 8000-token output cap is comfortable.
    claudeArtifactModel: process.env.KIE_CLAUDE_ARTIFACT_MODEL || 'claude-opus-4-8',
    // Optional per-job "quality mode": run the MAIN batch translation on Opus 4.8
    // instead of Sonnet 5 (premium offers). Slower/pricier — off by default.
    claudeQualityModel: process.env.KIE_CLAUDE_QUALITY_MODEL || 'claude-opus-4-8',
    // image jobs
    createTaskUrl: 'https://api.kie.ai/api/v1/jobs/createTask',
    recordInfoUrl: 'https://api.kie.ai/api/v1/jobs/recordInfo',
    imageModel: process.env.KIE_IMAGE_MODEL || 'gpt-image-2-image-to-image',
    // ordered, less-censored image fallbacks tried when GPT Image 2 fails/refuses.
    // Grok first (uncensored + clean Cyrillic), then Flux-2 as a last resort.
    imageFallbacks: (process.env.IMAGE_FALLBACK_MODELS || 'grok-imagine/image-to-image,flux-2/pro-image-to-image')
      .split(',').map(s => s.trim()).filter(Boolean),
    // file upload (note: this host lives behind Cloudflare and blocks non-browser UAs)
    uploadUrl: 'https://kieai.redpandaai.co/api/file-base64-upload',
    userAgent: 'Mozilla/5.0 (perevod.boostclicks.ru)'
  },

  // Files whose *basename* is never touched (backend endpoints).
  excludedBasenames: (process.env.EXCLUDE_FILES || 'api.php,error.php,success.php')
    .split(',').map(s => s.trim().toLowerCase()).filter(Boolean),
  // Whole directories never touched (pre-made success/error localization dictionaries).
  excludedDirs: (process.env.EXCLUDE_DIRS || 'success,error')
    .split(',').map(s => s.trim().toLowerCase()).filter(Boolean),

  // Limits
  maxUploadMb: parseInt(process.env.MAX_UPLOAD_MB || '80', 10),
  maxImages: parseInt(process.env.MAX_IMAGES || '60', 10),        // hard cap on image edits per job
  textBatchChars: parseInt(process.env.TEXT_BATCH_CHARS || '6000', 10),
  // Deterministic translation: temperature 0 makes a repeated source string
  // translate identically everywhere (kills tone/wording drift). Overridable.
  textTemperature: (() => { const v = parseFloat(process.env.TEXT_TEMPERATURE); return Number.isFinite(v) ? v : 0; })(),
  claudeConcurrency: parseInt(process.env.CLAUDE_CONCURRENCY || '4', 10),
  imageConcurrency: parseInt(process.env.IMAGE_CONCURRENCY || '3', 10),

  // Feature toggles (can be overridden per-job from the form)
  translateImagesDefault: true,
  // Per-job "quality mode" (Opus 4.8 for the main translation) default. Off = Sonnet 5.
  qualityModeDefault: /^(1|true|yes|on)$/i.test(process.env.QUALITY_MODE || ''),

  phpBin: process.env.PHP_BIN || 'php'
};

module.exports = config;
