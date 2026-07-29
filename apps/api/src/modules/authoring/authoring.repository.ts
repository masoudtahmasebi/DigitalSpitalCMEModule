/**
 * Authoring data access (P9-02, P9-04, P9-05). Infrastructure layer — ADR-0006.
 *
 * Everything here runs inside the tenant transaction, so RLS scopes every read
 * and write — including the inserts, whose `WITH CHECK` half is what stops a
 * cross-tenant write rather than a `WHERE` clause somebody could forget
 * (ADR-0002).
 *
 * ## Two things in this file are not ordinary CRUD
 *
 * **Reordering** has to survive `UNIQUE (parent_id, ordinal)`. Assigning the new
 * ordinals directly collides the moment two rows swap, so every reorder writes
 * negative ordinals first and then flips them positive — two statements in one
 * transaction, no intermediate state a constraint can object to and none a
 * concurrent reader can see.
 *
 * **Deletion** counts learner records before it removes anything. The count is
 * the input to `canDelete` in `@ds/domain`; the decision is not made here.
 *
 * ## Correlated subqueries qualify the outer column by hand
 *
 * `sql`… ${contents.id}`` renders as a **bare** `"id"`, not `"contents"."id"`.
 * Inside a subquery over another table that has its own `id`, the inner table
 * captures it — so `WHERE cp.content_id = "id"` silently compares
 * `content_progress.content_id` to `content_progress.id` and counts zero. No
 * error, no warning, just a count that is always 0 and a delete guard that
 * always lets go.
 *
 * That is exactly what the first version of this file did, on all six of these
 * counts. The integration test caught it because it asserts a number rather
 * than the absence of a crash. Every correlated reference below is therefore
 * written out in full.
 */

import { and, eq, inArray, sql } from "drizzle-orm";
import type { Db } from "../../db/tenant-db.js";
import {
  auditLog,
  chapters,
  contentProgress,
  contents,
  courseExperts,
  courses,
  departments,
  evaluations,
  modules,
  projects,
  quizOptions,
  quizQuestions,
} from "../../db/schema.js";

export interface AuthoringRepositoryPort {
  findProjectId(slug: string): Promise<string | undefined>;
  findCourseId(slug: string): Promise<string | undefined>;
  courseSlugOf(courseId: string): Promise<string | undefined>;
  listDepartments(): Promise<DepartmentRow[]>;
  listProjects(): Promise<ProjectRow[]>;
  createDepartment(input: { slug: string; name: string }): Promise<void>;
  updateDepartment(slug: string, patch: { name?: string | undefined }): Promise<boolean>;
  createProject(input: {
    departmentId: string;
    slug: string;
    name: string;
  }): Promise<void>;
  findDepartmentId(slug: string): Promise<string | undefined>;
  updateProject(slug: string, patch: ProjectPatch): Promise<boolean>;
  createCourse(input: {
    projectId: string;
    slug: string;
    title: string;
    description: string | null;
    deliveryType: "on_demand" | "live" | "praesenz";
  }): Promise<void>;

  loadStructure(courseId: string): Promise<StructureRows>;

  createModule(
    courseId: string,
    input: { title: string; subtitle: string | null },
  ): Promise<void>;
  updateModule(
    id: string,
    input: { title: string; subtitle: string | null },
  ): Promise<boolean>;
  createChapter(
    moduleId: string,
    input: { title: string; body: string | null },
  ): Promise<void>;
  updateChapter(
    id: string,
    input: { title: string; body: string | null },
  ): Promise<boolean>;
  createContent(chapterId: string, input: ContentValues): Promise<void>;
  updateContent(id: string, input: ContentValues): Promise<boolean>;

  moduleBelongsTo(id: string, courseId: string): Promise<boolean>;
  chapterBelongsTo(id: string, courseId: string): Promise<boolean>;
  contentBelongsTo(id: string, courseId: string): Promise<boolean>;
  courseIdOfModule(id: string): Promise<string | undefined>;
  courseIdOfChapter(id: string): Promise<string | undefined>;
  courseIdOfContent(id: string): Promise<string | undefined>;

