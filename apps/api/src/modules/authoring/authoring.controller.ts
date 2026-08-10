/**
 * Authoring HTTP surface (P9-02, P9-04, P9-05). Interface layer — ADR-0006.
 *
 * ## Roles
 *
 * The organisation — departments and projects — is `customer_admin` or
 * `super_admin`. A `department_admin` can read participant reporting but cannot
 * change a course: ordering decides gating, and a quiz decides who earns a CME
 * point, so authoring is customer-level authority rather than departmental.
 *
 * From `POST courses` downwards, `course_editor` is added (P38-01). That is the
 * role the client asked for — *"can create only courses"* — and until now it was
 * declared in `@ds/domain`, assignable in the console, and accepted by no route
 * in the platform. The banner halfway down this file marks the boundary: above
 * it is the organisation, below it is a course, and that is exactly where the
 * role's authority stops.
 *
 * The console hides what a role cannot use. That is a courtesy — the refusal is
 * here, and every one of these routes 403s regardless of what a client chose to
 * draw.
 *
 * ## Why the mutating routes return the whole structure
 *
 * An authoring screen has to re-render after every change, and the change may
 * not be local: creating a module appends it, deleting one renumbers what
 * follows, a reorder moves several things at once. Returning the tree makes the
 * client's state the server's answer rather than a local edit that has to agree
 * with it — the same rule the learner widget follows for `EnrolmentState`, and
 * for the same reason.
 */

import {
  Body,
  Controller,
  Delete,
  HttpCode,
  Get,
  Inject,
  Param,
  Patch,
  Post,
  Put,
} from "@nestjs/common";
import { Roles } from "../../auth/roles.decorator.js";
import { RateLimit } from "../../shared/rate-limit.guard.js";
import { CurrentPrincipal } from "../../auth/current-principal.decorator.js";
import type { Principal } from "../../auth/principal.js";
import { AppError } from "../../shared/problem-details.js";
import { TenantDb } from "../../db/tenant-db.decorator.js";
import type { Db } from "../../db/tenant-db.js";
import { APP_CONFIG } from "../../db/tokens.js";
import type { AppConfig } from "../../config/config.js";
import { createSecretCipher } from "../../shared/secret-cipher.js";
import { AuthoringService } from "./authoring.service.js";
import {
  chapterWriteSchema,
  contentWriteSchema,
  courseCreateSchema,
  departmentCreateSchema,
  departmentUpdateSchema,
  evaluationWriteSchema,
  expertsWriteSchema,
  moduleWriteSchema,
  projectCreateSchema,
  projectUpdateSchema,
  quizWriteSchema,
  structureOrderSchema,
} from "./authoring.dto.js";
import type { ZodType } from "zod";

const AUTHOR_ROLES = ["customer_admin", "super_admin"] as const;

/**
 * The roles that may write a course and the content inside it (P38-01).
 *
 * `course_editor` is `AUTHOR_ROLES` plus exactly the client's requirement:
 * *"customer users who can create only courses, so they have limited access"*.
 * The capability matrix in `@ds/domain` grants it `course` and `content`; until
 * now nothing here accepted it, so the role existed, could be assigned, and
 * bought its holder nothing at all.
 *
 * The line is drawn at the course boundary and nowhere else. Everything from
 * `POST courses` downwards — modules, chapters, contents, ordering, experts,
 * the quiz, the evaluation — is course content and is theirs. Everything above
 * it — departments, projects — is the organisation, and stays with
 * `AUTHOR_ROLES`. An agency writing content for a customer gets this and
 * cannot reorganise the customer around itself.
 */
const COURSE_AUTHOR_ROLES = ["course_editor", ...AUTHOR_ROLES] as const;

@Controller("admin")
export class AuthoringController {
  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  // -------------------------------------------------------------------------
  // Departments and projects (P9-02)
  // -------------------------------------------------------------------------

  @Get("departments")
  @Roles("department_admin", ...AUTHOR_ROLES)
  async listDepartments(@TenantDb() db: Db) {
    return this.service(db).listDepartments();
  }

