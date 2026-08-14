// utils/math.js — shared math helpers

/**
 * Angle (degrees) at vertex b formed by points a-b-c.
 * Returns null if the vectors are degenerate (zero magnitude).
 */
export function calculateAngle(a, b, c) {
  const ab = [a.x - b.x, a.y - b.y];
  const cb = [c.x - b.x, c.y - b.y];

  const magAB = Math.hypot(ab[0], ab[1]);
  const magCB = Math.hypot(cb[0], cb[1]);
  if (magAB === 0 || magCB === 0) return null;

  // Clamp dot/(mag) to [-1,1] to avoid acos NaN from float error.
  const cos = (ab[0] * cb[0] + ab[1] * cb[1]) / (magAB * magCB);
  const angleRad = Math.acos(Math.min(1, Math.max(-1, cos)));
  return angleRad * (180 / Math.PI);
}

export const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