  countModuleRecords(id: string): Promise<number>;
  countChapterRecords(id: string): Promise<number>;
  countContentRecords(id: string): Promise<number>;
  deleteModule(id: string): Promise<void>;
  deleteChapter(id: string): Promise<void>;
  deleteContent(id: string): Promise<void>;

  applyOrder(order: AppliedOrder): Promise<void>;
  replaceExperts(courseId: string, experts: readonly ExpertValues[]): Promise<void>;

  loadQuiz(contentId: string): Promise<QuizRows>;
  applyQuiz(contentId: string, plan: QuizPlan): Promise<void>;
  loadEvaluation(courseId: string): Promise<EvaluationRow[]>;
  applyEvaluation(courseId: string, plan: EvaluationPlan): Promise<void>;

  /**
   * Append-only. `detail` carries field names and counts — never a prompt, an
   * answer key or an SMTP credential (CLAUDE.md §4 invariant 7).
   */
  audit(entry: {
    customerId: string;
    actorId: string;
    action: string;
    subject: string;
    detail: Record<string, unknown>;
  }): Promise<void>;
}

export interface DepartmentRow {
  slug: string;
  name: string;
  projectCount: number;
}

export interface ProjectRow {
  slug: string;
  name: string;
  departmentSlug: string;
  keycloakIssuer: string | null;
  keycloakAudience: string | null;
  keycloakRealm: string | null;
  smtpHost: string | null;
  smtpPort: number | null;
  smtpUsername: string | null;
  smtpFromAddress: string | null;
  smtpFromName: string | null;
  hasSmtpPassword: boolean;
  branding: unknown;
  courseCount: number;
}

export interface ProjectPatch {
  name?: string;
  keycloakIssuer?: string | null;
  keycloakAudience?: string | null;
  keycloakRealm?: string | null;
  smtpHost?: string | null;
  smtpPort?: number | null;
  smtpUsername?: string | null;
  /** Already encrypted by the service — a repository never holds a plaintext secret. */
  smtpPasswordEnc?: Buffer;
  smtpFromAddress?: string | null;
  smtpFromName?: string | null;
  branding?: unknown;
}

export interface ContentValues {
  kind: "video" | "text" | "quiz" | "details" | "material";
  title: string;
  body: string | null;
  /** Stored as authored — `s3://` references are not resolved on this path. */
  sources: ReadonlyArray<{ url: string; mimeType: string; label: string | null }>;
  posterUrl: string | null;
  captionsUrl: string | null;
  durationSec: number | null;
  fileUrl: string | null;
  fileSize: number | null;
  mimeType: string | null;
}

export interface ExpertValues {
  roleLabel: string;
  name: string;
  institution: string | null;
  biography: string | null;
  photoUrl: string | null;
}

export interface StructureRows {
  modules: Array<{ id: string; title: string; subtitle: string | null }>;
  chapters: Array<{ id: string; moduleId: string; title: string; body: string | null }>;
  contents: Array<{
    id: string;
    chapterId: string;
    kind: "video" | "text" | "quiz" | "details" | "material";
    title: string;
    body: string | null;
    mediaSources: unknown;
    posterUrl: string | null;
    captionsUrl: string | null;
    durationSec: number | null;
    fileUrl: string | null;
    fileSize: number | null;
    mimeType: string | null;
    learnerRecords: number;
    questionCount: number | null;
  }>;
  experts: Array<{
    id: string;
    roleLabel: string;
    name: string;
    institution: string | null;
    biography: string | null;
    photoUrl: string | null;
  }>;
}

/** Already validated: every id exists and belongs to this course. */
export interface AppliedOrder {
  modules: Array<{ id: string; chapters: Array<{ id: string; contents: string[] }> }>;
}

