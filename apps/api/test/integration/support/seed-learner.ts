/**
 * Seeding a learner, once, for every integration suite (P21-01).
 *
 * ## Why this file exists
 *
 * Creating a learner used to be one statement:
 *
 * ```sql
 * INSERT INTO users (keycloak_realm, keycloak_sub) VALUES ($1,$2) RETURNING id
 * ```
 *
 * and eight suites wrote their own copy of it. Migration 0025 split the
 * credential out of the person, so it is now two statements against two tables
 * with a foreign key between them — and eight hand-written copies of a
 * two-statement invariant is eight chances to write the second one differently,
 * or to forget it and leave a person no test can sign in as.
 *
 * There is a second reason, and it is the one that matters more. A suite that
 * seeds identity *its own way* stops testing the schema and starts testing its
 * own fixture. `users` no longer has a `keycloak_sub` column at all, so the old
 * inserts fail loudly today — but the next change to identity may not be so
 * kind, and a single seam is what makes it a single edit.
 *
 * These helpers deliberately do **not** go through `provision_learner`: a
 * fixture that calls the production path cannot be used to test that path.
 */

import type { Pool } from "pg";

export interface SeededLearner {
  readonly id: string;
  readonly realm: string;
  readonly subject: string;
}

/**
 * A person with exactly one Keycloak credential — the shape every learner had
 * before P21-01, and still the shape almost every test wants.
 *
 * `profile` fields are optional because most suites do not care about the name;
 * the ones that print a Teilnahmebescheinigung do.
 */
export async function seedLearner(
  pool: Pool,
  input: {
    realm: string;
    subject: string;
    email?: string | null;
    firstName?: string | null;
    lastName?: string | null;
  },
): Promise<SeededLearner> {
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO users (email, first_name, last_name)
     VALUES ($1, $2, $3)
     RETURNING id`,
    [input.email ?? null, input.firstName ?? null, input.lastName ?? null],
  );

  const id = rows[0]?.id;
  if (id === undefined) throw new Error("seedLearner: users insert returned no row");

  await addCredential(pool, id, {
    provider: "keycloak",
    realm: input.realm,
    subject: input.subject,
  });

  return { id, realm: input.realm, subject: input.subject };
}

/**
 * A second way to sign in as an existing person.
 *
 * Only a test may do this directly. In production, linking a credential to a
 * person who already has one is P21-05 — deliberate, audited, and refused when
 * both sides carry different EFNs. Nothing on the authentication path can do
 * it, which is the point of P21-01.
 */
export async function addCredential(
  pool: Pool,
  userId: string,
  credential: { provider: "keycloak" | "local"; realm: string; subject: string },
): Promise<void> {
  await pool.query(
    `INSERT INTO user_identities (user_id, provider, realm, subject)
     VALUES ($1, $2, $3, $4)`,
    [userId, credential.provider, credential.realm, credential.subject],
  );
}