  @Post("departments")
  @Roles(...AUTHOR_ROLES)
  async createDepartment(
    @Body() body: unknown,
    @CurrentPrincipal() principal: Principal,
    @TenantDb() db: Db,
  ) {
    const input = parse(departmentCreateSchema, body, "department");
    await this.service(db).createDepartment(input, context(principal));
    return this.service(db).listDepartments();
  }

  @Patch("departments/:slug")
  @Roles(...AUTHOR_ROLES)
  async updateDepartment(
    @Param("slug") slug: string,
    @Body() body: unknown,
    @CurrentPrincipal() principal: Principal,
    @TenantDb() db: Db,
  ) {
    const input = parse(departmentUpdateSchema, body, "department");
    await this.service(db).updateDepartment(slug, input, context(principal));
    return this.service(db).listDepartments();
  }

  /**
   * Delete a department (P12-04).
   *
   * `AUTHOR_ROLES` and not `department_admin`: a department administrator's
   * scope *is* the department, so letting them delete it would let them delete
   * the thing that bounds them.
   */
  @Delete("departments/:slug")
  @Roles(...AUTHOR_ROLES)
  async deleteDepartment(
    @Param("slug") slug: string,
    @CurrentPrincipal() principal: Principal,
    @TenantDb() db: Db,
  ) {
    await this.service(db).deleteDepartment(slug, context(principal));
    return this.service(db).listDepartments();
  }

  /*
   * Read-only, and `course_editor` may (P38-01): creating a course means
   * choosing the project it belongs to, so a role that may create courses and
   * may not list projects cannot create one. Reading the list is not managing
   * it — every mutating route below stays with `AUTHOR_ROLES`.
   */
  @Get("projects")
  @Roles(...COURSE_AUTHOR_ROLES)
  async listProjects(@TenantDb() db: Db) {
    return this.service(db).listProjects();
  }

  @Post("projects")
  @Roles(...AUTHOR_ROLES)
  async createProject(
    @Body() body: unknown,
    @CurrentPrincipal() principal: Principal,
    @TenantDb() db: Db,
  ) {
    const input = parse(projectCreateSchema, body, "project");
    await this.service(db).createProject(input, context(principal));
    return this.service(db).listProjects();
  }

  /**
   * Edit a project, including its Keycloak binding.
   *
   * That binding decides which realm every token for this project is validated
   * against (ADR-0003) — getting it wrong locks every learner out at once, which
   * is why the console asks for confirmation before saving it. The API applies
   * what it is given: this is configuration, and a platform that refused to let
   * an admin change their own IdP would be a worse failure than the one it
   * prevented.
   */
  @Patch("projects/:slug")
  @Roles(...AUTHOR_ROLES)
  async updateProject(
    @Param("slug") slug: string,
    @Body() body: unknown,
    @CurrentPrincipal() principal: Principal,
    @TenantDb() db: Db,
  ) {
    const input = parse(projectUpdateSchema, body, "project");
    await this.service(db).updateProject(slug, input, context(principal));
    return this.service(db).listProjects();
  }

  @Delete("projects/:slug")
  @Roles(...AUTHOR_ROLES)
  async deleteProject(
    @Param("slug") slug: string,
    @CurrentPrincipal() principal: Principal,
    @TenantDb() db: Db,
  ) {
    await this.service(db).deleteProject(slug, context(principal));
    return this.service(db).listProjects();
  }

  // -------------------------------------------------------------------------
  // Courses and structure (P9-04)
  //
  // Everything below this line accepts `course_editor` (P38-01). The banner is
  // load-bearing rather than decorative now: it is where the organisation ends
  // and the course begins, which is exactly where that role's authority stops.
  // -------------------------------------------------------------------------

  @Post("courses")
  @Roles(...COURSE_AUTHOR_ROLES)
  async createCourse(
    @Body() body: unknown,
    @CurrentPrincipal() principal: Principal,
    @TenantDb() db: Db,
  ) {
    const input = parse(courseCreateSchema, body, "course");
    await this.service(db).createCourse(input, context(principal));
    return this.service(db).getStructure(input.slug);
  }