export interface QuizRows {
  questions: Array<{
    id: string;
    prompt: string;
    kind: "single" | "multi";
    answerCount: number;
    options: Array<{ id: string; label: string; isCorrect: boolean }>;
  }>;
}

export interface QuizPlan {
  deleteQuestionIds: string[];
  deleteOptionIds: string[];
  questions: Array<{
    id: string | undefined;
    prompt: string;
    kind: "single" | "multi";
    options: Array<{ id?: string | undefined; label: string; isCorrect: boolean }>;
  }>;
}

export interface EvaluationRow {
  id: string;
  prompt: string;
  kind: "scale" | "text" | "single";
  required: boolean;
  options: string[];
  responseCount: number;
}

export interface EvaluationPlan {
  deleteIds: string[];
  questions: Array<{
    id: string | undefined;
    prompt: string;
    kind: "scale" | "text" | "single";
    required: boolean;
    options: string[];
  }>;
}

export class AuthoringRepository implements AuthoringRepositoryPort {
  constructor(private readonly db: Db) {}

  // -------------------------------------------------------------------------
  // Lookups
  // -------------------------------------------------------------------------

  async findProjectId(slug: string): Promise<string | undefined> {
    const [row] = await this.db
      .select({ id: projects.id })
      .from(projects)
      .where(eq(projects.slug, slug))
      .limit(1);
    return row?.id;
  }

  async findDepartmentId(slug: string): Promise<string | undefined> {
    const [row] = await this.db
      .select({ id: departments.id })
      .from(departments)
      .where(eq(departments.slug, slug))
      .limit(1);
    return row?.id;
  }

  async findCourseId(slug: string): Promise<string | undefined> {
    const [row] = await this.db
      .select({ id: courses.id })
      .from(courses)
      .where(eq(courses.slug, slug))
      .limit(1);
    return row?.id;
  }

  async courseSlugOf(courseId: string): Promise<string | undefined> {
    const [row] = await this.db
      .select({ slug: courses.slug })
      .from(courses)
      .where(eq(courses.id, courseId))
      .limit(1);
    return row?.slug;
  }

  async audit(entry: {
    customerId: string;
    actorId: string;
    action: string;
    subject: string;
    detail: Record<string, unknown>;
  }): Promise<void> {
    await this.db.insert(auditLog).values(entry);
  }

  // -------------------------------------------------------------------------
  // Departments and projects
  // -------------------------------------------------------------------------

  async listDepartments(): Promise<DepartmentRow[]> {
    return this.db
      .select({
        slug: departments.slug,
        name: departments.name,
        projectCount: sql<number>`(
          SELECT count(*)::int FROM projects p WHERE p.department_id = "departments"."id"
        )`,
      })
      .from(departments)
      .orderBy(departments.name);
  }

  async listProjects(): Promise<ProjectRow[]> {
    return this.db
      .select({
        slug: projects.slug,
        name: projects.name,
        departmentSlug: departments.slug,
        keycloakIssuer: projects.keycloakIssuer,
        keycloakAudience: projects.keycloakAudience,
        keycloakRealm: projects.keycloakRealm,
        smtpHost: projects.smtpHost,
        smtpPort: projects.smtpPort,
        smtpUsername: projects.smtpUsername,
        smtpFromAddress: projects.smtpFromAddress,
        smtpFromName: projects.smtpFromName,
        // Presence, never the ciphertext — the safest place to not leak a
        // secret is to not select it.
        hasSmtpPassword: sql<boolean>`${projects.smtpPasswordEnc} IS NOT NULL`,
        branding: projects.branding,
        courseCount: sql<number>`(
          SELECT count(*)::int FROM courses c WHERE c.project_id = "projects"."id"
        )`,
      })
      .from(projects)
      .innerJoin(departments, eq(departments.id, projects.departmentId))
      .orderBy(projects.name);
  }

