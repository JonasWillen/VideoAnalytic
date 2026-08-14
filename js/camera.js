// camera.js — shared camera layer

/**
 * Enumerate video input devices. Returns [{deviceId, label}].
 * Requires a prior getUserMedia permission grant to see labels on most browsers.
 */
export async function listCameras() {
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    return devices
      .filter((d) => d.kind === "videoinput")
      .map((d, i) => ({
        deviceId: d.deviceId,
        label: d.label || `Camera ${i + 1}`,
      }));
  } catch (err) {
    console.warn("enumerateDevices failed", err);
    return [];
  }
}

/**
 * Start a camera stream for the given (optional) deviceId at given resolution.
 * Returns the MediaStream. Throws on denial/failure.
 */
export async function startCamera(deviceId = undefined, width = 640, height = 480) {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    throw new Error("getUserMedia is not available in this context. Use https:// or localhost.");
  }
  const constraints = {
    video: {
      width: { ideal: width },
      height: { ideal: height },
      ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
    },
    audio: false,
  };
  return navigator.mediaDevices.getUserMedia(constraints);
}

export function stopStream(stream) {
  if (!stream) return;
  stream.getTracks().forEach((t) => t.stop());
}
