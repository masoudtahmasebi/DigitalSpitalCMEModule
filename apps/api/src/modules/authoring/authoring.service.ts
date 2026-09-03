/**
 * Authoring use cases (P9-02, P9-04, P9-05). Application layer — ADR-0006.
 *
 * ## What this file refuses, and why each refusal exists
 *
 * | Refusal | Because |
 * | --- | --- |
 * | A reorder that is not a permutation | A client that lost a row would otherwise delete a chapter from a course learners are part-way through |
 * | A video with no duration | The watch gate is a percentage of a known length; with none there is nothing to reach |
 * | Deleting anything a learner has touched | That row is the evidence behind a CME point that may already have been reported |
 * | Deleting a question or option with recorded answers | An already-submitted attempt must keep meaning what it meant |
 * | A question with no correct answer | A quiz nobody can pass, discovered by a physician rather than by an author |
 * | A `single` question with more than one correct answer | Scoring is exact-set; two correct answers on a single-choice question is unpassable |
 *
 * The first three are decided by `@ds/domain`; this file supplies the counts
 * and turns a rejection into a problem document. The last three are here
 * because they are about a quiz document's internal consistency, which is not
 * a compliance rule so much as a shape.
 *
 * ## Every mutation is audited
 *
 * Ordering decides gating and a quiz decides who earns a point, so "who changed
 * this course" has to be answerable. Field names and counts only — never a
 * prompt, never an answer key (CLAUDE.md §4 invariant 7).
 */

import {
  canDelete,
  deletionVerdict,
  contentProblems,
  parseMediaSources,
  type ContentProblem,
  correctOptionCount,
  keyBelongsToCustomer,
  invalidBrandingFields,
  invalidCopyKeys,
  parseCopyOverrides,
  parseBranding,
  questionProblems,
  questionRemoval,
  storageKeyOf,
  validateReorder,
  MIN_QUIZ_OPTIONS,
  type ChildCensus,
  type HierarchyLevel,
  type QuestionProblem,
} from "@ds/domain";
import { COPY_KEYS } from "@ds/copy";
import { AppError } from "../../shared/problem-details.js";
import type { Db } from "../../db/tenant-db.js";
import type { SecretCipher } from "../../shared/secret-cipher.js";
import {
  AuthoringRepository,
  type AuthoringRepositoryPort,
  type ContentValues,
  type EvaluationPlan,
  type ProjectPatch,
  type QuizPlan,
} from "./authoring.repository.js";
import type {
  AuthoringEvaluation,
  AuthoringQuiz,
  ChapterWrite,
  ContentWrite,
  CourseCreate,
  CourseStructure,
  DepartmentCreate,
  DepartmentSummary,
  DepartmentUpdate,
  EvaluationWrite,
  ExpertsWrite,
  ModuleWrite,
  ProjectCreate,
  ProjectSummary,
  ProjectUpdate,
  QuizWrite,
  StructureOrder,
} from "./authoring.dto.js";

/** German labels for a deletion refusal. Plural, because a refusal counts. */
const LEVEL_LABEL: Readonly<Record<HierarchyLevel, string>> = {
  customer: "Kunden",
  department: "Abteilungen",
  project: "Projekte",
  course: "Kurse",
  module: "Module",
  chapter: "Kapitel",
  content: "Inhalte",
};

export interface AuthorContext {
  readonly customerId: string;
  readonly userId: string;
  /**
   * Which population `userId` names (ADR-0012). Carried so every audit row this
   * service writes says whether a physician or an operator did it.
   */
  readonly identity: "learner" | "staff";
}

export class AuthoringService {
  constructor(
    private readonly repository: AuthoringRepositoryPort,
    private readonly cipher: SecretCipher,
  ) {}

  static fromDb(db: Db, cipher: SecretCipher): AuthoringService {
    return new AuthoringService(new AuthoringRepository(db), cipher);
  }

  // -------------------------------------------------------------------------
  // Departments and projects (P9-02)
  // -------------------------------------------------------------------------

  async listDepartments(): Promise<DepartmentSummary[]> {
    return this.repository.listDepartments();
  }

  async createDepartment(input: DepartmentCreate, actor: AuthorContext): Promise<void> {
    await this.guardUnique(
      () => this.repository.findDepartmentId(input.slug),
      `Eine Abteilung mit dem Kürzel „${input.slug}“ existiert bereits.`,
    );
    await this.repository.createDepartment(input);
    await this.audit(actor, "admin.department.create", input.slug, {});
  }

  async updateDepartment(
    slug: string,
    patch: DepartmentUpdate,
    actor: AuthorContext,
  ): Promise<void> {
    const found = await this.repository.updateDepartment(slug, patch);
    if (!found) throw AppError.notFound(`department slug=${slug} not visible in tenant`);
    await this.audit(actor, "admin.department.update", slug, {
      fields: Object.keys(patch),
    });
  }

  async listProjects(): Promise<ProjectSummary[]> {
    const rows = await this.repository.listProjects();
    return rows.map((row) => ({
      ...row,
      // Validated on read: a value stored before a grammar tightened must not
      // reach a settings form as though it were still acceptable.
      branding: parseBranding(row.branding),
      // Same reasoning as `branding`: a key stored before the widget's locale
      // table lost it must not reach a settings form as an editable field.
      copyOverrides: { ...parseCopyOverrides(row.copyOverrides, COPY_KEYS) },
      identityProvider: narrowIdentityProvider(row.identityProvider),
    }));
  }

