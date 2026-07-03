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
    // image jobs
    createTaskUrl: 'https://api.kie.ai/api/v1/jobs/createTask',
    recordInfoUrl: 'https://api.kie.ai/api/v1/jobs/recordInfo',
    imageModel: process.env.KIE_IMAGE_MODEL || 'gpt-image-2-image-to-image',
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
  claudeConcurrency: parseInt(process.env.CLAUDE_CONCURRENCY || '4', 10),
  imageConcurrency: parseInt(process.env.IMAGE_CONCURRENCY || '3', 10),

  // Feature toggles (can be overridden per-job from the form)
  translateImagesDefault: true,

  phpBin: process.env.PHP_BIN || 'php'
};

module.exports = config;
