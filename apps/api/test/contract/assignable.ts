/**
 * Type-level assertions for the contract tests.
 *
 * The job: prove the API's zod DTOs and the SDK's generated types describe the
 * same shapes, so `contracts/openapi.yaml` cannot drift from what the server
 * actually serialises without failing `tsc`.
 *
 * ## Why the normaliser exists
 *
 * `exactOptionalPropertyTypes: true` (tsconfig.base.json) distinguishes
 * `{ a?: number }` from `{ a?: number | undefined }`. zod's `.optional()`
 * infers the second; openapi-typescript emits the first. Both describe exactly
 * the same JSON — a key that may be absent — so comparing them raw reports a
 * mismatch that does not exist, on every optional field.
 *
 * `Normalise` widens optional properties to include `undefined` on **both**
 * sides, recursively, so that artifact cancels out. What it deliberately does
 * NOT do is erase optionality itself: a field required on one side and
 * optional on the other still has different `OptionalKeys` and still fails.
 * The properties still checked after normalisation are the ones that matter —
 * the set of keys, each key's type, and required-vs-optional.
 */

type OptionalKeys<T> = {
  [K in keyof T]-?: object extends Pick<T, K> ? K : never;
}[keyof T];

type RequiredKeys<T> = Exclude<keyof T, OptionalKeys<T>>;

/** Recursively widen optional properties to `| undefined`; leave the rest alone. */
export type Normalise<T> = T extends (infer E)[]
  ? Normalise<E>[]
  : T extends ReadonlyArray<infer E>
    ? ReadonlyArray<Normalise<E>>
    : T extends Date
      ? T
      : T extends object
        ? { [K in RequiredKeys<T>]: Normalise<T[K]> } & {
            [K in OptionalKeys<T>]?: Normalise<T[K]> | undefined;
          }
        : T;

/** True only when A and B are assignable in both directions, post-normalisation. */
export type MutuallyAssignable<A, B> = [Normalise<A>] extends [Normalise<B>]
  ? [Normalise<B>] extends [Normalise<A>]
    ? true
    : false
  : false;

/** Fails compilation unless T is exactly `true`. */
export type Expect<T extends true> = T;