  async createProject(input: ProjectCreate, actor: AuthorContext): Promise<void> {
    const departmentId = await this.repository.findDepartmentId(input.departmentSlug);
    if (departmentId === undefined) {
      throw AppError.notFound(`department slug=${input.departmentSlug} not visible`);
    }

    await this.guardUnique(
      () => this.repository.findProjectId(input.slug),
      `Ein Projekt mit dem Kürzel „${input.slug}“ existiert bereits.`,
    );

    // `keycloak` when the caller says nothing, which is what every project
    // created before this already is. A `local` project is the standalone
    // portal's; a `keycloak` one still needs its issuer and audience before a
    // learner can sign in, and `deploy.sh` warns about the half-bound state.
    const identityProvider = input.identityProvider ?? "keycloak";

    await this.repository.createProject({
      departmentId,
      slug: input.slug,
      name: input.name,
      identityProvider,
    });
    await this.audit(actor, "admin.project.create", input.slug, {
      department: input.departmentSlug,
      identityProvider,
    });
  }

  /**
   * Edit a project.
   *
   * The branding blob is re-validated by `@ds/domain` before storage and the
   * *parsed* result is what is written — so a value that fails its grammar is
   * dropped here rather than stored and dropped again on every read.
   */
  async updateProject(
    slug: string,
    update: ProjectUpdate,
    actor: AuthorContext,
  ): Promise<void> {
    const patch: ProjectPatch = {};
    assign(patch, "name", update.name);
    // Changing this changes how every participant of the project signs in, so
    // it is audited by name below like every other field — and it is a change
    // an operator has to be able to make, because a customer that starts on the
    // portal and later gets a Keycloak realm should not need a new project.
    assign(patch, "identityProvider", update.identityProvider);
    assign(patch, "loginUrl", update.loginUrl);
    assign(patch, "keycloakIssuer", update.keycloakIssuer);
    assign(patch, "keycloakAudience", update.keycloakAudience);
    assign(patch, "keycloakRealm", update.keycloakRealm);
    assign(patch, "embedOrigins", update.embedOrigins);
    assign(patch, "smtpHost", update.smtpHost);
    assign(patch, "smtpPort", update.smtpPort);
    assign(patch, "smtpUsername", update.smtpUsername);
    assign(patch, "smtpFromAddress", update.smtpFromAddress);
    assign(patch, "smtpFromName", update.smtpFromName);

    if (update.branding !== undefined) {
      /*
       * Refuse what would be dropped, rather than dropping it quietly (P41-01).
       *
       * `parseBranding` discards a field it cannot use, because a learner's
       * screen has to render whatever is stored and a half-valid blob must not
       * blank a catalogue. That is right for the read path and wrong for this
       * one: an operator who pasted a hero image URL the grammar refuses got
       * "Gespeichert.", and the field was simply gone the next time they
       * looked.
       *
       * `invalidBrandingFields` was written for exactly this — its own comment
       * says *"an admin saving a value deserves to be told it was rejected,
       * which is a different question and gets a different function"* — and
       * nothing called it. Found by the sweep in `scripts/unused-rules.mjs`.
       */
      const invalid = invalidBrandingFields(update.branding);
      if (invalid.length > 0) {
        throw new AppError(
          "validation",
          `invalid branding fields: ${invalid.join(", ")}`,
          `Diese Angaben konnten nicht gespeichert werden: ${invalid.join(", ")}. Bitte prüfen Sie die Schreibweise — Bild- und Linkadressen müssen mit https:// beginnen.`,
        );
      }
      patch.branding = parseBranding(update.branding);
    }

    if (update.copyOverrides !== undefined) {
      /*
       * The same shape as branding above, and for the same reason (P83-02).
       *
       * `parseCopyOverrides` drops what it cannot use, because a learner's
       * screen has to render whatever is stored. That is right for the read
       * path and wrong for this one: an operator who typed into a field for a
       * screen that has since been renamed away deserves to be told, not to
       * watch the value vanish on the next load.
       *
       * Keys, never values (§9.5). One of these fields is free text an operator
       * pasted from somewhere, and the refusal travels through a log.
       */
      const invalid = invalidCopyKeys(update.copyOverrides, COPY_KEYS);
      if (invalid.length > 0) {
        const keys = invalid.map((entry) => entry.key).join(", ");
        throw new AppError(
          "validation",
          `invalid copy keys: ${invalid.map((e) => `${e.key}=${e.reason}`).join(", ")}`,
          `Diese Texte konnten nicht gespeichert werden: ${keys}. Bitte prüfen Sie Länge und Schreibweise.`,
        );
      }
      patch.copyOverrides = { ...parseCopyOverrides(update.copyOverrides, COPY_KEYS) };
    }
    if (update.smtpPassword !== undefined) {
      // Encrypted before it crosses into the repository — no layer below this
      // one ever sees the plaintext (CLAUDE.md §4 invariant 7).
      patch.smtpPasswordEnc = this.cipher.encrypt(update.smtpPassword);
    }

    const found = await this.repository.updateProject(slug, patch);
    if (!found) throw AppError.notFound(`project slug=${slug} not visible in tenant`);

    await this.audit(actor, "admin.project.update", slug, {
      // Field names, never values: one of them is an SMTP credential.
      fields: Object.keys(patch),
    });
  }

