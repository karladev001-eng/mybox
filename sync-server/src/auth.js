export const ROLES = Object.freeze(["owner", "editor", "viewer"]);
const WRITER_ROLES = new Set(["owner", "editor"]);
const TOKEN_BYTES = 32;

/** Roles that may send document updates. A Viewer receives them only. */
export function canWrite(role) {
  return WRITER_ROLES.has(role);
}

export function isValidRole(role) {
  return ROLES.includes(role);
}

/** A Project ID travels in the URL and names a Durable Object, so keep it opaque. */
export function isValidProjectId(value) {
  return typeof value === "string" && /^[A-Za-z0-9._-]{1,128}$/.test(value);
}

export function isValidProfileId(value) {
  return typeof value === "string" && /^[A-Za-z0-9:._-]{1,160}$/.test(value);
}

function toBase64Url(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function randomToken(getRandomValues = (array) => crypto.getRandomValues(array)) {
  return toBase64Url(getRandomValues(new Uint8Array(TOKEN_BYTES)));
}

/**
 * Tokens are stored as digests. A leaked database copy then reveals no token
 * that still opens a Project.
 */
export async function hashToken(token, subtle = crypto.subtle) {
  const digest = await subtle.digest("SHA-256", new TextEncoder().encode(token));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Compares in constant time so a mismatch reveals nothing through timing. */
export function safeEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export function bearerToken(request) {
  const header = request.headers.get("Authorization") ?? "";
  const match = /^Bearer (.+)$/.exec(header.trim());
  return match ? match[1] : null;
}
