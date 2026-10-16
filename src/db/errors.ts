/**
 * Database error helpers.
 *
 * The database is the last line of defence, so it fails loudly. These helpers
 * translate its raw messages into a decision the UI can act on, rather than
 * letting a screen match on driver text.
 */

/** Thrown when a name is already used by another row (case- and space-insensitive). */
export class DuplicateNameError extends Error {
  constructor(what: string) {
    super(`${what} already exists.`);
    this.name = 'DuplicateNameError';
  }
}

/** True when the error came from a UNIQUE index (for example a repeated name). */
export function isUniqueConstraintViolation(error: unknown): boolean {
  return error instanceof Error && error.message.includes('UNIQUE constraint failed');
}