  /**
   * Delete a department (P12-04).
   *
   * Refused while anything is inside it, and permanently refused once a learner
   * has enrolled anywhere beneath it. The refusal names the counts, because
   * "cannot delete" on its own sends somebody hunting through the tree for the
   * one project they forgot.
   */
  async deleteDepartment(slug: string, actor: AuthorContext): Promise<void> {
    const id = await this.requireDepartment(slug);
    this.assertRemovable(
      await this.repository.countDepartmentRecords(id),
      await this.repository.censusOfDepartment(id),
      "Abteilung",
    );

    await this.repository.deleteDepartment(id);
    await this.audit(actor, "admin.department.delete", slug, {});
  }

  async deleteProject(slug: string, actor: AuthorContext): Promise<void> {
    const id = await this.requireProject(slug);
    this.assertRemovable(
      await this.repository.countProjectRecords(id),
      await this.repository.censusOfProject(id),
      "Projekt",
    );

    await this.repository.deleteProject(id);
    await this.audit(actor, "admin.project.delete", slug, {});
  }

  async deleteCourse(slug: string, actor: AuthorContext): Promise<void> {
    const id = await this.requireCourse(slug);
    this.assertRemovable(
      await this.repository.countCourseRecords(id),
      await this.repository.censusOfCourse(id),
      "Kurs",
    );

    await this.repository.deleteCourse(id);
    await this.audit(actor, "admin.course.delete", slug, {});
  }

  // -------------------------------------------------------------------------
  // Courses and structure (P9-04)
  // -------------------------------------------------------------------------

  async createCourse(input: CourseCreate, actor: AuthorContext): Promise<void> {
    const projectId = await this.repository.findProjectId(input.projectSlug);
    if (projectId === undefined) {
      throw AppError.notFound(`project slug=${input.projectSlug} not visible`);
    }

    await this.guardUnique(
      () => this.repository.findCourseId(input.slug),
      `Eine Fortbildung mit dem Kürzel „${input.slug}“ existiert bereits.`,
    );

    await this.repository.createCourse({
      projectId,
      slug: input.slug,
      title: input.title,
      description: input.description ?? null,
      deliveryType: input.deliveryType,
    });
    await this.audit(actor, "admin.course.create", input.slug, {
      project: input.projectSlug,
    });
  }

  async getStructure(courseSlug: string): Promise<CourseStructure> {
    const courseId = await this.requireCourse(courseSlug);
    const rows = await this.repository.loadStructure(courseId);

    return {
      courseSlug,
      title: courseSlug,
      modules: rows.modules.map((module) => ({
        id: module.id,
        title: module.title,
        subtitle: module.subtitle,
        chapters: rows.chapters
          .filter((chapter) => chapter.moduleId === module.id)
          .map((chapter) => ({
            id: chapter.id,
            title: chapter.title,
            body: chapter.body,
            contents: rows.contents
              .filter((content) => content.chapterId === chapter.id)
              // `media_sources` is jsonb, so the row's type is `unknown` and
              // nothing has checked its shape. Parsing here rather than casting
              // means a malformed entry becomes one missing rendition in the
              // form, not an object the console renders as `undefined`.
              .map(({ chapterId: _chapterId, mediaSources, ...content }) => ({
                ...content,
                sources: parseMediaSources(mediaSources).map((source) => ({
                  url: source.url,
                  mimeType: source.mimeType,
                  label: source.label,
                })),
              })),
          })),
      })),
      experts: rows.experts,
    };
  }

  async createModule(
    courseSlug: string,
    input: ModuleWrite,
    actor: AuthorContext,
  ): Promise<CourseStructure> {
    const courseId = await this.requireCourse(courseSlug);
    await this.repository.createModule(courseId, {
      title: input.title,
      subtitle: input.subtitle ?? null,
    });
    await this.audit(actor, "admin.module.create", courseSlug, {});
    return this.getStructure(courseSlug);
  }

  async updateModule(
    id: string,
    input: ModuleWrite,
    actor: AuthorContext,
  ): Promise<CourseStructure> {
    const courseSlug = await this.slugOwning(
      await this.repository.courseIdOfModule(id),
      id,
    );
    await this.repository.updateModule(id, {
      title: input.title,
      subtitle: input.subtitle ?? null,
    });
    await this.audit(actor, "admin.module.update", id, {});
    return this.getStructure(courseSlug);
  }

  async deleteModule(id: string, actor: AuthorContext): Promise<CourseStructure> {
    const courseSlug = await this.slugOwning(
      await this.repository.courseIdOfModule(id),
      id,
    );
    this.assertRemovable(
      await this.repository.countModuleRecords(id),
      await this.repository.censusOfModule(id),
      "Modul",
    );

    await this.repository.deleteModule(id);
    await this.audit(actor, "admin.module.delete", id, {});
    return this.getStructure(courseSlug);
  }