  /**
   * Delete a course (P12-04).
   *
   * Returns 204 rather than a refreshed list: the course list lives on the
   * admin controller, and having this one reach across to rebuild it would tie
   * two modules together for the sake of saving the console one request.
   */
  @Delete("courses/:slug")
  @Roles(...COURSE_AUTHOR_ROLES)
  @HttpCode(204)
  async deleteCourse(
    @Param("slug") slug: string,
    @CurrentPrincipal() principal: Principal,
    @TenantDb() db: Db,
  ): Promise<void> {
    await this.service(db).deleteCourse(slug, context(principal));
  }

  @Get("courses/:slug/structure")
  @Roles("department_admin", ...COURSE_AUTHOR_ROLES)
  async getStructure(@Param("slug") slug: string, @TenantDb() db: Db) {
    return this.service(db).getStructure(slug);
  }

  @Post("courses/:slug/modules")
  @Roles(...COURSE_AUTHOR_ROLES)
  async createModule(
    @Param("slug") slug: string,
    @Body() body: unknown,
    @CurrentPrincipal() principal: Principal,
    @TenantDb() db: Db,
  ) {
    return this.service(db).createModule(
      slug,
      parse(moduleWriteSchema, body, "module"),
      context(principal),
    );
  }

  @Patch("modules/:id")
  @Roles(...COURSE_AUTHOR_ROLES)
  async updateModule(
    @Param("id") id: string,
    @Body() body: unknown,
    @CurrentPrincipal() principal: Principal,
    @TenantDb() db: Db,
  ) {
    return this.service(db).updateModule(
      id,
      parse(moduleWriteSchema, body, "module"),
      context(principal),
    );
  }

  @Delete("modules/:id")
  @Roles(...COURSE_AUTHOR_ROLES)
  async deleteModule(
    @Param("id") id: string,
    @CurrentPrincipal() principal: Principal,
    @TenantDb() db: Db,
  ) {
    return this.service(db).deleteModule(id, context(principal));
  }

  @Post("modules/:id/chapters")
  @Roles(...COURSE_AUTHOR_ROLES)
  async createChapter(
    @Param("id") id: string,
    @Body() body: unknown,
    @CurrentPrincipal() principal: Principal,
    @TenantDb() db: Db,
  ) {
    return this.service(db).createChapter(
      id,
      parse(chapterWriteSchema, body, "chapter"),
      context(principal),
    );
  }

  @Patch("chapters/:id")
  @Roles(...COURSE_AUTHOR_ROLES)
  async updateChapter(
    @Param("id") id: string,
    @Body() body: unknown,
    @CurrentPrincipal() principal: Principal,
    @TenantDb() db: Db,
  ) {
    return this.service(db).updateChapter(
      id,
      parse(chapterWriteSchema, body, "chapter"),
      context(principal),
    );
  }

  @Delete("chapters/:id")
  @Roles(...COURSE_AUTHOR_ROLES)
  async deleteChapter(
    @Param("id") id: string,
    @CurrentPrincipal() principal: Principal,
    @TenantDb() db: Db,
  ) {
    return this.service(db).deleteChapter(id, context(principal));
  }

  @Post("chapters/:id/contents")
  @Roles(...COURSE_AUTHOR_ROLES)
  async createContent(
    @Param("id") id: string,
    @Body() body: unknown,
    @CurrentPrincipal() principal: Principal,
    @TenantDb() db: Db,
  ) {
    return this.service(db).createContent(
      id,
      parse(contentWriteSchema, body, "content"),
      context(principal),
    );
  }

  @Patch("contents/:id")
  @Roles(...COURSE_AUTHOR_ROLES)
  async updateContent(
    @Param("id") id: string,
    @Body() body: unknown,
    @CurrentPrincipal() principal: Principal,
    @TenantDb() db: Db,
  ) {
    return this.service(db).updateContent(
      id,
      parse(contentWriteSchema, body, "content"),
      context(principal),
    );
  }

  @Delete("contents/:id")
  @Roles(...COURSE_AUTHOR_ROLES)
  async deleteContent(
    @Param("id") id: string,
    @CurrentPrincipal() principal: Principal,
    @TenantDb() db: Db,
  ) {
    return this.service(db).deleteContent(id, context(principal));
  }

