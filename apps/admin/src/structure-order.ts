/**
 * Rearranging the authoring tree, as pure functions (P9-04).
 *
 * Separate from the component for one reason: this is the code that decides
 * what a reorder request contains, and a wrong answer here moves a chapter a
 * learner is part-way through. Free functions over plain data can be checked by
 * reading them and tested without rendering anything.
 *
 * Nothing here decides a compliance outcome — `validateReorder` in `@ds/domain`
 * does that, on the server, and refuses anything that is not a permutation. This
 * module only builds the request; if it built a wrong one, the server would
 * reject it rather than obey it.
 */

import type {
  AuthoringChapter,
  AuthoringContent,
  AuthoringModule,
  StructureOrder,
} from "@ds/sdk";

/**
 * The whole tree's arrangement, as ids.
 *
 * Position in each array *is* the new ordinal — no `ordinal` field is sent
 * anywhere. A client that could set ordinals directly could set two siblings to
 * the same one, and `UNIQUE (parent_id, ordinal)` would turn an authoring
 * mistake into a 500.
 */
export function toOrder(modules: readonly AuthoringModule[]): StructureOrder {
  return {
    modules: modules.map((module) => ({
      id: module.id,
      chapters: module.chapters.map((chapter) => ({
        id: chapter.id,
        contents: chapter.contents.map((content) => content.id),
      })),
    })),
  };
}

/** Replace one module's chapter list, leaving every other module alone. */
export function withChapters(
  modules: readonly AuthoringModule[],
  moduleId: string,
  chapters: readonly AuthoringChapter[],
): readonly AuthoringModule[] {
  return modules.map((module) =>
    module.id === moduleId ? { ...module, chapters: [...chapters] } : module,
  );
}

/**
 * Replace one chapter's content list, wherever that chapter sits.
 *
 * Searches every module rather than taking the module id, because the caller —
 * a content row — knows its chapter and should not have to know its
 * grandparent to move a sibling up one place.
 */
export function withContents(
  modules: readonly AuthoringModule[],
  chapterId: string,
  contents: readonly AuthoringContent[],
): readonly AuthoringModule[] {
  return modules.map((module) => ({
    ...module,
    chapters: module.chapters.map((chapter) =>
      chapter.id === chapterId ? { ...chapter, contents: [...contents] } : chapter,
    ),
  }));
}

/**
 * Move a chapter to the end of another module.
 *
 * To the end rather than to a guessed position: the author's next action is to
 * place it with the up/down buttons, and dropping it somewhere in the middle of
 * an unrelated module would be a second thing they have to undo. A no-op if the
 * chapter is already there.
 */
export function moveChapter(
  modules: readonly AuthoringModule[],
  chapterId: string,
  toModuleId: string,
): readonly AuthoringModule[] {
  const chapter = modules
    .flatMap((module) => module.chapters)
    .find((candidate) => candidate.id === chapterId);
  if (chapter === undefined) return modules;

  return modules.map((module) => {
    if (module.id === toModuleId) {
      const without = module.chapters.filter((c) => c.id !== chapterId);
      return { ...module, chapters: [...without, chapter] };
    }
    return { ...module, chapters: module.chapters.filter((c) => c.id !== chapterId) };
  });
}

/** How many learner records sit anywhere under a module. */
export function recordsUnderModule(module: AuthoringModule): number {
  return module.chapters.reduce(
    (total, chapter) =>
      total + chapter.contents.reduce((sum, content) => sum + content.learnerRecords, 0),
    0,
  );
}
