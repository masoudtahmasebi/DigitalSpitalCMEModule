/**
 * What the navigation table answers, asked without a browser.
 *
 * ## Why these are new, and what they are not
 *
 * Every assertion here was previously only answerable by rendering a signed-in
 * console against a mocked API — `App.test.tsx` does exactly that, and it stays
 * the test that proves the console *calls* any of this (§9.7: a pure function
 * with its own tests proves nothing about the product unless something names
 * its caller). These tests are the other half: the questions that are about the
 * table itself, where an API and a DOM were only ever in the way.
 *
 * The one that matters most is `visibleNav` dropping an empty group. That is
 * §9.2 in its mildest form — a heading that promises somewhere to go and leads
 * nowhere — and it is the case a `course_editor` hits, which is the role least
 * likely to be the one somebody logs in as to check.
 */

import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { NAV, sectionFor, visibleNav, type NavGroup } from "./navigation.js";
import { Sidebar } from "./Sidebar.js";

afterEach(cleanup);

/*
 * The real capability sets, from `@ds/domain`'s table. Written out rather than
 * imported so that a change to the domain's grants shows up here as a failing
 * expectation naming the role, instead of silently re-deriving both sides of
 * the comparison from the same source — which is the shape that makes a test
 * agree with any answer.
 */
const CAPABILITIES = {
  super_admin: [
    "customer",
    "project",
    "course",
    "content",
    "learner_record",
    "certificate",
    "platform",
    "staff_user",
  ],
  customer_admin: [
    "project",
    "course",
    "content",
    "learner_record",
    "certificate",
    "staff_user",
  ],
  department_admin: ["project", "course", "content", "learner_record", "certificate"],
  course_editor: ["course", "content"],
} as const;

describe("visibleNav", () => {
  it("never leaves a group heading over nothing", () => {
    for (const [role, held] of Object.entries(CAPABILITIES)) {
      for (const group of visibleNav([...held])) {
        expect(
          group.sections.length,
          `${role} is drawn the "${group.heading}" heading with no destination under it`,
        ).toBeGreaterThan(0);
      }
    }
  });

  it("hides Kunden from everyone but a super admin", () => {
    const kinds = (held: readonly string[]) =>
      visibleNav([...held]).flatMap((group) => group.sections.map((s) => s.kind));

    expect(kinds(CAPABILITIES.super_admin)).toContain("customers");
    for (const role of ["customer_admin", "department_admin", "course_editor"] as const) {
      expect(kinds(CAPABILITIES[role]), `${role} is offered Kunden`).not.toContain(
        "customers",
      );
    }
  });

  it("gives a course editor somewhere to go, and not the whole console", () => {
    const kinds = visibleNav([...CAPABILITIES.course_editor]).flatMap((group) =>
      group.sections.map((section) => section.kind),
    );

    // A role with nothing at all would be a sign-in that lands on an empty
    // frame — worse than a wrong grant, because nothing says what happened.
    expect(kinds.length).toBeGreaterThan(0);
    expect(kinds).toContain("courses");
    // And not the screens whose mount-time reads would refuse them.
    expect(kinds).not.toContain("learners");
    expect(kinds).not.toContain("customers");
    expect(kinds).not.toContain("punktemeldungen");

    /*
     * `security` **is** drawn for them, and that is correct — it caught me
     * writing this test, which is why it is asserted rather than quietly
     * dropped.
     *
     * Sicherheit is the one deliberately ungated row: it is where an operator
     * changes their own password and their own second factor, so gating it
     * behind a capability would lock the least-privileged accounts out of the
     * one screen every account needs. `pnpm check:roles` agrees — it walks
     * 4 roles × 13 screens against the API's own `@Roles` decorators and
     * reports that every drawn screen loads, which it would not if this one
     * refused a course editor.
     */
    expect(kinds).toContain("security");
  });

  it("answers from the table it is given, so a caller can ask about a hypothetical", () => {
    const groups: readonly NavGroup[] = [
      {
        heading: "Nur mit Fähigkeit",
        sections: [
          { kind: "courses", label: "A", title: "A", capability: "nothing_holds" },
        ],
      },
    ];
    expect(visibleNav(["project"], groups)).toEqual([]);
  });
});

describe("sectionFor", () => {
  it("finds the chrome for every screen the sidebar draws", () => {
    for (const group of NAV) {
      for (const section of group.sections) {
        expect(sectionFor(section.kind), section.kind).toBe(section);
      }
    }
  });

  it("has nothing for the screens that are not destinations", () => {
    // The course workspace and the new-course form draw their own `Page` with
    // a breadcrumb trail, because neither is somewhere the sidebar goes.
    expect(sectionFor("course")).toBeUndefined();
    expect(sectionFor("new-course")).toBeUndefined();
  });

  it("gives every destination a title, so no screen can render headless", () => {
    for (const group of NAV) {
      for (const section of group.sections) {
        expect(section.title.trim(), section.kind).not.toBe("");
        expect(section.label.trim(), section.kind).not.toBe("");
      }
    }
  });
});

describe("Sidebar", () => {
  function draw(active: Parameters<typeof Sidebar>[0]["active"] = "courses") {
    const clicked: string[] = [];
    render(
      <Sidebar
        groups={visibleNav([...CAPABILITIES.super_admin])}
        active={active}
        onNavigate={(kind) => clicked.push(kind)}
      />,
    );
    return clicked;
  }

  it("marks exactly one row as the page you are on", () => {
    draw("security");
    const current = screen
      .getAllByRole("button")
      .filter((button) => button.getAttribute("aria-current") === "page");

    expect(current).toHaveLength(1);
    expect(current[0]?.textContent).toBe("Sicherheit");
  });

  it("marks none when the screen is not a sidebar destination", () => {
    // The course workspace. Highlighting "Fortbildungen" there would say the
    // operator is on the list when they are two levels inside one.
    draw("course");
    expect(
      screen
        .getAllByRole("button")
        .filter((button) => button.getAttribute("aria-current") === "page"),
    ).toHaveLength(0);
  });

  it("labels each group's list without competing for the heading outline", () => {
    draw();
    // These were `h2`, which put them level with the page title `Page` draws —
    // a screen reader's heading list then read the group names as peers of the
    // one that says which screen you are on, and that one came last.
    expect(screen.queryAllByRole("heading")).toHaveLength(0);

    for (const list of screen.getAllByRole("list")) {
      const labelledBy = list.getAttribute("aria-labelledby");
      expect(labelledBy).not.toBeNull();
      expect(document.getElementById(labelledBy ?? "")?.textContent?.trim()).toBeTruthy();
    }
  });

  it("reports the kind of the row that was clicked, not its label", () => {
    const clicked = draw();
    screen.getByRole("button", { name: "Sicherheit" }).click();
    expect(clicked).toEqual(["security"]);
  });
});
