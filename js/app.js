/**
 * app.js
 * Top-level UI wiring. Keeps DOM logic separate from the heavier lifting in
 * video.js / processor.js / gif-encoder.js / worker.js so those stay easy to
 * reuse in a future tool.
 */
import { Utils } from "./utils.js";
import { VideoModule } from "./video.js";
import { Timeline } from "./timeline.js";
import { ConversionProcessor, estimateGifSize } from "./processor.js";

const RESOLUTION_PRESETS = [
  { id: "original", label: "Original" },
  { id: "240p", label: "240p", shortEdge: 240 },
  { id: "360p", label: "360p", shortEdge: 360 },
  { id: "480p", label: "480p", shortEdge: 480 },
  { id: "720p", label: "720p HD", shortEdge: 720 },
  { id: "1080p", label: "1080p Full HD", shortEdge: 1080 },
  { id: "1440p", label: "1440p 2K", shortEdge: 1440 },
  { id: "2160p", label: "2160p 4K", shortEdge: 2160 },
  { id: "custom", label: "Custom" },
];

const FPS_OPTIONS = [5, 10, 12, 15, 20, 24, 25, 30, 50, 60];
const CROP_MODES = [
  { id: "original", label: "Original" },
  { id: "16:9", label: "16:9", ratio: 16 / 9 },
  { id: "9:16", label: "9:16", ratio: 9 / 16 },
  { id: "4:3", label: "4:3", ratio: 4 / 3 },
  { id: "1:1", label: "1:1", ratio: 1 },
  { id: "custom", label: "Custom" },
];
const QUALITY_STEPS = [
  { max: 25, id: "low", label: "Low" },
  { max: 55, id: "medium", label: "Medium" },
  { max: 80, id: "high", label: "High" },
  { max: 100, id: "veryhigh", label: "Very High" },
];
const LOOP_OPTIONS = [
  { id: "forever", label: "Forever", repeat: 0 },
  { id: "1", label: "1 time", repeat: -1 },
  { id: "2", label: "2 times", repeat: 1 },
  { id: "3", label: "3 times", repeat: 2 },
];

const MAX_SAFE_PIXELS = 3840 * 2160; // 4K ceiling the pipeline is designed around
const HEAVY_FRAME_COUNT = 450; // combined with high res/fps, triggers a soft warning

const state = {
  file: null,
  meta: null,
  timeline: null,
  crop: { mode: "original", rect: null }, // rect in source pixel coords
  customCrop: null,
  resolution: { mode: "original", width: null, height: null },
  customRes: { width: 1920, height: 1080, lock: true },
  keepAspect: true,
  fps: 15,
  customFps: null,
  qualityValue: 80,
  dithering: "medium",
  loop: "forever",
  rotate: 0,
  flip: "none",
  processor: null,
  lastResultUrl: null,
};

const els = {};

document.addEventListener("DOMContentLoaded", init);

function init() {
  cacheEls();
  renderStaticOptions();
  bindUploadEvents();
  bindSettingsEvents();
  bindActionEvents();
  reportFeatureSupport();
}

function cacheEls() {
  const ids = [
    "upload-zone", "file-input", "browse-btn",
    "workspace", "upload-section",
    "video-el", "video-meta", "timeline-root",
    "start-time-input", "end-time-input", "selection-duration",
    "resolution-select", "custom-res-fields", "custom-width", "custom-height", "lock-aspect-btn",
    "keep-aspect-checkbox",
    "fps-select", "custom-fps-field", "custom-fps",
    "quality-slider", "quality-label",
    "dithering-select",
    "loop-select",
    "crop-select", "custom-crop-fields", "crop-x", "crop-y", "crop-w", "crop-h",
    "rotate-select", "flip-select",
    "estimate-panel", "estimate-duration", "estimate-resolution", "estimate-fps",
    "estimate-frames", "estimate-size",
    "heavy-warning",
    "convert-btn", "cancel-btn",
    "progress-section", "progress-bar", "progress-pct", "progress-stage",
    "result-section", "result-gif", "result-resolution", "result-fps",
    "result-duration", "result-frames", "result-size",
    "before-size", "after-size", "ratio-badge",
    "download-btn", "convert-another-btn", "edit-settings-btn",
    "toast-container", "feature-warning",
  ];
  ids.forEach((id) => (els[toCamel(id)] = document.getElementById(id)));
}

