/**
 * gif-encoder.js
 * Thin main-thread wrapper around worker.js. Owns the Worker lifecycle and
 * turns its postMessage protocol into a small async API for processor.js:
 *
 *   const encoder = new GifEncoderClient();
 *   await encoder.init({ width, height, rotate, flip, quality, dithering, loopRepeat });
 *   await encoder.addFrame(imageBitmap, delayMs);   // waits for backpressure ack
 *   const { blob, frameCount } = await encoder.finish();
 *   encoder.cancel();
 */
export class GifEncoderClient {
  constructor({ onProgress } = {}) {
    this.worker = null;
    this.onProgress = onProgress || (() => {});
    this._readyPromise = null;
    this._ackWaiters = [];
    this._finishResolve = null;
    this._finishReject = null;
    this._cancelled = false;
  }

  init(config) {
    return new Promise((resolve, reject) => {
      this.worker = new Worker(new URL("./worker.js", import.meta.url), { type: "module" });

      this.worker.onmessage = (e) => this._handleMessage(e.data, resolve, reject);
      this.worker.onerror = (err) => {
        reject(new Error("The GIF encoding worker failed to start: " + err.message));
      };

      this.worker.postMessage({ type: "init", config });
    });
  }

  _handleMessage(msg, initResolve, initReject) {
    switch (msg.type) {
      case "ready":
        initResolve();
        break;
      case "progress":
        this.onProgress(msg);
        break;
      case "frameAck": {
        const waiter = this._ackWaiters.shift();
        if (waiter) waiter.resolve();
        break;
      }
      case "done": {
        const blob = new Blob([msg.bytes], { type: "image/gif" });
        if (this._finishResolve) {
          this._finishResolve({ blob, frameCount: msg.frameCount, sizeBytes: msg.sizeBytes });
        }
        this._terminate();
        break;
      }
      case "cancelled":
        this._cancelled = true;
        if (this._finishReject) this._finishReject(new Error("cancelled"));
        this._terminate();
        break;
      case "error":
        if (initReject) initReject(new Error(msg.message));
        if (this._finishReject) this._finishReject(new Error(msg.message));
        this._ackWaiters.forEach((w) => w.reject(new Error(msg.message)));
        this._ackWaiters = [];
        this._terminate();
        break;
    }
  }

  /**
   * Send one frame to the worker. `bitmap` is an ImageBitmap (transferable);
   * ownership passes to the worker, which closes it once it's been drawn.
   * Resolves once the worker has finished with this frame (backpressure),
   * so the caller never queues up more than one frame's worth of bitmaps.
   */
  addFrame(bitmap, delayMs, frameIndex, totalFrames) {
    if (this._cancelled) return Promise.reject(new Error("cancelled"));
    return new Promise((resolve, reject) => {
      this._ackWaiters.push({ resolve, reject });
      this.worker.postMessage(
        { type: "frame", bitmap, delayMs, frameIndex, totalFrames },
        [bitmap]
      );
    });
  }

  finish() {
    return new Promise((resolve, reject) => {
      this._finishResolve = resolve;
      this._finishReject = reject;
      this.worker.postMessage({ type: "finish" });
    });
  }

  cancel() {
    this._cancelled = true;
    if (this.worker) {
      try {
        this.worker.postMessage({ type: "cancel" });
      } catch (e) {
        /* worker may already be gone */
      }
    }
    this._ackWaiters.forEach((w) => w.reject(new Error("cancelled")));
    this._ackWaiters = [];
    // Terminate immediately rather than waiting for a reply - the user
    // asked to stop, so free resources right away.
    this._terminate();
  }

  _terminate() {
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
    }
  }
}
