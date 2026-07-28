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

import { canDelete, contentProblems, validateReorder, parseBranding } from "@ds/domain";
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

export interface AuthorContext {
  readonly customerId: string;
  readonly userId: string;
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
      `Eine Abteilung mit dem Kürzel „${input.slug}" existiert bereits.`,
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
    }));
  }

  async createProject(input: ProjectCreate, actor: AuthorContext): Promise<void> {
    const departmentId = await this.repository.findDepartmentId(input.departmentSlug);
    if (departmentId === undefined) {
      throw AppError.notFound(`department slug=${input.departmentSlug} not visible`);
    }

    await this.guardUnique(
      () => this.repository.findProjectId(input.slug),
      `Ein Projekt mit dem Kürzel „${input.slug}" existiert bereits.`,
    );

    await this.repository.createProject({
      departmentId,
      slug: input.slug,
      name: input.name,
    });
    await this.audit(actor, "admin.project.create", input.slug, {
      department: input.departmentSlug,
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
    assign(patch, "keycloakIssuer", update.keycloakIssuer);
    assign(patch, "keycloakAudience", update.keycloakAudience);
    assign(patch, "keycloakRealm", update.keycloakRealm);
    assign(patch, "smtpHost", update.smtpHost);
    assign(patch, "smtpPort", update.smtpPort);
    assign(patch, "smtpUsername", update.smtpUsername);
    assign(patch, "smtpFromAddress", update.smtpFromAddress);
    assign(patch, "smtpFromName", update.smtpFromName);

    if (update.branding !== undefined) {
      patch.branding = parseBranding(update.branding);
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
      `Eine Fortbildung mit dem Kürzel „${input.slug}" existiert bereits.`,
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
              .map(({ chapterId: _chapterId, ...content }) => content),
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
    const records = await this.repository.countModuleRecords(id);
    this.assertDeletable(records, "Modul");

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
    this.assertDeletable(await this.repository.countChapterRecords(id), "Kapitel");

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
    const values = this.validContent(input);

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
    const values = this.validContent(input);

    await this.repository.updateContent(id, values);
    await this.audit(actor, "admin.content.update", id, { kind: input.kind });
    return this.getStructure(courseSlug);
  }

  async deleteContent(id: string, actor: AuthorContext): Promise<CourseStructure> {
    const courseSlug = await this.slugOwning(
      await this.repository.courseIdOfContent(id),
      id,
    );
    this.assertDeletable(await this.repository.countContentRecords(id), "Inhaltselement");

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
    return { contentId, questions: rows.questions };
  }

  /**
   * Replace a quiz (P9-05).
   *
   * Diffed rather than wiped and rewritten, for one reason: a question or
   * option a learner has answered must survive, or an already-submitted attempt
   * stops meaning anything. Anything the caller does not name is a deletion, and
   * a deletion of something answered is refused with the count.
   */
  async setQuiz(
    contentId: string,
    input: QuizWrite,
    actor: AuthorContext,
  ): Promise<AuthoringQuiz> {
    await this.slugOwning(await this.repository.courseIdOfContent(contentId), contentId);

    for (const [index, question] of input.questions.entries()) {
      const correct = question.options.filter((option) => option.isCorrect).length;

      if (correct === 0) {
        throw new AppError(
          "validation",
          `question ${index} has no correct option`,
          `Frage ${index + 1} hat keine richtige Antwort. Eine Frage ohne richtige Antwort kann niemand bestehen.`,
        );
      }
      if (question.kind === "single" && correct > 1) {
        // Scoring is exact-set (`assessment.ts`): a single-choice question with
        // two correct options cannot be answered correctly by anybody.
        throw new AppError(
          "validation",
          `single-choice question ${index} has ${correct} correct options`,
          `Frage ${index + 1} ist als Einfachauswahl angelegt, hat aber ${correct} richtige Antworten. Bitte auf eine reduzieren oder auf Mehrfachauswahl umstellen.`,
        );
      }
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
    const deleteOptionIds: string[] = [];

    for (const question of existing.questions) {
      if (!keptQuestionIds.has(question.id)) {
        if (!canDelete(question.answerCount)) {
          throw new AppError(
            "conflict",
            `question=${question.id} has ${question.answerCount} recorded answers`,
            `Diese Frage wurde bereits ${question.answerCount}-mal beantwortet und kann nicht gelöscht werden. Bereits abgegebene Versuche müssen nachvollziehbar bleiben.`,
          );
        }
        deleteQuestionIds.push(question.id);
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

  private validContent(input: ContentWrite): ContentValues {
    const problems = contentProblems({
      kind: input.kind,
      title: input.title,
      body: input.body ?? null,
      videoUrl: input.videoUrl ?? null,
      durationSec: input.durationSec ?? null,
      fileUrl: input.fileUrl ?? null,
      mimeType: input.mimeType ?? null,
    });

    if (problems.length > 0) {
      throw new AppError(
        "validation",
        `content invalid: ${problems.join(", ")}`,
        problems.includes("durationSec")
          ? "Ein Video braucht eine Länge in Sekunden — ohne sie lässt sich der erforderliche Videoanteil nicht messen."
          : `Bitte prüfen Sie: ${problems.join(", ")}.`,
      );
    }

    return {
      kind: input.kind,
      title: input.title,
      body: input.body ?? null,
      videoUrl: input.videoUrl ?? null,
      durationSec: input.durationSec ?? null,
      fileUrl: input.fileUrl ?? null,
      fileSize: input.fileSize ?? null,
      mimeType: input.mimeType ?? null,
    };
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