function toCamel(id) {
  return id.replace(/-([a-z0-9])/g, (_, c) => c.toUpperCase());
}

function renderStaticOptions() {
  els.resolutionSelect.innerHTML = RESOLUTION_PRESETS.map(
    (p) => `<option value="${p.id}">${p.label}</option>`
  ).join("");

  els.fpsSelect.innerHTML =
    FPS_OPTIONS.map((f) => `<option value="${f}">${f} FPS</option>`).join("") +
    `<option value="custom">Custom</option>`;
  els.fpsSelect.value = "15";

  els.cropSelect.innerHTML = CROP_MODES.map(
    (c) => `<option value="${c.id}">${c.label}</option>`
  ).join("");

  els.loopSelect.innerHTML = LOOP_OPTIONS.map(
    (l) => `<option value="${l.id}">${l.label}</option>`
  ).join("");

  els.rotateSelect.innerHTML = [0, 90, 180, 270]
    .map((r) => `<option value="${r}">${r}\u00B0</option>`)
    .join("");

  els.flipSelect.innerHTML = [
    { id: "none", label: "None" },
    { id: "horizontal", label: "Horizontal" },
    { id: "vertical", label: "Vertical" },
  ]
    .map((f) => `<option value="${f.id}">${f.label}</option>`)
    .join("");

  els.ditheringSelect.innerHTML = ["off", "low", "medium", "high"]
    .map((d) => `<option value="${d}" ${d === "medium" ? "selected" : ""}>${cap(d)}</option>`)
    .join("");

  els.qualitySlider.value = 80;
  updateQualityLabel();
}

function cap(s) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function reportFeatureSupport() {
  const f = Utils.detectFeatures();
  if (!f.offscreenCanvas || !f.webWorker) {
    els.featureWarning.hidden = false;
    els.featureWarning.textContent =
      "Your browser is missing OffscreenCanvas or Web Worker support, which this tool needs for client-side GIF encoding. Please try a recent version of Chrome, Edge, or Firefox.";
  } else {
    els.featureWarning.hidden = true;
  }
}

/* ------------------------------- Upload ------------------------------- */

function bindUploadEvents() {
  els.browseBtn.addEventListener("click", () => els.fileInput.click());
  els.fileInput.addEventListener("change", (e) => {
    if (e.target.files[0]) handleFile(e.target.files[0]);
  });

  ["dragenter", "dragover"].forEach((evt) =>
    els.uploadZone.addEventListener(evt, (e) => {
      e.preventDefault();
      els.uploadZone.classList.add("drag-active");
    })
  );
  ["dragleave", "drop"].forEach((evt) =>
    els.uploadZone.addEventListener(evt, (e) => {
      e.preventDefault();
      els.uploadZone.classList.remove("drag-active");
    })
  );
  els.uploadZone.addEventListener("drop", (e) => {
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  });
  els.uploadZone.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      els.fileInput.click();
    }
  });
}

async function handleFile(file) {
  if (!VideoModule.isLikelySupportedFile(file)) {
    Utils.toast("That file doesn't look like a supported video format.", "error");
    return;
  }
  if (file.size === 0) {
    Utils.toast("That file is empty and can't be converted.", "error");
    return;
  }
  const MAX_FILE_BYTES = 4 * 1024 * 1024 * 1024; // 4GB soft ceiling
  if (file.size > MAX_FILE_BYTES) {
    Utils.toast("This file is very large (over 4GB) and may exhaust browser memory.", "error");
  }

  try {
    Utils.toast("Loading video…", "info", 2000);
    const meta = await VideoModule.load(file, els.videoEl);
    state.file = file;
    state.meta = meta;
    onVideoLoaded(meta);
  } catch (err) {
    Utils.toast(err.message || "This video could not be loaded.", "error");
  }
}

