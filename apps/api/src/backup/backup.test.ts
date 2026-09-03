/**
 * The refusal that stands between a recovery and an overwrite (P182-01).
 *
 * `backup restore` is the only command in this CLI that **writes** to a
 * database, and the container running it already holds a superuser URL for
 * production. `sameDatabase` is what stops `RESTORE_DATABASE_URL` being pointed
 * at it — one function, called once, on the worst night this platform will ever
 * have.
 *
 * It was written and shipped untested, which is CLAUDE.md §9.3 exactly: a rule
 * that reads correctly, is called from one place, and is therefore believed.
 * The cases that matter are the ones where the two strings are not equal and
 * still name the same database, because string equality is the implementation
 * somebody would reach for and every one of these would slip past it.
 */

import { describe, expect, it } from "vitest";

import { sameDatabase } from "./backup.js";

const LIVE = "postgres://ds_app:secret@db.internal:5432/ds_education";

describe("sameDatabase — may this restore proceed", () => {
  it("refuses the identical connection string", () => {
    expect(sameDatabase(LIVE, LIVE)).toBe(true);
  });

  it("refuses when only the role differs", () => {
    // The restore runs as a superuser and the backup as the app role. Same
    // database, and this is the likeliest way somebody arrives here.
    expect(
      sameDatabase("postgres://postgres:pw@db.internal:5432/ds_education", LIVE),
    ).toBe(true);
  });

  it("refuses when only the password differs", () => {
    expect(
      sameDatabase("postgres://ds_app:other@db.internal:5432/ds_education", LIVE),
    ).toBe(true);
  });

  it("refuses when one carries query parameters", () => {
    expect(sameDatabase(`${LIVE}?sslmode=require&application_name=restore`, LIVE)).toBe(
      true,
    );
  });

  it("refuses when the port is written out on one side only", () => {
    // 5432 is the default, so omitting it is the same server.
    expect(sameDatabase("postgres://ds_app:secret@db.internal/ds_education", LIVE)).toBe(
      true,
    );
  });

  it("allows a different database on the same server", () => {
    // The documented recovery: `createdb ds_restore_check`, restore into it,
    // look at what came back, promote it. This must not be refused, or the
    // guard makes the runbook impossible instead of safe.
    expect(
      sameDatabase("postgres://postgres:pw@db.internal:5432/ds_restore_check", LIVE),
    ).toBe(false);
  });

  it("allows the same database name on a different host", () => {
    expect(
      sameDatabase("postgres://ds_app:secret@scratch.internal:5432/ds_education", LIVE),
    ).toBe(false);
  });

  it("allows the same database name on a different port", () => {
    // A second cluster on one host — how a restore rehearsal is usually run.
    expect(
      sameDatabase("postgres://ds_app:secret@db.internal:5433/ds_education", LIVE),
    ).toBe(false);
  });

  it("refuses a destination that will not parse", () => {
    // Fails closed. A typo costs a refusal and a second attempt; the other way
    // round it costs the database.
    expect(sameDatabase("ds_restore_check", LIVE)).toBe(true);
    expect(sameDatabase("", LIVE)).toBe(true);
  });

  it("refuses when the source will not parse either", () => {
    expect(sameDatabase("postgres://x@y:5432/z", "not a url")).toBe(true);
  });
});