  /**
   * The whole tree's ordering, atomically.
   *
   * One request rather than per-list ones because a chapter dragged between
   * modules changes both, and applying that as two calls leaves a window in
   * which it belongs to neither. Every level is validated as a permutation
   * before anything is written, so a wrong request changes nothing.
   */
  @Put("courses/:slug/structure/order")
  @Roles(...COURSE_AUTHOR_ROLES)
  async reorder(
    @Param("slug") slug: string,
    @Body() body: unknown,
    @CurrentPrincipal() principal: Principal,
    @TenantDb() db: Db,
  ) {
    return this.service(db).reorder(
      slug,
      parse(structureOrderSchema, body, "order"),
      context(principal),
    );
  }

  @Put("courses/:slug/experts")
  @Roles(...COURSE_AUTHOR_ROLES)
  async replaceExperts(
    @Param("slug") slug: string,
    @Body() body: unknown,
    @CurrentPrincipal() principal: Principal,
    @TenantDb() db: Db,
  ) {
    return this.service(db).replaceExperts(
      slug,
      parse(expertsWriteSchema, body, "experts"),
      context(principal),
    );
  }

  // -------------------------------------------------------------------------
  // Assessment (P9-05) — human review gate
  // -------------------------------------------------------------------------

  /**
   * The quiz **with its answer key**.
   *
   * The only route in the platform that returns `isCorrect`. It is reachable
   * only by an author role, and the learner-facing `Quiz` type has no field
   * capable of carrying the flag — which is what makes leaking it a compile
   * error rather than something a reviewer has to notice (P4-01).
   */
  @Get("contents/:id/quiz")
  @Roles(...COURSE_AUTHOR_ROLES)
  async getQuiz(@Param("id") id: string, @TenantDb() db: Db) {
    return this.service(db).getQuiz(id);
  }

  @Put("contents/:id/quiz")
  @RateLimit("adminUpload")
  @Roles(...COURSE_AUTHOR_ROLES)
  async setQuiz(
    @Param("id") id: string,
    @Body() body: unknown,
    @CurrentPrincipal() principal: Principal,
    @TenantDb() db: Db,
  ) {
    return this.service(db).setQuiz(
      id,
      parse(quizWriteSchema, body, "quiz"),
      context(principal),
    );
  }

  @Get("courses/:slug/evaluation")
  @Roles(...COURSE_AUTHOR_ROLES)
  async getEvaluation(@Param("slug") slug: string, @TenantDb() db: Db) {
    return this.service(db).getEvaluation(slug);
  }

  @Put("courses/:slug/evaluation")
  @RateLimit("adminUpload")
  @Roles(...COURSE_AUTHOR_ROLES)
  async setEvaluation(
    @Param("slug") slug: string,
    @Body() body: unknown,
    @CurrentPrincipal() principal: Principal,
    @TenantDb() db: Db,
  ) {
    return this.service(db).setEvaluation(
      slug,
      parse(evaluationWriteSchema, body, "evaluation"),
      context(principal),
    );
  }

  private service(db: Db): AuthoringService {
    return AuthoringService.fromDb(
      db,
      createSecretCipher(this.config.NODE_ENV, this.config.SECRETS_KMS_KEY),
    );
  }
}

function context(principal: Principal) {
  return {
    customerId: principal.customerId,
    userId: principal.userId,
    identity: principal.identity,
  };
}

/**
 * Parse, or refuse with the field paths.
 *
 * Paths, never values: one of the fields on a project is an SMTP credential,
 * and an error message that echoed a rejected value would put it in a log.
 */
function parse<T>(schema: ZodType<T>, body: unknown, what: string): T {
  const parsed = schema.safeParse(body);
  if (parsed.success) return parsed.data;

  const fields = parsed.error.issues.map((issue) => issue.path.join(".")).join(", ");
  throw new AppError(
    "validation",
    `invalid ${what}: ${fields}`,
    "Die Eingaben sind nicht gültig. Bitte prüfen Sie die markierten Felder.",
  );
}