async function onVideoLoaded(meta) {
  els.uploadSection.hidden = true;
  els.workspace.hidden = false;
  els.resultSection.hidden = true;
  els.progressSection.hidden = true;

  renderVideoMeta(meta);
  resetSettingsForNewVideo(meta);

  state.timeline = new Timeline(els.timelineRoot, {
    duration: meta.duration,
    onChange: (range) => {
      updateTimeInputs(range);
      scheduleEstimateUpdate();
    },
    onScrub: (t) => {
      els.videoEl.currentTime = Utils.clamp(t, 0, meta.duration);
    },
  });
  updateTimeInputs(state.timeline.getRange());

  try {
    const thumbs = await VideoModule.generateThumbnails(els.videoEl, meta.duration, 10);
    state.timeline.setThumbnails(thumbs);
  } catch (e) {
    /* thumbnails are a nice-to-have; failing silently is fine */
  }

  els.videoEl.addEventListener("timeupdate", () => {
    state.timeline?.setPlayheadTime(els.videoEl.currentTime);
  });

  updateEstimate();
}

function renderVideoMeta(meta) {
  const parts = [
    meta.name,
    `${meta.width} \u00D7 ${meta.height}`,
    meta.fps ? `${meta.fps} FPS (estimated)` : "FPS unknown",
    Utils.formatTime(meta.duration, false),
    Utils.formatBytes(meta.size),
  ];
  els.videoMeta.innerHTML = parts.map((p) => `<span>${escapeHtml(p)}</span>`).join("");
}

function resetSettingsForNewVideo(meta) {
  state.crop = { mode: "original", rect: fullFrameRect(meta) };
  state.customCrop = { ...fullFrameRect(meta) };
  state.resolution = { mode: "original", width: meta.width, height: meta.height };
  state.customRes = { width: meta.width, height: meta.height, lock: true };
  els.resolutionSelect.value = "original";
  els.customResFields.hidden = true;
  els.cropSelect.value = "original";
  els.customCropFields.hidden = true;
  els.rotateSelect.value = "0";
  els.flipSelect.value = "none";
  state.rotate = 0;
  state.flip = "none";
}

function fullFrameRect(meta) {
  return { x: 0, y: 0, width: meta.width, height: meta.height };
}

function escapeHtml(s) {
  const div = document.createElement("div");
  div.textContent = s;
  return div.innerHTML;
}

/* ------------------------------ Settings ------------------------------- */