  async createChapter(
    moduleId: string,
    input: ChapterWrite,
    actor: AuthorContext,
  ): Promise<CourseStructure> {
    const courseSlug = await this.slugOwning(
      await this.repository.courseIdOfModule(moduleId),
      moduleId,
    );
    await this.repository.createChapter(moduleId, {
      title: input.title,
      body: input.body ?? null,
    });
    await this.audit(actor, "admin.chapter.create", moduleId, {});
    return this.getStructure(courseSlug);
  }

  async updateChapter(
    id: string,
    input: ChapterWrite,
    actor: AuthorContext,
  ): Promise<CourseStructure> {
    const courseSlug = await this.slugOwning(
      await this.repository.courseIdOfChapter(id),
      id,
    );
    await this.repository.updateChapter(id, {
      title: input.title,
      body: input.body ?? null,
    });
    await this.audit(actor, "admin.chapter.update", id, {});
    return this.getStructure(courseSlug);
  }

  async deleteChapter(id: string, actor: AuthorContext): Promise<CourseStructure> {
    const courseSlug = await this.slugOwning(
      await this.repository.courseIdOfChapter(id),
      id,
    );
    this.assertRemovable(
      await this.repository.countChapterRecords(id),
      await this.repository.censusOfChapter(id),
      "Kapitel",
    );

    await this.repository.deleteChapter(id);
    await this.audit(actor, "admin.chapter.delete", id, {});
    return this.getStructure(courseSlug);
  }

  async createContent(
    chapterId: string,
    input: ContentWrite,
    actor: AuthorContext,
  ): Promise<CourseStructure> {
    const courseSlug = await this.slugOwning(
      await this.repository.courseIdOfChapter(chapterId),
      chapterId,
    );
    const values = this.validContent(input, actor.customerId);
    await this.assertOnlyQuizInModule(courseSlug, chapterId, input.kind, undefined);

    await this.repository.createContent(chapterId, values);
    await this.audit(actor, "admin.content.create", chapterId, { kind: input.kind });
    return this.getStructure(courseSlug);
  }

  async updateContent(
    id: string,
    input: ContentWrite,
    actor: AuthorContext,
  ): Promise<CourseStructure> {
    const courseSlug = await this.slugOwning(
      await this.repository.courseIdOfContent(id),
      id,
    );
    const values = this.validContent(input, actor.customerId);
    await this.assertOnlyQuizInModule(courseSlug, undefined, input.kind, id);

    await this.repository.updateContent(id, values);
    await this.audit(actor, "admin.content.update", id, { kind: input.kind });
    return this.getStructure(courseSlug);
  }

  /**
   * One Lernerfolgskontrolle per module (P87-06).
   *
   * The gate, the player's tab and the completion arithmetic all speak of *the*
   * exam belonging to a module. A second one is a shape none of them can
   * express: `findQuizContent` would offer whichever came first, the other
   * would be unreachable from the player, and `hasPassedQuiz` would still
   * require both — so the course could not be finished at all. That is exactly
   * how P87-01 arose, one level up, from a course-wide search silently ignoring
   * the second quiz.
   *
   * Refused at authoring time, which is the only point where the mistake is
   * cheap: an author who has just written twelve questions into an exam nobody
   * can sit has lost the afternoon, and nothing on the structure screen would
   * have told them.
   *
   * The message names the **module**, by its own title, because that is what
   * the author has to go and look at. It names no ids and no values (§9.5).
   *
   * `chapterId` for a create — the module is the one owning that chapter — and
   * `contentId` for an update, where the content may be moving *into* `quiz`
   * from another kind. Exactly one of the two is given.
   */
  private async assertOnlyQuizInModule(
    courseSlug: string,
    chapterId: string | undefined,
    kind: ContentWrite["kind"],
    contentId: string | undefined,
  ): Promise<void> {
    if (kind !== "quiz") return;

    const structure = await this.getStructure(courseSlug);
    const module = structure.modules.find((entry) =>
      entry.chapters.some(
        (chapter) =>
          chapter.id === chapterId ||
          (contentId !== undefined &&
            chapter.contents.some((content) => content.id === contentId)),
      ),
    );
    // No module found means the caller is editing something this course does
    // not contain, which `slugOwning` has already refused — nothing to add.
    if (module === undefined) return;

    const existing = module.chapters
      .flatMap((chapter) => chapter.contents)
      .filter((content) => content.kind === "quiz")
      // An update that leaves a quiz a quiz must not collide with itself.
      .filter((content) => content.id !== contentId);

    if (existing.length === 0) return;

    throw new AppError(
      "validation",
      `module=${module.id} already has a Lernerfolgskontrolle`,
      `Das Modul „${module.title}" hat bereits eine Lernerfolgskontrolle. ` +
        "Pro Modul ist genau eine möglich — bearbeiten Sie die vorhandene, " +
        "oder legen Sie ein weiteres Modul an.",
    );
  }

  async deleteContent(id: string, actor: AuthorContext): Promise<CourseStructure> {
    const courseSlug = await this.slugOwning(
      await this.repository.courseIdOfContent(id),
      id,
    );
    this.assertDeletable(await this.repository.countContentRecords(id), "Inhaltselement");
    this.assertNoQuestions(await this.repository.countContentQuestions(id));

    await this.repository.deleteContent(id);
    await this.audit(actor, "admin.content.delete", id, {});
    return this.getStructure(courseSlug);
  }