  async createDepartment(input: { slug: string; name: string }): Promise<void> {
    // `customer_id` comes from the RLS session variable, not from the caller.
    // A department cannot be created into another tenant because there is no
    // way to say which tenant.
    await this.db.execute(sql`
      INSERT INTO departments (customer_id, slug, name)
      VALUES (current_setting('app.customer_id')::uuid, ${input.slug}, ${input.name})
    `);
  }

  async updateDepartment(
    slug: string,
    patch: { name?: string | undefined },
  ): Promise<boolean> {
    if (patch.name === undefined) return true;
    const result = await this.db
      .update(departments)
      .set({ name: patch.name, updatedAt: new Date() })
      .where(eq(departments.slug, slug))
      .returning({ id: departments.id });
    return result.length > 0;
  }

  async createProject(input: {
    departmentId: string;
    slug: string;
    name: string;
  }): Promise<void> {
    await this.db.execute(sql`
      INSERT INTO projects (customer_id, department_id, slug, name)
      VALUES (
        current_setting('app.customer_id')::uuid,
        ${input.departmentId}, ${input.slug}, ${input.name}
      )
    `);
  }

  async updateProject(slug: string, patch: ProjectPatch): Promise<boolean> {
    if (Object.keys(patch).length === 0) return true;

    const result = await this.db
      .update(projects)
      .set({ ...patch, updatedAt: new Date() })
      .where(eq(projects.slug, slug))
      .returning({ id: projects.id });
    return result.length > 0;
  }

  async createCourse(input: {
    projectId: string;
    slug: string;
    title: string;
    description: string | null;
    deliveryType: "on_demand" | "live" | "praesenz";
  }): Promise<void> {
    await this.db.execute(sql`
      INSERT INTO courses (customer_id, project_id, slug, title, description, delivery_type)
      VALUES (
        current_setting('app.customer_id')::uuid,
        ${input.projectId}, ${input.slug}, ${input.title},
        ${input.description}, ${input.deliveryType}::course_delivery_type
      )
    `);
  }

  // -------------------------------------------------------------------------
  // The tree
  // -------------------------------------------------------------------------

  async loadStructure(courseId: string): Promise<StructureRows> {
    const moduleRows = await this.db
      .select({ id: modules.id, title: modules.title, subtitle: modules.subtitle })
      .from(modules)
      .where(eq(modules.courseId, courseId))
      .orderBy(modules.ordinal);

    const moduleIds = moduleRows.map((row) => row.id);

    const chapterRows =
      moduleIds.length === 0
        ? []
        : await this.db
            .select({
              id: chapters.id,
              moduleId: chapters.moduleId,
              title: chapters.title,
              body: chapters.body,
            })
            .from(chapters)
            .where(inArray(chapters.moduleId, moduleIds))
            .orderBy(chapters.ordinal);

    const chapterIds = chapterRows.map((row) => row.id);

    const contentRows =
      chapterIds.length === 0
        ? []
        : await this.db
            .select({
              id: contents.id,
              chapterId: contents.chapterId,
              kind: contents.kind,
              title: contents.title,
              body: contents.body,
              mediaSources: contents.mediaSources,
              posterUrl: contents.posterUrl,
              captionsUrl: contents.captionsUrl,
              durationSec: contents.durationSec,
              fileUrl: contents.fileUrl,
              fileSize: contents.fileSize,
              mimeType: contents.mimeType,
              // The delete guard's input, computed where the rows are rather
              // than in a second round trip per item.
              learnerRecords: sql<number>`(
                SELECT count(*)::int FROM content_progress cp
                 WHERE cp.content_id = "contents"."id"
              )`,
              questionCount: sql<number | null>`(
                CASE WHEN "contents"."kind" = 'quiz' THEN (
                  SELECT count(*)::int FROM quiz_questions q
                   WHERE q.content_id = "contents"."id"
                ) ELSE NULL END
              )`,
            })
            .from(contents)
            .where(inArray(contents.chapterId, chapterIds))
            .orderBy(contents.ordinal);

    const expertRows = await this.db
      .select({
        id: courseExperts.id,
        roleLabel: courseExperts.roleLabel,
        name: courseExperts.name,
        institution: courseExperts.institution,
        biography: courseExperts.biography,
        photoUrl: courseExperts.photoUrl,
      })
      .from(courseExperts)
      .where(eq(courseExperts.courseId, courseId))
      .orderBy(courseExperts.ordinal);

    return {
      modules: moduleRows,
      chapters: chapterRows,
      contents: contentRows,
      experts: expertRows,
    };
  }

