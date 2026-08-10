/**
 * The helper every integration suite had its own copy of (P34-02).
 *
 * `requireEnv` was declared, character for character, in **seventeen** files.
 * It is not interesting code, which is exactly why it spread: three lines
 * somebody reasonably wrote rather than went looking for.
 *
 * The cost was not the duplication itself. Fifteen of the seventeen threw one
 * message and two threw another, so "what does a suite do when DATABASE_URL is
 * missing" already had two answers — and improving the message would have had
 * to be done seventeen times to be true anywhere.
 *
 * The message now names the command that sets all four, which is the thing
 * somebody hitting this actually needs and which none of the seventeen said.
 */

/**
 * A required connection string or setting, or a refusal that says what to do.
 *
 * Integration suites read four of these and are useless without them. Failing
 * here beats failing six layers down inside a driver, which is the shape this
 * took before anybody wrote the check.
 */
export function requireEnv(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === "") {
    throw new Error(
      `${name} must be set to run the integration suite. ` +
        "Run `pnpm test:integration`, which sets all four — see CONTRIBUTING.md.",
    );
  }
  return value;
}
