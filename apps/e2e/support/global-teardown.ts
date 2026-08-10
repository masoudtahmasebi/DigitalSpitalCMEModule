/** Stop what `global-setup.ts` started. */
// eslint-disable-next-line no-restricted-syntax -- Playwright loads these by default export
export default async function globalTeardown(): Promise<void> {
  await globalThis.__dsStack?.stop();
}
