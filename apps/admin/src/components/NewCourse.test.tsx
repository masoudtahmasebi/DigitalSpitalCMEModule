/**
 * The course-creation wizard (P132-03).
 *
 * A wizard buys the author a sense of place and costs one specific risk: a
 * field typed on step 1 that never reaches the request submitted on step 3.
 * That is not hypothetical on this project — P68's list has *"a form silently
 * discarded"* on it, from the order two controls were used in — so the first
 * case here is the whole point of the file, and the rest are the properties
 * the flat form had and must not have lost.
 */

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { ApiClient, CourseStructure, ProjectSummary } from "@ds/sdk";
import { NewCourse } from "./NewCourse.js";

afterEach(cleanup);

const PROJECTS: readonly ProjectSummary[] = [
  {
    slug: "medice-adhs",
    name: "MEDICE",
    departmentSlug: "default",
    copyOverrides: {},
  } as unknown as ProjectSummary,
];

/** What the API answers a create with: the new course's whole structure, empty. */
function created(): CourseStructure {
  return {
    courseSlug: "adhs-akademie",
    title: "ADHS Akademie adult",
    modules: [],
    experts: [],
  } as unknown as CourseStructure;
}

function client(overrides: Partial<ApiClient> = {}): ApiClient {
  return {
    adminCreateCourse: vi.fn(async () => created()),
    ...overrides,
  } as unknown as ApiClient;
}

function next() {
  fireEvent.click(screen.getByRole("button", { name: "Weiter" }));
}

describe("NewCourse", () => {
  it("sends every step's field in one request, from the last step", async () => {
    const adminCreateCourse = vi.fn(async () => created());
    const onCreated = vi.fn();
    render(
      <NewCourse
        client={client({ adminCreateCourse } as Partial<ApiClient>)}
        projects={PROJECTS}
        onCreated={onCreated}
        onCancel={() => undefined}
      />,
    );

    fireEvent.change(screen.getByLabelText("Titel"), {
      target: { value: "ADHS Akademie adult" },
    });
    next();

    // Step 2, two screens away from where the title was typed.
    fireEvent.change(screen.getByLabelText("Format"), { target: { value: "live" } });
    fireEvent.change(screen.getByLabelText("Beschreibung"), {
      target: { value: "Sechs Kapitel zur ADHS im Erwachsenenalter." },
    });
    next();

    fireEvent.click(screen.getByRole("button", { name: "Fortbildung anlegen" }));

    await waitFor(() => expect(adminCreateCourse).toHaveBeenCalledTimes(1));
    expect(adminCreateCourse).toHaveBeenCalledWith({
      projectSlug: "medice-adhs",
      slug: "adhs-akademie-adult",
      title: "ADHS Akademie adult",
      description: "Sechs Kapitel zur ADHS im Erwachsenenalter.",
      deliveryType: "live",
    });
    await waitFor(() => expect(onCreated).toHaveBeenCalledWith("adhs-akademie"));
  });

  it("writes nothing before the last step", async () => {
    /*
     * The control for the case above, and the rule from the header: a wizard
     * that created the course on step 1 and patched it afterwards would leave a
     * half-made course behind every time somebody changed their mind.
     */
    const adminCreateCourse = vi.fn(async () => created());
    render(
      <NewCourse
        client={client({ adminCreateCourse } as Partial<ApiClient>)}
        projects={PROJECTS}
        onCreated={() => undefined}
        onCancel={() => undefined}
      />,
    );

    fireEvent.change(screen.getByLabelText("Titel"), { target: { value: "Kurs" } });
    next();
    next();

    expect(adminCreateCourse).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Fortbildung anlegen" })).toBeTruthy();
  });

  it("names the missing field rather than only going grey", async () => {
    /*
     * §9.4. "Weiter" is disabled with an empty title because the create would
     * be refused, and a disabled control that does not say why is the same
     * defect as one that can only produce an error, one step earlier.
     */
    render(
      <NewCourse
        client={client()}
        projects={PROJECTS}
        onCreated={() => undefined}
        onCancel={() => undefined}
      />,
    );

    expect(screen.getByText(/Es fehlt noch: Titel, Kürzel/u)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Weiter" }).hasAttribute("disabled")).toBe(
      true,
    );

    fireEvent.change(screen.getByLabelText("Titel"), { target: { value: "Kurs" } });

    expect(screen.queryByText(/Es fehlt noch/u)).toBeNull();
    expect(screen.getByRole("button", { name: "Weiter" }).hasAttribute("disabled")).toBe(
      false,
    );
  });

  it("derives the Kürzel from the title until somebody edits it", async () => {
    // Unchanged behaviour, asserted here because the two fields are now read in
    // a different order than they were on the flat form.
    render(
      <NewCourse
        client={client()}
        projects={PROJECTS}
        onCreated={() => undefined}
        onCancel={() => undefined}
      />,
    );

    fireEvent.change(screen.getByLabelText("Titel"), {
      target: { value: "ADHS Akademie" },
    });
    expect((screen.getByLabelText("Kürzel") as HTMLInputElement).value).toBe(
      "adhs-akademie",
    );

    fireEvent.change(screen.getByLabelText("Kürzel"), { target: { value: "adhs-2026" } });
    fireEvent.change(screen.getByLabelText("Titel"), {
      target: { value: "ADHS Akademie adult" },
    });
    expect((screen.getByLabelText("Kürzel") as HTMLInputElement).value).toBe("adhs-2026");
  });

  it("shows the title in the preview while it is being typed", async () => {
    /*
     * The reference designs' one substantive idea, and the reason the preview
     * is not decoration: the title is the only thing a physician reads in the
     * catalogue, and until this screen an author could not see it as a card
     * until the course existed.
     */
    render(
      <NewCourse
        client={client()}
        projects={PROJECTS}
        onCreated={() => undefined}
        onCancel={() => undefined}
      />,
    );

    expect(screen.getByText("Noch ohne Titel")).toBeTruthy();

    fireEvent.change(screen.getByLabelText("Titel"), {
      target: { value: "ADHS Akademie adult" },
    });

    expect(screen.getByRole("heading", { name: "ADHS Akademie adult" })).toBeTruthy();
  });

  it("says what still has to happen after the course exists", async () => {
    // The half the flat form had nowhere to put: a new course is a draft with
    // no modules and no VNR, and an author who does not know that reads the
    // empty structure screen as a broken one.
    render(
      <NewCourse
        client={client()}
        projects={PROJECTS}
        onCreated={() => undefined}
        onCancel={() => undefined}
      />,
    );

    fireEvent.change(screen.getByLabelText("Titel"), { target: { value: "Kurs" } });
    next();
    next();

    expect(screen.getByText("Zertifizierung")).toBeTruthy();
    expect(screen.getByText(/Bis dahin ist die Fortbildung ein Entwurf/u)).toBeTruthy();
  });

  it("refuses to draw the form at all when there is no project", async () => {
    render(
      <NewCourse
        client={client()}
        projects={[]}
        onCreated={() => undefined}
        onCancel={() => undefined}
      />,
    );

    expect(screen.getByText(/muss es mindestens ein Projekt geben/u)).toBeTruthy();
    expect(screen.queryByLabelText("Titel")).toBeNull();
  });
});
