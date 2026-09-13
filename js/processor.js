/**
 * processor.js
 * Orchestrates the actual conversion. Frame decoding has to happen on the
 * main thread (that's where the <video> element lives), but each captured
 * frame is a single ImageBitmap, cropped to the source region and handed
 * straight to the worker - we never build up an array of full-resolution
 * frames in memory.
 */
import { Utils } from "./utils.js";
import { VideoModule } from "./video.js";
import { GifEncoderClient } from "./gif-encoder.js";

export class ConversionProcessor {
  constructor({ videoEl, onProgress, onStage }) {
    this.videoEl = videoEl;
    this.onProgress = onProgress || (() => {});
    this.onStage = onStage || (() => {});
    this.encoder = null;
    this._cancelled = false;
  }

  /**
   * @param {Object} settings
   *  start, end (seconds), fps, resolution {width,height}, cropRect (in source px),
   *  rotate (0/90/180/270), flip ('none'|'horizontal'|'vertical'|'both'),
   *  quality ('low'|'medium'|'high'|'veryhigh'), dithering ('off'|'low'|'medium'|'high'),
   *  loopRepeat (0 forever, -1 once, N finite)
   */
  async run(settings) {
    this._cancelled = false;
    const { start, end, fps, resolution, cropRect, rotate, flip } = settings;

    const duration = end - start;
    const totalFrames = Math.max(1, Math.round(duration * fps));
    const delayMs = Math.round(1000 / fps);

    // Output dimensions after rotation (90/270 swap width & height).
    const outW = rotate === 90 || rotate === 270 ? resolution.height : resolution.width;
    const outH = rotate === 90 || rotate === 270 ? resolution.width : resolution.height;

    this.onStage("Preparing video...", 0);
    this.encoder = new GifEncoderClient({
      onProgress: (msg) => {
        this.onStage(`Processing frame ${msg.frameIndex} / ${msg.totalFrames}`, 
          Math.round((msg.frameIndex / msg.totalFrames) * 85)); // reserve 85-100% for encode finalize
      },
    });

    try {
      await this.encoder.init({
        width: outW,
        height: outH,
        rotate,
        flip,
        quality: settings.quality,
        dithering: settings.dithering,
        loopRepeat: settings.loopRepeat,
      });
    } catch (err) {
      throw new Error(
        "Could not start the GIF encoder. Your browser may not support the required Web Worker / OffscreenCanvas features."
      );
    }

    this.onStage("Extracting frames...", 2);

    const wasMuted = this.videoEl.muted;
    this.videoEl.muted = true;

    for (let i = 0; i < totalFrames; i++) {
      if (this._cancelled) {
        this.encoder.cancel();
        this.videoEl.muted = wasMuted;
        throw new Error("cancelled");
      }

      const t = start + (i / fps);
      try {
        await VideoModule.seekTo(this.videoEl, Math.min(t, end));
      } catch (e) {
        // If a single seek fails (rare, corrupt frame range) skip it rather
        // than aborting the whole conversion.
        continue;
      }

      let bitmap;
      try {
        bitmap = await createImageBitmap(
          this.videoEl,
          cropRect.x,
          cropRect.y,
          cropRect.width,
          cropRect.height
        );
      } catch (err) {
        throw new Error(
          "Your browser or device could not process this frame. This can happen with very high resolutions."
        );
      }

      try {
        await this.encoder.addFrame(bitmap, delayMs, i + 1, totalFrames);
      } catch (err) {
        if (err.message === "cancelled") {
          this.videoEl.muted = wasMuted;
          throw new Error("cancelled");
        }
        throw new Error(
          "Your browser or device could not process this GIF at the selected resolution."
        );
      }

      this.onProgress(Math.round((i / totalFrames) * 85), i + 1, totalFrames);
    }

    this.videoEl.muted = wasMuted;

    if (this._cancelled) throw new Error("cancelled");

    this.onStage("Encoding GIF...", 88);
    this.onStage("Optimizing...", 93);
    const result = await this.encoder.finish();
    this.onStage("Finalizing...", 99);

    return {
      blob: result.blob,
      frameCount: result.frameCount,
      sizeBytes: result.sizeBytes,
      width: outW,
      height: outH,
      fps,
      duration,
    };
  }

  cancel() {
    this._cancelled = true;
    if (this.encoder) this.encoder.cancel();
  }
}

/**
 * Rough, honest size estimate shown before conversion starts. GIF file size
 * depends heavily on frame-to-frame colour variance, so this is deliberately
 * a coarse heuristic, not a promise of the final size.
 */
export function estimateGifSize({ width, height, fps, duration, quality, dithering }) {
  const totalFrames = Math.max(1, Math.round(duration * fps));
  const pixelsPerFrame = width * height;
  const qualityBitsPerPixel = { low: 0.9, medium: 1.4, high: 1.9, veryhigh: 2.4 }[quality] || 1.4;
  const ditherFactor = { off: 0.85, low: 0.95, medium: 1.05, high: 1.15 }[dithering] || 1;
  // Assume ~35% inter-frame redundancy from LZW compression on typical video content.
  const bytesPerFrame = (pixelsPerFrame * qualityBitsPerPixel * ditherFactor) / 8 * 0.65;
  const totalBytes = bytesPerFrame * totalFrames + 2048; // + header/palette overhead
  return {
    low: totalBytes * 0.75,
    high: totalBytes * 1.35,
    frames: totalFrames,
  };
}