  // -------------------------------------------------------------------------
  // Item writes. New items append; `ordinal` is never supplied by a client.
  // -------------------------------------------------------------------------

  async createModule(
    courseId: string,
    input: { title: string; subtitle: string | null },
  ): Promise<void> {
    await this.db.execute(sql`
      INSERT INTO modules (customer_id, course_id, ordinal, title, subtitle)
      VALUES (
        current_setting('app.customer_id')::uuid, ${courseId},
        (SELECT coalesce(max(ordinal), -1) + 1 FROM modules WHERE course_id = ${courseId}),
        ${input.title}, ${input.subtitle}
      )
    `);
  }

  async updateModule(
    id: string,
    input: { title: string; subtitle: string | null },
  ): Promise<boolean> {
    const result = await this.db
      .update(modules)
      .set({ title: input.title, subtitle: input.subtitle, updatedAt: new Date() })
      .where(eq(modules.id, id))
      .returning({ id: modules.id });
    return result.length > 0;
  }

  async createChapter(
    moduleId: string,
    input: { title: string; body: string | null },
  ): Promise<void> {
    await this.db.execute(sql`
      INSERT INTO chapters (customer_id, module_id, ordinal, title, body)
      VALUES (
        current_setting('app.customer_id')::uuid, ${moduleId},
        (SELECT coalesce(max(ordinal), -1) + 1 FROM chapters WHERE module_id = ${moduleId}),
        ${input.title}, ${input.body}
      )
    `);
  }

  async updateChapter(
    id: string,
    input: { title: string; body: string | null },
  ): Promise<boolean> {
    const result = await this.db
      .update(chapters)
      .set({ title: input.title, body: input.body, updatedAt: new Date() })
      .where(eq(chapters.id, id))
      .returning({ id: chapters.id });
    return result.length > 0;
  }

  async createContent(chapterId: string, input: ContentValues): Promise<void> {
    await this.db.execute(sql`
      INSERT INTO contents (customer_id, chapter_id, ordinal, kind, title, body,
                            media_sources, poster_url, captions_url, duration_sec, file_url,
                            file_size, mime_type)
      VALUES (
        current_setting('app.customer_id')::uuid, ${chapterId},
        (SELECT coalesce(max(ordinal), -1) + 1 FROM contents WHERE chapter_id = ${chapterId}),
        ${input.kind}::content_kind, ${input.title}, ${input.body},
        ${JSON.stringify(input.sources)}::jsonb, ${input.posterUrl}, ${input.captionsUrl}, ${input.durationSec}, ${input.fileUrl},
        ${input.fileSize}, ${input.mimeType}
      )
    `);
  }

  async updateContent(id: string, input: ContentValues): Promise<boolean> {
    const { sources, ...rest } = input;
    const result = await this.db
      .update(contents)
      // `sources` is the API's name for the column `media_sources`; spreading
      // `input` wholesale would silently write nothing, because Drizzle ignores
      // a key that is not a column.
      .set({ ...rest, mediaSources: [...sources], updatedAt: new Date() })
      .where(eq(contents.id, id))
      .returning({ id: contents.id });
    return result.length > 0;
  }

  // -------------------------------------------------------------------------
  // Ownership. A path id is a claim; these turn it into a fact.
  // -------------------------------------------------------------------------

  async moduleBelongsTo(id: string, courseId: string): Promise<boolean> {
    const [row] = await this.db
      .select({ id: modules.id })
      .from(modules)
      .where(and(eq(modules.id, id), eq(modules.courseId, courseId)))
      .limit(1);
    return row !== undefined;
  }

