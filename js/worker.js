/**
 * worker.js
 * Module Web Worker. Everything CPU-heavy happens here so the main thread
 * (and the <video> element decoding on it) stays responsive.
 *
 * Responsibilities:
 *  - Resize / rotate / flip each incoming video frame on an OffscreenCanvas
 *  - Build a single global colour palette from the first frame (memory-cheap,
 *    avoids holding every frame's pixels in memory at once)
 *  - Quantize + dither each frame against that palette
 *  - Stream frames straight into the GIF encoder, one at a time
 *
 * gifenc is a small, dependency-free GIF encoder/quantizer that works on
 * plain typed arrays, so it runs happily inside a worker with no DOM access.
 */
import { GIFEncoder, quantize, applyPalette } from "https://cdn.jsdelivr.net/npm/gifenc@1.0.3/+esm";

let canvas = null;
let ctx = null;
let gif = null;
let palette = null;
let config = null;
let cancelled = false;
let framesWritten = 0;

const DITHER_MAP = {
  off: false,
  low: "FalseFloydSteinberg",
  medium: true, // FloydSteinberg-serpentine
  high: "Atkinson",
};

const QUALITY_MAP = {
  low: { maxColors: 64, format: "rgb444" },
  medium: { maxColors: 128, format: "rgb565" },
  high: { maxColors: 200, format: "rgb565" },
  veryhigh: { maxColors: 256, format: "rgba4444" },
};

self.onmessage = async (e) => {
  const msg = e.data;
  try {
    switch (msg.type) {
      case "init":
        handleInit(msg);
        break;
      case "frame":
        await handleFrame(msg);
        break;
      case "finish":
        handleFinish();
        break;
      case "cancel":
        cancelled = true;
        cleanup();
        self.postMessage({ type: "cancelled" });
        break;
    }
  } catch (err) {
    self.postMessage({ type: "error", message: err.message || String(err) });
  }
};

function handleInit(msg) {
  cancelled = false;
  framesWritten = 0;
  palette = null;
  config = msg.config; // { width, height, rotate, flip, quality, dithering, loopRepeat }
  canvas = new OffscreenCanvas(config.width, config.height);
  ctx = canvas.getContext("2d", { willReadFrequently: true });
  gif = GIFEncoder();
  self.postMessage({ type: "ready" });
}

async function handleFrame(msg) {
  if (cancelled) return;
  const { bitmap, delayMs, frameIndex, totalFrames } = msg;

  drawTransformed(bitmap);
  bitmap.close(); // release memory immediately, we no longer need the source

  const { width, height } = config;
  const imageData = ctx.getImageData(0, 0, width, height);
  const quality = QUALITY_MAP[config.quality] || QUALITY_MAP.medium;
  const ditherOption = DITHER_MAP[config.dithering] ?? true;

  if (!palette) {
    // Build the palette once, from the first frame. Reusing it for every
    // subsequent frame keeps the file smaller and avoids re-quantizing
    // (and re-storing) every frame's full pixel buffer at once.
    palette = quantize(imageData.data, quality.maxColors, { format: quality.format });
  }

  const index = applyPalette(imageData.data, palette, quality.format, ditherOption);

  gif.writeFrame(index, width, height, {
    palette: framesWritten === 0 ? palette : undefined,
    delay: delayMs,
    repeat: framesWritten === 0 ? config.loopRepeat : undefined,
    transparent: false,
  });

  framesWritten++;
  self.postMessage({ type: "progress", frameIndex, totalFrames, stage: "encoding" });
  self.postMessage({ type: "frameAck" });
}

function drawTransformed(bitmap) {
  const { width, height, rotate, flip } = config;
  ctx.save();
  ctx.clearRect(0, 0, width, height);

  // For 90/270 rotations the source is drawn into a swapped-dimension space
  // then rotated back into the (already swapped) output canvas size, which
  // the caller sized correctly ahead of time.
  ctx.translate(width / 2, height / 2);
  if (rotate === 90) ctx.rotate(Math.PI / 2);
  else if (rotate === 180) ctx.rotate(Math.PI);
  else if (rotate === 270) ctx.rotate(-Math.PI / 2);

  const scaleX = flip === "horizontal" || flip === "both" ? -1 : 1;
  const scaleY = flip === "vertical" || flip === "both" ? -1 : 1;
  ctx.scale(scaleX, scaleY);

  const drawW = rotate === 90 || rotate === 270 ? height : width;
  const drawH = rotate === 90 || rotate === 270 ? width : height;
  ctx.drawImage(bitmap, -drawW / 2, -drawH / 2, drawW, drawH);
  ctx.restore();
}

function handleFinish() {
  if (cancelled) return;
  gif.finish();
  const bytes = gif.bytes();
  self.postMessage(
    { type: "done", bytes, frameCount: framesWritten, sizeBytes: bytes.byteLength },
    [bytes.buffer]
  );
  cleanup();
}

function cleanup() {
  canvas = null;
  ctx = null;
  gif = null;
  palette = null;
}