function bindSettingsEvents() {
  // Start / end numeric inputs
  els.startTimeInput.addEventListener("change", () => {
    const t = parseTimeInput(els.startTimeInput.value);
    if (t !== null) {
      state.timeline.setRange(t, state.timeline.getRange().end);
      updateTimeInputs(state.timeline.getRange());
      scheduleEstimateUpdate();
    }
  });
  els.endTimeInput.addEventListener("change", () => {
    const t = parseTimeInput(els.endTimeInput.value);
    if (t !== null) {
      state.timeline.setRange(state.timeline.getRange().start, t);
      updateTimeInputs(state.timeline.getRange());
      scheduleEstimateUpdate();
    }
  });

  // Resolution
  els.resolutionSelect.addEventListener("change", () => {
    const mode = els.resolutionSelect.value;
    els.customResFields.hidden = mode !== "custom";
    if (mode === "custom") {
      els.customWidth.value = state.customRes.width;
      els.customHeight.value = state.customRes.height;
    }
    applyResolutionSetting();
    scheduleEstimateUpdate();
  });
  els.customWidth.addEventListener("input", () => {
    state.customRes.width = Utils.roundEven(parseInt(els.customWidth.value, 10) || 2);
    if (state.customRes.lock) {
      const aspect = cropAspect();
      state.customRes.height = Utils.roundEven(state.customRes.width / aspect);
      els.customHeight.value = state.customRes.height;
    }
    applyResolutionSetting();
    scheduleEstimateUpdate();
  });
  els.customHeight.addEventListener("input", () => {
    state.customRes.height = Utils.roundEven(parseInt(els.customHeight.value, 10) || 2);
    if (state.customRes.lock) {
      const aspect = cropAspect();
      state.customRes.width = Utils.roundEven(state.customRes.height * aspect);
      els.customWidth.value = state.customRes.width;
    }
    applyResolutionSetting();
    scheduleEstimateUpdate();
  });
  els.lockAspectBtn.addEventListener("click", () => {
    state.customRes.lock = !state.customRes.lock;
    els.lockAspectBtn.setAttribute("aria-pressed", String(state.customRes.lock));
    els.lockAspectBtn.classList.toggle("active", state.customRes.lock);
  });
  els.keepAspectCheckbox.addEventListener("change", () => {
    state.keepAspect = els.keepAspectCheckbox.checked;
  });

  // FPS
  els.fpsSelect.addEventListener("change", () => {
    els.customFpsField.hidden = els.fpsSelect.value !== "custom";
    state.fps = els.fpsSelect.value === "custom" ? state.customFps || 15 : parseInt(els.fpsSelect.value, 10);
    maybeShowFpsWarning();
    scheduleEstimateUpdate();
  });
  els.customFps.addEventListener("input", () => {
    state.customFps = Utils.clamp(parseInt(els.customFps.value, 10) || 15, 1, 60);
    state.fps = state.customFps;
    maybeShowFpsWarning();
    scheduleEstimateUpdate();
  });

  // Quality
  els.qualitySlider.addEventListener("input", () => {
    state.qualityValue = parseInt(els.qualitySlider.value, 10);
    updateQualityLabel();
    scheduleEstimateUpdate();
  });
  els.ditheringSelect.addEventListener("change", () => {
    state.dithering = els.ditheringSelect.value;
    scheduleEstimateUpdate();
  });
  els.loopSelect.addEventListener("change", () => (state.loop = els.loopSelect.value));

  // Crop
  els.cropSelect.addEventListener("change", () => {
    const mode = els.cropSelect.value;
    state.crop.mode = mode;
    els.customCropFields.hidden = mode !== "custom";
    recomputeCropRect();
    if (mode === "custom") {
      els.cropX.value = state.crop.rect.x;
      els.cropY.value = state.crop.rect.y;
      els.cropW.value = state.crop.rect.width;
      els.cropH.value = state.crop.rect.height;
    }
    applyResolutionSetting();
    scheduleEstimateUpdate();
  });
  [["cropX", "x"], ["cropY", "y"], ["cropW", "width"], ["cropH", "height"]].forEach(([elId, key]) => {
    els[elId].addEventListener("input", () => {
      const v = parseInt(els[elId].value, 10) || 0;
      state.customCrop[key] = v;
      state.crop.rect = { ...state.customCrop };
      applyResolutionSetting();
      scheduleEstimateUpdate();
    });
  });

  // Rotate / flip
  els.rotateSelect.addEventListener("change", () => {
    state.rotate = parseInt(els.rotateSelect.value, 10);
    scheduleEstimateUpdate();
  });
  els.flipSelect.addEventListener("change", () => {
    state.flip = els.flipSelect.value;
  });
}

function parseTimeInput(value) {
  // Accepts mm:ss.mmm or plain seconds
  if (!value) return null;
  const match = value.match(/^(\d+):(\d{1,2})(?:\.(\d{1,3}))?$/);
  if (match) {
    const [, m, s, ms] = match;
    return parseInt(m, 10) * 60 + parseInt(s, 10) + (ms ? parseInt(ms.padEnd(3, "0"), 10) / 1000 : 0);
  }
  const n = parseFloat(value);
  return isNaN(n) ? null : n;
}

function updateTimeInputs(range) {
  els.startTimeInput.value = Utils.formatTime(range.start);
  els.endTimeInput.value = Utils.formatTime(range.end);
  els.selectionDuration.textContent = `Selection: ${Utils.formatTime(range.end - range.start, true)}`;
}

function cropAspect() {
  const r = state.crop.rect || fullFrameRect(state.meta);
  return r.width / r.height;
}

function recomputeCropRect() {
  const meta = state.meta;
  const mode = state.crop.mode;
  if (mode === "original") {
    state.crop.rect = fullFrameRect(meta);
    return;
  }
  if (mode === "custom") {
    state.crop.rect = { ...state.customCrop };
    return;
  }
  const preset = CROP_MODES.find((c) => c.id === mode);
  const targetRatio = preset.ratio;
  const srcRatio = meta.width / meta.height;
  let w, h;
  if (targetRatio > srcRatio) {
    w = meta.width;
    h = Utils.roundEven(w / targetRatio);
  } else {
    h = meta.height;
    w = Utils.roundEven(h * targetRatio);
  }
  state.crop.rect = {
    x: Utils.roundEven((meta.width - w) / 2),
    y: Utils.roundEven((meta.height - h) / 2),
    width: w,
    height: h,
  };
}

