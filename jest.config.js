/**
 * Jest configuration.
 *
 * `jest-expo` is Expo's official preset: it runs the project's Babel config so
 * TypeScript and JSX work without extra setup, and it reads the `@/*` path
 * alias straight out of tsconfig.json.
 *
 * Jest picks up files named `*.test.ts` (and anything in a `__tests__` folder).
 */
module.exports = {
  preset: 'jest-expo',
  // Report each test, not just the failing ones: for a finance app it is worth
  // seeing exactly which rules were exercised.
  verbose: true,
};
