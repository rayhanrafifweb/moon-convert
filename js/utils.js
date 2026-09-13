/**
 * utils.js
 * Small, dependency-free helper functions shared across the app.
 * Kept framework-free on purpose so any module can import it.
 */

export const Utils = {
  /** Clamp a number between min and max. */
  clamp(value, min, max) {
    return Math.min(Math.max(value, min), max);
  },

  /** Format seconds (float) as mm:ss.mmm */
  formatTime(seconds, withMillis = true) {
    if (!isFinite(seconds) || seconds < 0) seconds = 0;
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    const ms = Math.floor((seconds - Math.floor(seconds)) * 1000);
    const base = `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
    return withMillis ? `${base}.${String(ms).padStart(3, "0")}` : base;
  },

  /** Format bytes into a human readable string. */
  formatBytes(bytes) {
    if (!isFinite(bytes) || bytes <= 0) return "0 B";
    const units = ["B", "KB", "MB", "GB"];
    const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
    const value = bytes / Math.pow(1024, i);
    return `${value.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
  },

  /** Round to nearest even number (some encoders / codecs prefer even dimensions). */
  roundEven(n) {
    n = Math.round(n);
    return n % 2 === 0 ? n : n + 1;
  },

  /** Generate a filesystem-safe slug from a filename (without extension). */
  slugifyName(filename) {
    const base = filename.replace(/\.[^/.]+$/, "");
    return base.replace(/[^a-z0-9\-_]+/gi, "_").replace(/_+/g, "_");
  },

  /** Debounce a function call. */
  debounce(fn, wait = 100) {
    let t = null;
    return (...args) => {
      clearTimeout(t);
      t = setTimeout(() => fn(...args), wait);
    };
  },

  /** Detect whether a set of critical web APIs are available. */
  detectFeatures() {
    return {
      offscreenCanvas: "OffscreenCanvas" in window,
      webWorker: "Worker" in window,
      webCodecs: "VideoDecoder" in window && "VideoFrame" in window,
      requestVideoFrameCallback: "requestVideoFrameCallback" in HTMLVideoElement.prototype,
    };
  },

  /** Estimate device memory in GB (fallback to a conservative default). */
  estimatedDeviceMemoryGB() {
    return navigator.deviceMemory || 4;
  },

  /** Simple greatest common divisor, used for aspect ratio labels. */
  gcd(a, b) {
    a = Math.abs(Math.round(a));
    b = Math.abs(Math.round(b));
    while (b) {
      [a, b] = [b, a % b];
    }
    return a || 1;
  },

  aspectRatioLabel(width, height) {
    const g = Utils.gcd(width, height);
    return `${Math.round(width / g)}:${Math.round(height / g)}`;
  },

  /** Create a small notification / toast. Returns the element in case caller wants to dismiss it early. */
  toast(message, type = "info", duration = 4200) {
    const container = document.getElementById("toast-container");
    if (!container) return null;
    const el = document.createElement("div");
    el.className = `toast toast-${type}`;
    el.setAttribute("role", type === "error" ? "alert" : "status");
    el.innerHTML = `<span class="toast-text"></span>`;
    el.querySelector(".toast-text").textContent = message;
    container.appendChild(el);
    requestAnimationFrame(() => el.classList.add("toast-visible"));
    const remove = () => {
      el.classList.remove("toast-visible");
      setTimeout(() => el.remove(), 220);
    };
    const timer = setTimeout(remove, duration);
    el.addEventListener("click", () => {
      clearTimeout(timer);
      remove();
    });
    return el;
  },
};