  /**
   * Apply a whole tree's ordering (P9-04).
   *
   * Every level is checked as a permutation of what exists **before** anything
   * is written, so a request that is wrong anywhere changes nothing anywhere.
   * Ordering decides gating, and a half-applied reorder is a course whose
   * sequence nobody intended.
   */
  async reorder(
    courseSlug: string,
    order: StructureOrder,
    actor: AuthorContext,
  ): Promise<CourseStructure> {
    const courseId = await this.requireCourse(courseSlug);
    const current = await this.repository.loadStructure(courseId);

    this.checkPermutation(
      current.modules.map((module) => module.id),
      order.modules.map((module) => module.id),
      "Module",
    );

    // Chapters and contents are checked across the whole course, not per
    // parent: moving a chapter to another module has to be allowed, and a
    // per-parent check would reject exactly that.
    this.checkPermutation(
      current.chapters.map((chapter) => chapter.id),
      order.modules.flatMap((module) => module.chapters.map((chapter) => chapter.id)),
      "Kapitel",
    );
    this.checkPermutation(
      current.contents.map((content) => content.id),
      order.modules.flatMap((module) =>
        module.chapters.flatMap((chapter) => chapter.contents),
      ),
      "Inhalte",
    );

    await this.repository.applyOrder(order);
    await this.audit(actor, "admin.structure.reorder", courseSlug, {
      modules: order.modules.length,
    });
    return this.getStructure(courseSlug);
  }

  async replaceExperts(
    courseSlug: string,
    input: ExpertsWrite,
    actor: AuthorContext,
  ): Promise<CourseStructure> {
    const courseId = await this.requireCourse(courseSlug);

    await this.repository.replaceExperts(
      courseId,
      input.experts.map((expert) => ({
        roleLabel: expert.roleLabel,
        name: expert.name,
        institution: expert.institution ?? null,
        biography: expert.biography ?? null,
        photoUrl: expert.photoUrl ?? null,
      })),
    );
    await this.audit(actor, "admin.experts.replace", courseSlug, {
      count: input.experts.length,
    });
    return this.getStructure(courseSlug);
  }

  // -------------------------------------------------------------------------
  // Assessment (P9-05) — human review gate
  // -------------------------------------------------------------------------

  async getQuiz(contentId: string): Promise<AuthoringQuiz> {
    await this.slugOwning(await this.repository.courseIdOfContent(contentId), contentId);
    const rows = await this.repository.loadQuiz(contentId);
    return { contentId, questions: rows.questions, retiredCount: rows.retiredCount };
  }

  /**
   * Replace a quiz (P9-05, revised by P114-01).
   *
   * Diffed rather than wiped and rewritten, for one reason: a question or
   * option a learner has answered must survive, or an already-submitted attempt
   * stops meaning anything. Anything the caller does not name is a removal.
   *
   * ## What a removal does, and why that changed
   *
   * Until P114-01 a removal was always a delete, and a delete of anything
   * answered was **refused**. One physician answering one question froze the
   * exam permanently — reported as *"this lernerfolgskontrolle has 11
   * questions, I want to make it to only 2 questions and i can not."*
   *
   * The refusal conflated the row surviving (required) with the question
   * staying in the exam (not required by anything). So now `questionRemoval`
   * decides per question: never answered, delete it; answered, **retire** it —
   * out of the exam, row and answers intact, never served and never scored
   * again. `quiz_attempts` stores each attempt's own score, so nothing already
   * earned moves.
   *
   * An **option** on an answered question is still refused outright, and that
   * asymmetry is deliberate. Retiring a question removes a whole unit of
   * meaning cleanly; deleting one option out from under a recorded answer
   * leaves `quiz_answers.selected_option_ids` pointing at a label nobody can
   * reconstruct, and the attempt becomes unreadable rather than merely
   * historical. An author who wants different options writes a new question and
   * lets the old one retire.
   */
  async setQuiz(
    contentId: string,
    input: QuizWrite,
    actor: AuthorContext,
  ): Promise<AuthoringQuiz> {
    await this.slugOwning(await this.repository.courseIdOfContent(contentId), contentId);

    // The rules themselves live in `@ds/domain` and are shared with the admin
    // console, which marks the offending question in the form. Two copies of
    // "a question with no correct answer is unpassable" would eventually
    // disagree, and the copy that decides is this one.
    for (const [index, question] of input.questions.entries()) {
      const problems = questionProblems(question);
      if (problems.length === 0) continue;

      const correct = correctOptionCount(question);
      throw new AppError(
        "validation",
        `question ${index} rejected: ${problems.join(",")}`,
        germanQuestionProblem(problems, index, correct),
      );
    }

    const existing = await this.repository.loadQuiz(contentId);
    const keptQuestionIds = new Set(
      input.questions
        .map((question) => question.id)
        .filter((id): id is string => id !== undefined),
    );
    const keptOptionIds = new Set(
      input.questions.flatMap((question) =>
        question.options
          .map((option) => option.id)
          .filter((id): id is string => id !== undefined),
      ),
    );

    const deleteQuestionIds: string[] = [];
    const retireQuestionIds: string[] = [];
    const deleteOptionIds: string[] = [];

    for (const question of existing.questions) {
      if (!keptQuestionIds.has(question.id)) {
        // Answered questions leave the exam and keep their row; unanswered ones
        // are deleted outright, so a question added and dropped in the same
        // sitting does not leave a tombstone behind (§`questionRemoval`).
        if (questionRemoval(question.answerCount) === "retire") {
          retireQuestionIds.push(question.id);
        } else {
          deleteQuestionIds.push(question.id);
        }
        continue;
      }

      for (const option of question.options) {
        if (!keptOptionIds.has(option.id)) {
          if (!canDelete(question.answerCount)) {
            throw new AppError(
              "conflict",
              `option=${option.id} belongs to a question with ${question.answerCount} answers`,
              `Diese Antwortoption gehört zu einer bereits beantworteten Frage und kann nicht gelöscht werden.`,
            );
          }
          deleteOptionIds.push(option.id);
        }
      }
    }

    const plan: QuizPlan = {
      deleteQuestionIds,
      retireQuestionIds,
      deleteOptionIds,
      questions: input.questions.map((question) => ({
        id: question.id,
        prompt: question.prompt,
        kind: question.kind,
        options: question.options,
      })),
    };

    await this.repository.applyQuiz(contentId, plan);
    await this.audit(actor, "admin.quiz.replace", contentId, {
      // Counts, never a prompt and never an answer key.
      questions: input.questions.length,
      deletedQuestions: deleteQuestionIds.length,
      // Separate from deletions on purpose: "who shortened the exam, and when"
      // is the question somebody reconstructing a physician's attempt will ask,
      // and a combined count cannot answer it.
      retiredQuestions: retireQuestionIds.length,
    });

    return this.getQuiz(contentId);
  }

