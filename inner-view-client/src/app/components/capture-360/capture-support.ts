/**
 * The guided capture needs a camera (getUserMedia); `?sim=1` bypasses the
 * check because the simulated environment provides its own camera and sensors.
 */
export function captureSupported(): boolean {
  return !!navigator.mediaDevices?.getUserMedia || new URLSearchParams(window.location.search).has('sim');
}
