/**
 * In-memory chaos-mode flag. Resets on server restart, which is fine for a
 * demo. In production you would back this with Redis so multiple Next.js
 * instances share state — but for a single dev process this is enough.
 */
let chaosMode = false;

export function isChaosMode() {
  return chaosMode;
}

export function setChaosMode(value: boolean) {
  chaosMode = value;
  return chaosMode;
}

export function toggleChaosMode() {
  chaosMode = !chaosMode;
  return chaosMode;
}