  async getEvaluation(courseSlug: string): Promise<AuthoringEvaluation> {
    const courseId = await this.requireCourse(courseSlug);
    return { courseSlug, questions: await this.repository.loadEvaluation(courseId) };
  }

  async setEvaluation(
    courseSlug: string,
    input: EvaluationWrite,
    actor: AuthorContext,
  ): Promise<AuthoringEvaluation> {
    const courseId = await this.requireCourse(courseSlug);
    const existing = await this.repository.loadEvaluation(courseId);

    const kept = new Set(
      input.questions
        .map((question) => question.id)
        .filter((id): id is string => id !== undefined),
    );

    const deleteIds: string[] = [];
    for (const question of existing) {
      if (kept.has(question.id)) continue;
      if (!canDelete(question.responseCount)) {
        throw new AppError(
          "conflict",
          `evaluation=${question.id} has ${question.responseCount} responses`,
          `Diese Frage wurde bereits ${question.responseCount}-mal beantwortet und kann nicht gelöscht werden.`,
        );
      }
      deleteIds.push(question.id);
    }

    for (const [index, question] of input.questions.entries()) {
      if (question.kind === "single" && question.options.length < 2) {
        throw new AppError(
          "validation",
          `single-choice evaluation question ${index} has ${question.options.length} options`,
          `Frage ${index + 1} ist eine Auswahlfrage und braucht mindestens zwei Optionen.`,
        );
      }
    }

    const plan: EvaluationPlan = {
      deleteIds,
      questions: input.questions.map((question) => ({
        id: question.id,
        prompt: question.prompt,
        kind: question.kind,
        required: question.required,
        options: question.options,
      })),
    };

    await this.repository.applyEvaluation(courseId, plan);
    await this.audit(actor, "admin.evaluation.replace", courseSlug, {
      questions: input.questions.length,
      deleted: deleteIds.length,
    });

    return this.getEvaluation(courseSlug);
  }

  // -------------------------------------------------------------------------

  /**
   * Validate a content item, including who its media may belong to.
   *
   * `customerId` comes from the validated session, never from the request. Every
   * media field may now hold an `s3://` reference (P23-01), and a reference is
   * a *claim* about which object a course points at — so the claim is checked
   * against the caller's own prefix here, at the one place every content write
   * passes through.
   *
   * `media-url.ts` refuses a foreign key again when the media is read. Both
   * checks are wanted: this one keeps a bad reference out of the row, and that
   * one means a row that acquired one anyway — a restored dump, a hand-run
   * migration — renders as a padlock rather than as another customer's video.
   * A bucket has no RLS underneath to catch what application code misses.
   */
  private validContent(input: ContentWrite, customerId: string): ContentValues {
    for (const [field, value] of [
      ["posterUrl", input.posterUrl],
      ["captionsUrl", input.captionsUrl],
      ["fileUrl", input.fileUrl],
      ...(input.sources ?? []).map(
        (source, index) => [`sources.${index}.url`, source.url] as const,
      ),
    ] as const) {
      this.assertOwnedReference(value ?? null, customerId, field);
    }

    const problems = contentProblems({
      kind: input.kind,
      title: input.title,
      body: input.body ?? null,
      sources: input.sources ?? [],
      posterUrl: input.posterUrl ?? null,
      captionsUrl: input.captionsUrl ?? null,
      durationSec: input.durationSec ?? null,
      fileUrl: input.fileUrl ?? null,
      mimeType: input.mimeType ?? null,
    });

    if (problems.length > 0) {
      throw new AppError(
        "validation",
        `content invalid: ${problems.join(", ")}`,
        contentMessage(problems),
      );
    }

    return {
      kind: input.kind,
      title: input.title,
      body: input.body ?? null,
      // Normalised on the way in so the column holds one spelling of a type.
      // A browser matches `type` literally; storing "Video/MP4 " would produce
      // a source every browser skips, and the mistake would only surface as a
      // video that will not play.
      sources: (input.sources ?? []).map((source) => ({
        url: source.url.trim(),
        mimeType: source.mimeType.trim().toLowerCase(),
        label: source.label?.trim() === "" ? null : (source.label ?? null),
      })),
      posterUrl: input.posterUrl ?? null,
      captionsUrl: input.captionsUrl ?? null,
      durationSec: input.durationSec ?? null,
      fileUrl: input.fileUrl ?? null,
      fileSize: input.fileSize ?? null,
      mimeType: input.mimeType ?? null,
    };
  }

