/**
 * Unit tests for the part that needs no database.
 *
 * `stripTransactionControl` is the piece with a sharp edge: it edits SQL before
 * it runs. Every case here is one a real migration file in `db/migrations/`
 * either exhibits today or would exhibit if written carelessly — in particular
 * the dollar-quoted `DO $$ … END $$;` block that `0016` closes with, which is
 * exactly what a naive search for the last `COMMIT` would corrupt.
 */

import { describe, expect, it } from "vitest";
import { stripTransactionControl } from "./index.js";

const WRAPPED = `-- a comment
BEGIN;

ALTER TABLE t ADD COLUMN c text;

COMMIT;
`;

describe("stripTransactionControl", () => {
  it("removes the leading BEGIN and trailing COMMIT", () => {
    const body = stripTransactionControl(WRAPPED, "0001_x.sql");

    expect(body).not.toMatch(/^\s*BEGIN;/m);
    expect(body).not.toMatch(/^\s*COMMIT;/m);
    expect(body).toContain("ALTER TABLE t ADD COLUMN c text;");
  });

  it("keeps line numbers stable so Postgres error positions still line up", () => {
    const body = stripTransactionControl(WRAPPED, "0001_x.sql");

    expect(body.split("\n")).toHaveLength(WRAPPED.split("\n").length);
    // The statement stays on the line the developer sees in their editor.
    expect(body.split("\n")[3]).toBe("ALTER TABLE t ADD COLUMN c text;");
  });

  it("leaves a dollar-quoted block alone, including one that mentions COMMIT", () => {
    const sql = `BEGIN;
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_class WHERE relrowsecurity) THEN
        RAISE EXCEPTION 'refusing to COMMIT without RLS';
    END IF;
END $$;
COMMIT;
`;

    const body = stripTransactionControl(sql, "0016_media_sources.sql");

    // The inner BEGIN belongs to the PL/pgSQL block, not to the transaction.
    expect(body).toContain("DO $$");
    expect(body).toContain("RAISE EXCEPTION 'refusing to COMMIT without RLS';");
    expect(body).toContain("END $$;");
    expect(body.trim().startsWith("DO $$")).toBe(true);
    expect(body.trim().endsWith("END $$;")).toBe(true);
  });

  it("ignores comments and blank lines when locating the boundaries", () => {
    const sql = `\n\n-- why this migration exists\n--\n-- at length\n\nBEGIN;\nSELECT 1;\nCOMMIT;\n\n-- trailing note\n`;

    expect(stripTransactionControl(sql, "0002_x.sql")).toContain("SELECT 1;");
  });

  it("accepts lowercase and odd spacing", () => {
    expect(stripTransactionControl("begin ;\nSELECT 1;\ncommit ;\n", "x.sql")).toContain(
      "SELECT 1;",
    );
  });

  // The refusals matter more than the successes: a file that is silently
  // half-wrapped runs its DDL outside the ledger's transaction, which is the
  // whole bug this package exists to close.
  it("refuses a file with no BEGIN", () => {
    expect(() => stripTransactionControl("SELECT 1;\nCOMMIT;\n", "0003_x.sql")).toThrow(
      /0003_x\.sql.*no leading BEGIN;/s,
    );
  });

  it("refuses a file whose author forgot the COMMIT", () => {
    expect(() => stripTransactionControl("BEGIN;\nSELECT 1;\n", "0004_x.sql")).toThrow(
      /0004_x\.sql.*no trailing COMMIT;/s,
    );
  });

  it("refuses a file with neither, naming both", () => {
    expect(() => stripTransactionControl("SELECT 1;\n", "0005_x.sql")).toThrow(
      /no leading BEGIN; and no trailing COMMIT;/,
    );
  });

  it("refuses an empty file rather than applying nothing and recording success", () => {
    expect(() => stripTransactionControl("\n-- nothing here\n", "0006_x.sql")).toThrow(
      /contains no statements/,
    );
  });

  it("does not mistake a COMMIT in the middle for the trailing one", () => {
    // Two transactions in one file: the runner cannot make this atomic, and
    // must say so rather than wrapping only the tail.
    expect(() =>
      stripTransactionControl("BEGIN;\nSELECT 1;\nCOMMIT;\nSELECT 2;\n", "0007_x.sql"),
    ).toThrow(/no trailing COMMIT;/);
  });
});