function applyResolutionSetting() {
  const mode = els.resolutionSelect.value;
  const aspect = cropAspect();
  state.resolution.mode = mode;

  if (mode === "original") {
    const r = state.crop.rect;
    state.resolution.width = Utils.roundEven(r.width);
    state.resolution.height = Utils.roundEven(r.height);
  } else if (mode === "custom") {
    state.resolution.width = state.customRes.width;
    state.resolution.height = state.customRes.height;
  } else {
    const preset = RESOLUTION_PRESETS.find((p) => p.id === mode);
    const shortEdge = preset.shortEdge;
    if (aspect >= 1) {
      state.resolution.height = shortEdge;
      state.resolution.width = Utils.roundEven(shortEdge * aspect);
    } else {
      state.resolution.width = shortEdge;
      state.resolution.height = Utils.roundEven(shortEdge / aspect);
    }
  }
  maybeShowResolutionWarning();
}

function updateQualityLabel() {
  const step = QUALITY_STEPS.find((s) => state.qualityValue <= s.max) || QUALITY_STEPS[QUALITY_STEPS.length - 1];
  els.qualityLabel.textContent = `${step.label} (${state.qualityValue})`;
}

function qualityId() {
  const step = QUALITY_STEPS.find((s) => state.qualityValue <= s.max) || QUALITY_STEPS[QUALITY_STEPS.length - 1];
  return step.id;
}

/* --------------------------- Warnings & estimate ------------------------ */

function maybeShowFpsWarning() {
  if (state.fps >= 30) {
    Utils.toast("Higher FPS creates larger GIF files and requires more processing.", "info", 3200);
  }
}

function maybeShowResolutionWarning() {
  const { width, height } = state.resolution;
  if (width * height >= 3840 * 2160 * 0.9) {
    Utils.toast(
      "4K GIF processing is very demanding and may require significant memory.",
      "info",
      4200
    );
  }
}

const scheduleEstimateUpdate = Utils.debounce(() => updateEstimate(), 150);

function updateEstimate() {
  if (!state.meta || !state.timeline) return;
  const range = state.timeline.getRange();
  const duration = range.end - range.start;
  const { width, height } = state.resolution;
  const fps = state.fps;

  els.estimateDuration.textContent = Utils.formatTime(duration, true);
  els.estimateResolution.textContent = `${width} \u00D7 ${height}`;
  els.estimateFps.textContent = `${fps}`;

  const est = estimateGifSize({
    width,
    height,
    fps,
    duration,
    quality: qualityId(),
    dithering: state.dithering,
  });
  els.estimateFrames.textContent = `${est.frames}`;
  els.estimateSize.textContent = `~${Utils.formatBytes(est.low)} \u2013 ${Utils.formatBytes(est.high)}`;

  const totalPixelsTimesFrames = width * height * est.frames;
  const isHeavy =
    width * height >= 3840 * 2160 * 0.9 && fps >= 50 && est.frames >= HEAVY_FRAME_COUNT;
  els.heavyWarning.hidden = !isHeavy;
  if (isHeavy) {
    els.heavyWarning.innerHTML =
      `<strong>High workload.</strong> 4K GIFs at high frame rates can require significant memory and processing time. ` +
      `For a smaller GIF, try 1080p or a lower FPS.`;
  }
}

/* ------------------------------ Conversion ------------------------------ */

function bindActionEvents() {
  els.convertBtn.addEventListener("click", startConversion);
  els.cancelBtn.addEventListener("click", cancelConversion);
  els.downloadBtn.addEventListener("click", downloadResult);
  els.convertAnotherBtn.addEventListener("click", resetToUpload);
  els.editSettingsBtn.addEventListener("click", backToSettings);
}

function gatherSettings() {
  const range = state.timeline.getRange();
  const loopOpt = LOOP_OPTIONS.find((l) => l.id === state.loop);
  return {
    start: range.start,
    end: range.end,
    fps: state.fps,
    resolution: { width: state.resolution.width, height: state.resolution.height },
    cropRect: state.crop.rect,
    rotate: state.rotate,
    flip: state.flip,
    quality: qualityId(),
    dithering: state.dithering,
    loopRepeat: loopOpt ? loopOpt.repeat : 0,
  };
}