  async chapterBelongsTo(id: string, courseId: string): Promise<boolean> {
    return (await this.courseIdOfChapter(id)) === courseId;
  }

  async contentBelongsTo(id: string, courseId: string): Promise<boolean> {
    return (await this.courseIdOfContent(id)) === courseId;
  }

  async courseIdOfModule(id: string): Promise<string | undefined> {
    const [row] = await this.db
      .select({ courseId: modules.courseId })
      .from(modules)
      .where(eq(modules.id, id))
      .limit(1);
    return row?.courseId;
  }

  async courseIdOfChapter(id: string): Promise<string | undefined> {
    const [row] = await this.db
      .select({ courseId: modules.courseId })
      .from(chapters)
      .innerJoin(modules, eq(modules.id, chapters.moduleId))
      .where(eq(chapters.id, id))
      .limit(1);
    return row?.courseId;
  }

  async courseIdOfContent(id: string): Promise<string | undefined> {
    const [row] = await this.db
      .select({ courseId: modules.courseId })
      .from(contents)
      .innerJoin(chapters, eq(chapters.id, contents.chapterId))
      .innerJoin(modules, eq(modules.id, chapters.moduleId))
      .where(eq(contents.id, id))
      .limit(1);
    return row?.courseId;
  }

  // -------------------------------------------------------------------------
  // Deletion. The counts are the input to `canDelete`; the decision is not here.
  // -------------------------------------------------------------------------

  async countModuleRecords(id: string): Promise<number> {
    const [row] = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(contentProgress)
      .where(
        sql`${contentProgress.contentId} IN (
          SELECT c.id FROM contents c
            JOIN chapters ch ON ch.id = c.chapter_id
           WHERE ch.module_id = ${id}
        )`,
      );
    return row?.count ?? 0;
  }

  async countChapterRecords(id: string): Promise<number> {
    const [row] = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(contentProgress)
      .where(
        sql`${contentProgress.contentId} IN (
          SELECT c.id FROM contents c WHERE c.chapter_id = ${id}
        )`,
      );
    return row?.count ?? 0;
  }

  async countContentRecords(id: string): Promise<number> {
    const [row] = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(contentProgress)
      .where(eq(contentProgress.contentId, id));
    return row?.count ?? 0;
  }

  async deleteModule(id: string): Promise<void> {
    await this.db.delete(modules).where(eq(modules.id, id));
  }

  async deleteChapter(id: string): Promise<void> {
    await this.db.delete(chapters).where(eq(chapters.id, id));
  }

  async deleteContent(id: string): Promise<void> {
    await this.db.delete(contents).where(eq(contents.id, id));
  }

  // -------------------------------------------------------------------------
  // Reordering
  // -------------------------------------------------------------------------

