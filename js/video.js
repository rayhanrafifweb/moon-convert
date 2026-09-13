/**
 * video.js
 * Handles loading a user-selected video file into a <video> element,
 * reading its metadata, and sampling a small set of thumbnails for the
 * timeline. Nothing here ever leaves the browser - the file is only ever
 * referenced through an Object URL.
 */
import { Utils } from "./utils.js";

const SUPPORTED_EXTENSIONS = ["mp4", "webm", "mov", "avi", "mkv", "ogv"];

export const VideoModule = {
  /** Current object URL, tracked so we can revoke it on cleanup. */
  _objectUrl: null,

  isLikelySupportedFile(file) {
    const ext = file.name.split(".").pop().toLowerCase();
    const typeOk = file.type.startsWith("video/") || SUPPORTED_EXTENSIONS.includes(ext);
    return typeOk;
  },

  /**
   * Load a File into the given <video> element and resolve with metadata.
   * The <video> element itself must already be in the DOM (muted, playsinline)
   * so that metadata / frame decoding works consistently across browsers.
   */
  load(file, videoEl) {
    return new Promise((resolve, reject) => {
      this.releaseCurrent();

      const url = URL.createObjectURL(file);
      this._objectUrl = url;
      videoEl.src = url;
      videoEl.preload = "metadata";
      videoEl.muted = true;

      const onError = () => {
        cleanupListeners();
        reject(
          new Error(
            "This file could not be decoded. The format or codec may not be supported by your browser."
          )
        );
      };

      const onLoaded = async () => {
        cleanupListeners();
        // Some browsers report duration = Infinity for certain webm/mkv containers
        // until a seek happens. Nudge it to force a correct duration read.
        if (!isFinite(videoEl.duration) || videoEl.duration === 0) {
          try {
            await this._fixInfiniteDuration(videoEl);
          } catch (e) {
            /* non-fatal, we fall back to what we have */
          }
        }

        const fps = await this._estimateFps(videoEl).catch(() => null);

        resolve({
          file,
          url,
          duration: videoEl.duration,
          width: videoEl.videoWidth,
          height: videoEl.videoHeight,
          fps,
          name: file.name,
          size: file.size,
          type: file.type || "unknown",
        });
      };

      const cleanupListeners = () => {
        videoEl.removeEventListener("loadedmetadata", onLoaded);
        videoEl.removeEventListener("error", onError);
      };

      videoEl.addEventListener("loadedmetadata", onLoaded);
      videoEl.addEventListener("error", onError);
    });
  },

  /** Chrome/Firefox workaround for streams that report Infinity duration. */
  _fixInfiniteDuration(videoEl) {
    return new Promise((resolve) => {
      videoEl.currentTime = 1e10;
      const onUpdate = () => {
        videoEl.removeEventListener("timeupdate", onUpdate);
        videoEl.currentTime = 0;
        resolve();
      };
      videoEl.addEventListener("timeupdate", onUpdate);
      setTimeout(resolve, 1500); // safety timeout
    });
  },

  /**
   * Best-effort FPS detection using requestVideoFrameCallback where available.
   * Not all browsers expose real FPS metadata, so callers must treat this as
   * an estimate and always allow manual override.
   */
  _estimateFps(videoEl) {
    return new Promise((resolve, reject) => {
      if (!("requestVideoFrameCallback" in videoEl)) {
        reject(new Error("unsupported"));
        return;
      }
      let count = 0;
      let firstTs = null;
      const wasPaused = videoEl.paused;
      const wasMuted = videoEl.muted;
      videoEl.muted = true;

      const sample = (now, metadata) => {
        count++;
        if (firstTs === null) firstTs = metadata.mediaTime;
        if (count < 12) {
          videoEl.requestVideoFrameCallback(sample);
        } else {
          const elapsed = metadata.mediaTime - firstTs;
          videoEl.pause();
          videoEl.currentTime = 0;
          videoEl.muted = wasMuted;
          if (elapsed > 0) resolve(Math.round(count / elapsed));
          else reject(new Error("could not estimate"));
        }
      };

      videoEl
        .play()
        .then(() => videoEl.requestVideoFrameCallback(sample))
        .catch(() => reject(new Error("autoplay blocked")));

      setTimeout(() => {
        if (wasPaused) videoEl.pause();
        reject(new Error("timeout"));
      }, 2500);
    });
  },

  /**
   * Sample a small, fixed number of thumbnails across the duration for the
   * timeline strip. We intentionally cap the count so long videos don't
   * generate hundreds of canvases and hammer the main thread.
   */
  async generateThumbnails(videoEl, duration, count = 10) {
    const thumbs = [];
    const canvas = document.createElement("canvas");
    const thumbHeight = 64;
    const aspect = videoEl.videoWidth / videoEl.videoHeight || 16 / 9;
    canvas.height = thumbHeight;
    canvas.width = Utils.roundEven(thumbHeight * aspect);
    const ctx = canvas.getContext("2d");

    const wasMuted = videoEl.muted;
    videoEl.muted = true;

    for (let i = 0; i < count; i++) {
      const t = (duration * (i + 0.5)) / count;
      try {
        await this._seekTo(videoEl, t);
        ctx.drawImage(videoEl, 0, 0, canvas.width, canvas.height);
        thumbs.push({ time: t, dataUrl: canvas.toDataURL("image/jpeg", 0.6) });
      } catch (e) {
        // Skip a failed frame rather than aborting the whole strip.
      }
    }

    videoEl.currentTime = 0;
    videoEl.muted = wasMuted;
    return thumbs;
  },

  _seekTo(videoEl, time) {
    return new Promise((resolve, reject) => {
      const onSeeked = () => {
        videoEl.removeEventListener("seeked", onSeeked);
        videoEl.removeEventListener("error", onError);
        resolve();
      };
      const onError = () => {
        videoEl.removeEventListener("seeked", onSeeked);
        videoEl.removeEventListener("error", onError);
        reject(new Error("seek failed"));
      };
      videoEl.addEventListener("seeked", onSeeked);
      videoEl.addEventListener("error", onError);
      videoEl.currentTime = Utils.clamp(time, 0, videoEl.duration || time);
    });
  },

  /** Seek helper exposed for the processor / timeline modules. */
  seekTo(videoEl, time) {
    return this._seekTo(videoEl, time);
  },

  releaseCurrent() {
    if (this._objectUrl) {
      URL.revokeObjectURL(this._objectUrl);
      this._objectUrl = null;
    }
  },
};