  /**
   * Refuse a storage reference that is not this customer's.
   *
   * A plain `https://` value is somebody else's CDN and none of our business —
   * passed through untouched, which is what lets a customer migrate onto the
   * platform without moving their media first. Only `s3://` is ours to police.
   *
   * The refusal is a validation error rather than a 403: from the author's side
   * this is a malformed field, and confirming that another customer's object
   * exists is more than the refusal needs to say.
   */
  private assertOwnedReference(
    value: string | null,
    customerId: string,
    field: string,
  ): void {
    if (value === null || value === "") return;

    const key = storageKeyOf(value);
    if (key === undefined) return;
    if (keyBelongsToCustomer(key, customerId)) return;

    throw new AppError(
      "validation",
      `content invalid: ${field} references storage outside this tenant`,
      "Diese Datei gehört nicht zu Ihrem Konto. Bitte laden Sie sie erneut hoch.",
    );
  }

  private checkPermutation(
    existing: readonly string[],
    proposed: readonly string[],
    label: string,
  ): void {
    const result = validateReorder(existing, proposed);
    if (result.ok) return;

    const { reason, ids } = result.rejection;
    const detail =
      reason === "missing"
        ? `Die neue Reihenfolge lässt ${ids.length} ${label} aus. Bitte laden Sie die Seite neu.`
        : reason === "unknown"
          ? `Die neue Reihenfolge nennt ${label}, die es nicht mehr gibt. Bitte laden Sie die Seite neu.`
          : `Die neue Reihenfolge nennt ${label} doppelt.`;

    throw new AppError(
      "validation",
      `reorder rejected: ${reason} ${ids.join(",")}`,
      detail,
    );
  }

  /**
   * The refusal for a level that can contain other levels.
   *
   * `assertDeletable` below is the leaf version, where the only question is
   * whether learners have touched it. Both delegate the decision to
   * `deletionVerdict`; neither decides anything itself.
   */
  /**
   * A Lernerfolgskontrolle still holding its questions (P162-01).
   *
   * `quiz_questions` references `contents` with `ON DELETE RESTRICT`, so this
   * used to be a foreign-key violation and a 500 — the console offering a
   * button whose only possible outcome was an internal error (§9.2). It is not
   * routed through `deletionVerdict` because a question is not a
   * `HierarchyLevel`: widening that type to carry one would put a question into
   * every census and every label map on the platform.
   *
   * Refused rather than cascaded, deliberately and on the client's own reading
   * — *"it should not be enabled to be able to delete when the inhalt inside
   * there are not empty"*. Deleting an exam's questions as a side effect of
   * deleting the exam is the kind of quiet data loss this platform cannot
   * afford, and emptying the list first is one click in the editor that already
   * exists.
   */
  private assertNoQuestions(questions: number): void {
    if (questions === 0) return;

    throw new AppError(
      "conflict",
      `refused: content still holds ${questions} quiz questions`,
      `Diese Lernerfolgskontrolle enthält noch ${questions} Fragen. Diese müssen zuerst entfernt werden.`,
    );
  }

  private assertRemovable(records: number, children: ChildCensus, label: string): void {
    const verdict = deletionVerdict({ learnerRecords: records, children });
    if (verdict.ok) return;

    if (verdict.reason === "learner_records") {
      this.assertDeletable(verdict.learnerRecords, label);
      return;
    }

    const listed = verdict.children
      .map((child) => `${child.count} ${LEVEL_LABEL[child.level]}`)
      .join(", ");

    throw new AppError(
      "conflict",
      `refused: ${label} still contains ${listed}`,
      `Dieses ${label} enthält noch ${listed}. Diese müssen zuerst gelöscht werden.`,
    );
  }

  private async requireDepartment(slug: string): Promise<string> {
    const id = await this.repository.findDepartmentId(slug);
    if (id === undefined) {
      throw AppError.notFound(`department slug=${slug} not visible in this tenant`);
    }
    return id;
  }

  private async requireProject(slug: string): Promise<string> {
    const id = await this.repository.findProjectId(slug);
    if (id === undefined) {
      throw AppError.notFound(`project slug=${slug} not visible in this tenant`);
    }
    return id;
  }

  private assertDeletable(records: number, label: string): void {
    if (canDelete(records)) return;

    throw new AppError(
      "conflict",
      `refused: ${records} learner records reference this ${label}`,
      `Für dieses ${label} sind bereits ${records} Teilnahmen erfasst. Es kann nicht gelöscht werden, weil damit der Nachweis zu bereits vergebenen CME-Punkten verloren ginge.`,
    );
  }