  /**
   * Apply a whole tree's ordering.
   *
   * Negative ordinals first, then flipped positive. `UNIQUE (parent, ordinal)`
   * makes the direct assignment impossible the moment two rows swap — the first
   * UPDATE would collide with a value the second has not yet vacated. Writing
   * `-1 - position` puts every row in a range the constraint cannot see a
   * conflict in, and the second pass lands them all at once.
   *
   * A chapter's `module_id` and a content's `chapter_id` are set here too:
   * moving an item between parents *is* a reorder, and doing it as a separate
   * request would leave a window in which the item belongs to neither.
   */
  async applyOrder(order: AppliedOrder): Promise<void> {
    const moduleIds = order.modules.map((module) => module.id);
    const chapterMoves = order.modules.flatMap((module, moduleIndex) =>
      module.chapters.map((chapter, chapterIndex) => ({
        id: chapter.id,
        moduleId: module.id,
        position: chapterIndex,
        moduleIndex,
      })),
    );
    const contentMoves = order.modules.flatMap((module) =>
      module.chapters.flatMap((chapter) =>
        chapter.contents.map((contentId, index) => ({
          id: contentId,
          chapterId: chapter.id,
          position: index,
        })),
      ),
    );

    // Pass one: park everything out of the way.
    if (moduleIds.length > 0) {
      await this.db.execute(
        sql`UPDATE modules SET ordinal = -1 - ordinal WHERE id IN (${sql.join(
          moduleIds.map((id) => sql`${id}::uuid`),
          sql`, `,
        )}) AND ordinal >= 0`,
      );
    }
    if (chapterMoves.length > 0) {
      await this.db.execute(
        sql`UPDATE chapters SET ordinal = -1 - ordinal WHERE id IN (${sql.join(
          chapterMoves.map((move) => sql`${move.id}::uuid`),
          sql`, `,
        )}) AND ordinal >= 0`,
      );
    }
    if (contentMoves.length > 0) {
      await this.db.execute(
        sql`UPDATE contents SET ordinal = -1 - ordinal WHERE id IN (${sql.join(
          contentMoves.map((move) => sql`${move.id}::uuid`),
          sql`, `,
        )}) AND ordinal >= 0`,
      );
    }

    // Pass two: the real positions.
    for (const [index, id] of moduleIds.entries()) {
      await this.db
        .update(modules)
        .set({ ordinal: index, updatedAt: new Date() })
        .where(eq(modules.id, id));
    }
    for (const move of chapterMoves) {
      await this.db
        .update(chapters)
        .set({ ordinal: move.position, moduleId: move.moduleId, updatedAt: new Date() })
        .where(eq(chapters.id, move.id));
    }
    for (const move of contentMoves) {
      await this.db
        .update(contents)
        .set({ ordinal: move.position, chapterId: move.chapterId, updatedAt: new Date() })
        .where(eq(contents.id, move.id));
    }
  }

  async replaceExperts(
    courseId: string,
    experts: readonly ExpertValues[],
  ): Promise<void> {
    await this.db.delete(courseExperts).where(eq(courseExperts.courseId, courseId));

    for (const [index, expert] of experts.entries()) {
      await this.db.execute(sql`
        INSERT INTO course_experts (customer_id, course_id, ordinal, role_label,
                                    name, institution, biography, photo_url)
        VALUES (
          current_setting('app.customer_id')::uuid, ${courseId}, ${index},
          ${expert.roleLabel}, ${expert.name}, ${expert.institution},
          ${expert.biography}, ${expert.photoUrl}
        )
      `);
    }
  }

  // -------------------------------------------------------------------------
  // Assessment
  // -------------------------------------------------------------------------

  async loadQuiz(contentId: string): Promise<QuizRows> {
    const questionRows = await this.db
      .select({
        id: quizQuestions.id,
        prompt: quizQuestions.prompt,
        kind: quizQuestions.kind,
        answerCount: sql<number>`(
          SELECT count(*)::int FROM quiz_answers a WHERE a.question_id = "quiz_questions"."id"
        )`,
      })
      .from(quizQuestions)
      .where(eq(quizQuestions.contentId, contentId))
      .orderBy(quizQuestions.ordinal);

    const questionIds = questionRows.map((row) => row.id);

    const optionRows =
      questionIds.length === 0
        ? []
        : await this.db
            .select({
              id: quizOptions.id,
              questionId: quizOptions.questionId,
              label: quizOptions.label,
              isCorrect: quizOptions.isCorrect,
            })
            .from(quizOptions)
            .where(inArray(quizOptions.questionId, questionIds))
            .orderBy(quizOptions.ordinal);

    return {
      questions: questionRows.map((question) => ({
        ...question,
        options: optionRows
          .filter((option) => option.questionId === question.id)
          .map(({ id, label, isCorrect }) => ({ id, label, isCorrect })),
      })),
    };
  }

