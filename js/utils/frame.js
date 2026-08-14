// utils/frame.js — frame differencing / motion helpers

/**
 * Count motion pixels along a single vertical line column at xLine.
 * Returns the number of pixels whose RGB difference exceeds threshold.
 */
export function motionOnColumn(frame, prev, xLine, threshold = 30) {
  const w = frame.width;
  const h = frame.height;
  const x = Math.floor(xLine);
  if (x < 0 || x >= w) return 0;

  let motion = 0;
  for (let y = 0; y < h; y++) {
    const i = (y * w + x) * 4;
    const diff =
      Math.abs(frame.data[i] - prev.data[i]) +
      Math.abs(frame.data[i + 1] - prev.data[i + 1]) +
      Math.abs(frame.data[i + 2] - prev.data[i + 2]);
    if (diff > threshold) motion++;
  }
  return motion;
}

/** Capture current frame as ImageData from a 2D context. */
export function grabFrame(ctx, w, h) {
  return ctx.getImageData(0, 0, w, h);
}
