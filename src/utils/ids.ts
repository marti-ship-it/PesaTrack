import * as Crypto from 'expo-crypto';

/**
 * Generates a unique id for a new record.
 *
 * Records use a UUID v4 — 122 random bits, cryptographically secure. Two
 * records created in the same millisecond on different devices will not
 * collide, which matters once export/import (M8) can merge data.
 *
 * Avoid patterns like `Date.now()` or `Math.random()` for identity: they are
 * predictable and can repeat.
 *
 * It lives in its own module so tests can mock id generation if needed.
 */
export function createId(): string {
  return Crypto.randomUUID();
}

/** Current time as an ISO-8601 timestamp, used for `created_at` / `updated_at`. */
export function nowIso(): string {
  return new Date().toISOString();
}