  async applyQuiz(contentId: string, plan: QuizPlan): Promise<void> {
    if (plan.deleteOptionIds.length > 0) {
      await this.db
        .delete(quizOptions)
        .where(inArray(quizOptions.id, plan.deleteOptionIds));
    }
    if (plan.deleteQuestionIds.length > 0) {
      await this.db
        .delete(quizQuestions)
        .where(inArray(quizQuestions.id, plan.deleteQuestionIds));
    }

    // Park the survivors, so re-ordering questions cannot collide on
    // `UNIQUE (content_id, ordinal)`.
    await this.db.execute(
      sql`UPDATE quiz_questions SET ordinal = -1 - ordinal
           WHERE content_id = ${contentId} AND ordinal >= 0`,
    );

    for (const [index, question] of plan.questions.entries()) {
      const questionId =
        question.id ??
        (
          await this.db.execute<{ id: string }>(sql`
            INSERT INTO quiz_questions (customer_id, content_id, ordinal, prompt, kind)
            VALUES (
              current_setting('app.customer_id')::uuid, ${contentId}, ${index},
              ${question.prompt}, ${question.kind}::question_kind
            )
            RETURNING id
          `)
        ).rows[0]!.id;

      if (question.id !== undefined) {
        await this.db
          .update(quizQuestions)
          .set({ ordinal: index, prompt: question.prompt, kind: question.kind })
          .where(eq(quizQuestions.id, questionId));

        await this.db.execute(
          sql`UPDATE quiz_options SET ordinal = -1 - ordinal
               WHERE question_id = ${questionId} AND ordinal >= 0`,
        );
      }

      for (const [optionIndex, option] of question.options.entries()) {
        if (option.id === undefined) {
          await this.db.execute(sql`
            INSERT INTO quiz_options (customer_id, question_id, ordinal, label, is_correct)
            VALUES (
              current_setting('app.customer_id')::uuid, ${questionId}, ${optionIndex},
              ${option.label}, ${option.isCorrect}
            )
          `);
        } else {
          await this.db
            .update(quizOptions)
            .set({
              ordinal: optionIndex,
              label: option.label,
              isCorrect: option.isCorrect,
            })
            .where(eq(quizOptions.id, option.id));
        }
      }
    }
  }

  async loadEvaluation(courseId: string): Promise<EvaluationRow[]> {
    const rows = await this.db
      .select({
        id: evaluations.id,
        prompt: evaluations.prompt,
        kind: evaluations.kind,
        required: evaluations.required,
        options: evaluations.options,
        responseCount: sql<number>`(
          SELECT count(*)::int FROM evaluation_responses r
           WHERE r.evaluation_id = "evaluations"."id"
        )`,
      })
      .from(evaluations)
      .where(eq(evaluations.courseId, courseId))
      .orderBy(evaluations.ordinal);

    return rows.map((row) => ({
      ...row,
      kind: row.kind as EvaluationRow["kind"],
      options: Array.isArray(row.options) ? (row.options as string[]) : [],
    }));
  }

  async applyEvaluation(courseId: string, plan: EvaluationPlan): Promise<void> {
    if (plan.deleteIds.length > 0) {
      await this.db.delete(evaluations).where(inArray(evaluations.id, plan.deleteIds));
    }

    await this.db.execute(
      sql`UPDATE evaluations SET ordinal = -1 - ordinal
           WHERE course_id = ${courseId} AND ordinal >= 0`,
    );

    for (const [index, question] of plan.questions.entries()) {
      if (question.id === undefined) {
        await this.db.execute(sql`
          INSERT INTO evaluations (customer_id, course_id, ordinal, prompt, kind, required, options)
          VALUES (
            current_setting('app.customer_id')::uuid, ${courseId}, ${index},
            ${question.prompt}, ${question.kind}, ${question.required},
            ${JSON.stringify(question.options)}::jsonb
          )
        `);
      } else {
        await this.db
          .update(evaluations)
          .set({
            ordinal: index,
            prompt: question.prompt,
            kind: question.kind,
            required: question.required,
            options: question.options,
          })
          .where(eq(evaluations.id, question.id));
      }
    }
  }
}