  private async requireCourse(slug: string): Promise<string> {
    const id = await this.repository.findCourseId(slug);
    if (id === undefined) {
      throw AppError.notFound(`course slug=${slug} not visible in this tenant`);
    }
    return id;
  }

  /**
   * Turn "the caller named this id" into "this id is part of a course in this
   * tenant", and return that course's slug.
   *
   * RLS already makes another tenant's row invisible, so a missing row here is
   * a 404 rather than a 403 — existence is never confirmed (ADR-0007).
   */
  private async slugOwning(courseId: string | undefined, id: string): Promise<string> {
    if (courseId === undefined) {
      throw AppError.notFound(`id=${id} not visible in this tenant`);
    }
    const slug = await this.repository.courseSlugOf(courseId);
    if (slug === undefined) {
      throw AppError.notFound(`course=${courseId} not visible in this tenant`);
    }
    return slug;
  }

  private async guardUnique(
    find: () => Promise<string | undefined>,
    message: string,
  ): Promise<void> {
    if ((await find()) !== undefined) {
      throw new AppError("conflict", `slug already taken`, message);
    }
  }

  private async audit(
    actor: AuthorContext,
    action: string,
    subject: string,
    detail: Record<string, unknown>,
  ): Promise<void> {
    await this.repository.audit({
      customerId: actor.customerId,
      actorId: actor.userId,
      actorIdentity: actor.identity,
      action,
      subject,
      detail,
    });
  }
}

/**
 * Assign only when the caller actually sent the key.
 *
 * `exactOptionalPropertyTypes` makes `patch.x = undefined` a type error, and
 * semantically it would be wrong anyway: an absent field means "leave alone".
 */
function assign<K extends keyof ProjectPatch>(
  patch: ProjectPatch,
  key: K,
  value: ProjectPatch[K] | undefined,
): void {
  if (value !== undefined) patch[key] = value;
}

/**
 * A German sentence for a rejected question.
 *
 * The *rules* come from `@ds/domain`; the copy is here, because the console
 * renders its own words for the same problems and the two audiences differ — a
 * form marks a field, an API writes one sentence somebody may read in a log
 * viewer. The first problem wins: an author fixes one thing at a time, and a
 * paragraph listing five is read as none.
 */
function germanQuestionProblem(
  problems: readonly QuestionProblem[],
  index: number,
  correct: number,
): string {
  const number = index + 1;
  switch (problems[0]) {
    case "empty_prompt":
      return `Frage ${number} hat keinen Text.`;
    case "too_few_options":
      return `Frage ${number} braucht mindestens ${MIN_QUIZ_OPTIONS} Antwortoptionen.`;
    case "empty_option":
      return `Frage ${number} hat eine leere Antwortoption.`;
    case "no_correct_option":
      return `Frage ${number} hat keine richtige Antwort. Eine Frage ohne richtige Antwort kann niemand bestehen.`;
    case "too_many_correct_options":
      return `Frage ${number} ist als Einfachauswahl angelegt, hat aber ${correct} richtige Antworten. Bitte auf eine reduzieren oder auf Mehrfachauswahl umstellen.`;
    default:
      return `Frage ${number} ist unvollständig.`;
  }
}

/**
 * A German sentence for a rejected content item.
 *
 * Per field rather than one generic line, because each of these has a
 * different fix and the author is looking at a form with several inputs. The
 * duration message explains *why* it is required — an author told only "field
 * missing" reasonably types 1 and moves on, and a video with a made-up length
 * has a watch gate that means nothing.
 */
function contentMessage(problems: readonly ContentProblem[]): string {
  if (problems.includes("durationSec")) {
    return "Ein Video braucht eine Länge in Sekunden — ohne sie lässt sich der erforderliche Videoanteil nicht messen.";
  }
  if (problems.includes("sources")) {
    return "Ein Video braucht mindestens eine Videoquelle, und jede Quelle nur einmal.";
  }
  if (problems.includes("sourceMimeType")) {
    return "Bitte wählen Sie für jede Videoquelle ein unterstütztes Format — ein unbekannter Typ wird vom Browser übersprungen.";
  }
  return `Bitte prüfen Sie: ${problems.join(", ")}.`;
}

/**
 * The stored `identity_provider` value, narrowed to what the contract publishes.
 *
 * A `text` column reads back as `string`, and the response type is an enum, so
 * something has to bridge them. **Not a fallback**: a value outside the set is
 * schema drift — a migration widened `projects_identity_provider_check` without
 * the contract and the console following — and quietly answering `keycloak`
 * would show an operator a setting that is not the one in the row, on the
 * screen they would use to change it.
 *
 * `assertProvidersCoverSchema` already refuses to boot on that drift, so this
 * throw should be unreachable; it exists because "should be unreachable" is not
 * the same as "cannot happen", and this is a read of a column that decides how
 * a learner authenticates.
 */
function narrowIdentityProvider(value: string): "keycloak" | "local" {
  if (value === "keycloak" || value === "local") return value;
  throw new AppError(
    "internal",
    `projects.identity_provider holds ${JSON.stringify(value)}, which the contract does not publish`,
  );
}
