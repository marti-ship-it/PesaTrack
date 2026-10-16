/**
 * Error helpers for the UI layer.
 *
 * Repositories and services throw ordinary `Error`s with messages already
 * written for a person ("This expense has a refund recorded against it."). These
 * helpers make sure a screen always has something sensible to show, even when
 * the thrown value is not an `Error` at all.
 */

/** Turns an unknown thrown value into a message safe to show the user. */
export function getErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }
  return 'Something went wrong. Please try again.';
}
