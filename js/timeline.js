/**
 * timeline.js
 * A lightweight, dependency-free scrubbing timeline with two draggable
 * markers (start / end) and a thumbnail strip underneath. Reports the
 * selected range back to the caller with millisecond precision.
 */
import { Utils } from "./utils.js";

export class Timeline {
  /**
   * @param {HTMLElement} root - container element for the timeline
   * @param {Object} opts
   * @param {number} opts.duration - total video duration in seconds
   * @param {(range: {start:number,end:number}) => void} opts.onChange
   * @param {(time:number) => void} opts.onScrub - fired while dragging the playhead
   */
  constructor(root, { duration, onChange, onScrub }) {
    this.root = root;
    this.duration = duration;
    this.onChange = onChange || (() => {});
    this.onScrub = onScrub || (() => {});
    this.start = 0;
    this.end = duration;
    this._dragging = null;
    this._build();
  }

  _build() {
    this.root.innerHTML = `
      <div class="tl-thumbs" id="tl-thumbs" aria-hidden="true"></div>
      <div class="tl-track" id="tl-track" role="group" aria-label="Selected range">
        <div class="tl-range" id="tl-range"></div>
        <button class="tl-handle tl-handle-start" id="tl-handle-start"
          role="slider" aria-label="Start time" tabindex="0"
          aria-valuemin="0" aria-valuemax="${this.duration}" aria-valuenow="0"></button>
        <button class="tl-handle tl-handle-end" id="tl-handle-end"
          role="slider" aria-label="End time" tabindex="0"
          aria-valuemin="0" aria-valuemax="${this.duration}" aria-valuenow="${this.duration}"></button>
        <div class="tl-playhead" id="tl-playhead"></div>
      </div>
    `;
    this.track = this.root.querySelector("#tl-track");
    this.rangeEl = this.root.querySelector("#tl-range");
    this.startHandle = this.root.querySelector("#tl-handle-start");
    this.endHandle = this.root.querySelector("#tl-handle-end");
    this.playheadEl = this.root.querySelector("#tl-playhead");
    this.thumbsEl = this.root.querySelector("#tl-thumbs");

    this._attachDrag(this.startHandle, "start");
    this._attachDrag(this.endHandle, "end");
    this._attachKeyboard(this.startHandle, "start");
    this._attachKeyboard(this.endHandle, "end");

    this.track.addEventListener("pointerdown", (e) => {
      if (e.target === this.startHandle || e.target === this.endHandle) return;
      const time = this._xToTime(e.clientX);
      this.onScrub(time);
    });

    this._render();
  }

  setThumbnails(thumbs) {
    this.thumbsEl.innerHTML = "";
    thumbs.forEach((t) => {
      const img = document.createElement("img");
      img.src = t.dataUrl;
      img.alt = "";
      img.style.width = `${100 / thumbs.length}%`;
      this.thumbsEl.appendChild(img);
    });
  }

  setPlayheadTime(time) {
    const pct = Utils.clamp(time / this.duration, 0, 1) * 100;
    this.playheadEl.style.left = `${pct}%`;
  }

  _xToTime(clientX) {
    const rect = this.track.getBoundingClientRect();
    const pct = Utils.clamp((clientX - rect.left) / rect.width, 0, 1);
    return pct * this.duration;
  }

  _attachDrag(handle, which) {
    handle.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      this._dragging = which;
      handle.setPointerCapture(e.pointerId);
    });
    handle.addEventListener("pointermove", (e) => {
      if (this._dragging !== which) return;
      const time = this._xToTime(e.clientX);
      this._updateFromDrag(which, time);
    });
    handle.addEventListener("pointerup", () => {
      this._dragging = null;
      this.onChange({ start: this.start, end: this.end });
    });
    handle.addEventListener("pointercancel", () => {
      this._dragging = null;
    });
  }

  _attachKeyboard(handle, which) {
    handle.addEventListener("keydown", (e) => {
      const step = e.shiftKey ? 1 : 0.05;
      let delta = 0;
      if (e.key === "ArrowLeft") delta = -step;
      else if (e.key === "ArrowRight") delta = step;
      else return;
      e.preventDefault();
      const current = which === "start" ? this.start : this.end;
      this._updateFromDrag(which, current + delta);
      this.onChange({ start: this.start, end: this.end });
    });
  }

  _updateFromDrag(which, time) {
    time = Utils.clamp(time, 0, this.duration);
    const MIN_GAP = 0.05; // 50ms minimum selection
    if (which === "start") {
      this.start = Math.min(time, this.end - MIN_GAP);
      this.start = Math.max(this.start, 0);
    } else {
      this.end = Math.max(time, this.start + MIN_GAP);
      this.end = Math.min(this.end, this.duration);
    }
    this._render();
    this.onScrub(which === "start" ? this.start : this.end);
  }

  /** Programmatically set the range (e.g. from numeric inputs). */
  setRange(start, end) {
    this.start = Utils.clamp(start, 0, this.duration);
    this.end = Utils.clamp(end, this.start + 0.05, this.duration);
    this._render();
  }

  _render() {
    const startPct = (this.start / this.duration) * 100;
    const endPct = (this.end / this.duration) * 100;
    this.startHandle.style.left = `${startPct}%`;
    this.endHandle.style.left = `${endPct}%`;
    this.startHandle.setAttribute("aria-valuenow", this.start.toFixed(2));
    this.endHandle.setAttribute("aria-valuenow", this.end.toFixed(2));
    this.rangeEl.style.left = `${startPct}%`;
    this.rangeEl.style.width = `${Math.max(0, endPct - startPct)}%`;
  }

  getRange() {
    return { start: this.start, end: this.end };
  }
}