async function startConversion() {
  if (!state.meta) return;
  const settings = gatherSettings();

  if (settings.end - settings.start < 0.05) {
    Utils.toast("Select a longer time range before converting.", "error");
    return;
  }

  els.workspace.hidden = true;
  els.progressSection.hidden = false;
  els.resultSection.hidden = true;
  setProgress(0, "Preparing video...");

  const processor = new ConversionProcessor({
    videoEl: els.videoEl,
    onProgress: (pct) => setProgressPercentOnly(pct),
    onStage: (stage, pct) => setProgress(pct, stage),
  });
  state.processor = processor;

  try {
    const result = await processor.run(settings);
    setProgress(100, "Finalizing...");
    showResult(result);
  } catch (err) {
    if (err.message === "cancelled") {
      Utils.toast("Conversion cancelled.", "info");
      backToSettings();
      return;
    }
    Utils.toast(err.message || "Something went wrong during conversion.", "error");
    backToSettings();
  } finally {
    state.processor = null;
  }
}

function cancelConversion() {
  if (state.processor) {
    state.processor.cancel();
  }
}

function setProgress(pct, stage) {
  els.progressBar.style.width = `${Utils.clamp(pct, 0, 100)}%`;
  els.progressBar.setAttribute("aria-valuenow", String(Math.round(pct)));
  els.progressPct.textContent = `${Math.round(pct)}%`;
  els.progressStage.textContent = stage;
}

function setProgressPercentOnly(pct) {
  els.progressBar.style.width = `${Utils.clamp(pct, 0, 100)}%`;
  els.progressBar.setAttribute("aria-valuenow", String(Math.round(pct)));
  els.progressPct.textContent = `${Math.round(pct)}%`;
}

function backToSettings() {
  els.progressSection.hidden = true;
  els.workspace.hidden = false;
}

function showResult(result) {
  if (state.lastResultUrl) URL.revokeObjectURL(state.lastResultUrl);
  const url = URL.createObjectURL(result.blob);
  state.lastResultUrl = url;
  state.lastResult = result;

  els.progressSection.hidden = true;
  els.resultSection.hidden = false;

  els.resultGif.src = url;
  els.resultResolution.textContent = `${result.width} \u00D7 ${result.height}`;
  els.resultFps.textContent = `${result.fps}`;
  els.resultDuration.textContent = Utils.formatTime(result.duration, true);
  els.resultFrames.textContent = `${result.frameCount}`;
  els.resultSize.textContent = Utils.formatBytes(result.sizeBytes);

  els.beforeSize.textContent = Utils.formatBytes(state.file.size);
  els.afterSize.textContent = Utils.formatBytes(result.sizeBytes);
  const reduction = Math.max(0, Math.round((1 - result.sizeBytes / state.file.size) * 100));
  els.ratioBadge.textContent = isFinite(reduction) ? `${reduction}% smaller` : "\u2013";

  els.downloadBtn.dataset.filename = buildFilename(result);
}

function buildFilename(result) {
  const base = Utils.slugifyName(state.file.name) || "video";
  const resMode = state.resolution.mode;
  let resTag;
  if (resMode === "2160p") resTag = "4k";
  else if (resMode === "custom") resTag = `${result.width}x${result.height}`;
  else if (resMode === "original") resTag = `${result.width}x${result.height}`;
  else resTag = resMode;
  return `${base}_${resTag}_${result.fps}fps.gif`;
}

function downloadResult() {
  if (!state.lastResultUrl) return;
  const a = document.createElement("a");
  a.href = state.lastResultUrl;
  a.download = els.downloadBtn.dataset.filename || "converted.gif";
  document.body.appendChild(a);
  a.click();
  a.remove();
}

function resetToUpload() {
  if (state.lastResultUrl) {
    URL.revokeObjectURL(state.lastResultUrl);
    state.lastResultUrl = null;
  }
  VideoModule.releaseCurrent();
  els.fileInput.value = "";
  els.resultSection.hidden = true;
  els.workspace.hidden = true;
  els.uploadSection.hidden = false;
  state.file = null;
  state.meta = null;
}
