/**
 * The MEDICE course content, against what MEDICE actually specified (P126-01).
 *
 * ## Why a seed has tests at all
 *
 * Because this one carries an **answer key**. Every other value here is content
 * that renders wrong and gets noticed; the eleven `correct` indices decide
 * whether a physician passes a CME exam, and a wrong one is a compliance
 * incident that looks exactly like a correct one from every screen in the
 * product.
 *
 * The key was read out of `Lernerfolgskontrolle.docx`, where the correct option
 * of each question is marked only by **bold**. Eleven questions, eleven bold
 * options, one per question — unambiguous, and still an inference from
 * formatting rather than a stated key. So the properties that must hold are
 * asserted here rather than assumed, and the key itself is written out in the
 * seed where a person can read it back against the document.
 *
 * These are structural checks. They cannot tell a right answer from a wrong one
 * — nothing here can, which is exactly why the key needs a human to confirm it
 * (§7). What they can do is refuse a key that is malformed in any of the ways a
 * transcription error actually produces.
 */

import { describe, expect, it } from "vitest";
import { MODULES, QUESTIONS } from "./medice-adhs.js";

describe("the Lernerfolgskontrolle", () => {
  it("has the eleven questions MEDICE specified", () => {
    expect(QUESTIONS).toHaveLength(11);
  });

  it("offers five options on every question", () => {
    // a) … e) throughout the source document. A question with four would score
    // differently from the one the client wrote.
    for (const question of QUESTIONS) {
      expect(question.options, question.prompt).toHaveLength(5);
    }
  });

  it("marks exactly one correct option per question, and it exists", () => {
    /*
     * The two failure modes a transcription actually produces: an index left at
     * its default, and an index off the end of a shortened option list. Both
     * would make the exam quietly unpassable or trivially passable.
     */
    for (const question of QUESTIONS) {
      expect(question.correct, question.prompt).toBeGreaterThanOrEqual(0);
      expect(question.correct, question.prompt).toBeLessThan(question.options.length);
    }
  });

  it("does not put every correct answer in the same position", () => {
    /*
     * The placeholder bank this replaced had `option === 0` for all eleven, so a
     * physician who always picked (a) scored 100 %. That is the shape this case
     * exists to refuse — it would have caught the old fixture, and it catches a
     * paste that lost its indices.
     */
    const positions = new Set(QUESTIONS.map((question) => question.correct));
    expect(positions.size).toBeGreaterThan(1);
  });

  it("has no blank prompt or option", () => {
    for (const question of QUESTIONS) {
      expect(question.prompt.trim(), "empty prompt").not.toBe("");
      for (const option of question.options) {
        expect(option.trim(), `empty option in: ${question.prompt}`).not.toBe("");
      }
    }
  });
});

describe("the course structure", () => {
  it("is three modules of two chapters, as the content sheet specifies", () => {
    expect(MODULES).toHaveLength(3);
    for (const module of MODULES) {
      expect(module.chapters, module.title).toHaveLength(2);
    }
  });

  it("gives every chapter its own video and its description text", () => {
    for (const module of MODULES) {
      for (const chapter of module.chapters) {
        expect(chapter.videoTitle.trim(), chapter.title).not.toBe("");
        expect(chapter.body.trim(), chapter.title).not.toBe("");
      }
    }
  });

  it("places the Lernerfolgskontrolle in the last module, and only there", () => {
    /*
     * MEDICE's Kapitel 3.3. A second exam elsewhere would be a second gate on a
     * course accredited for one, and an exam in module 1 would gate the course
     * on material a physician has not reached.
     */
    const withExam = MODULES.filter((module) => module.examChapterTitle !== undefined);
    expect(withExam).toHaveLength(1);
    expect(withExam[0]).toBe(MODULES[MODULES.length - 1]);
  });

  it("keeps the accredited course title out of the module titles", () => {
    // The content sheet heads the Fortbildung "Basisseminar 2026 – ADHS
    // Akademie adult"; the Bescheid and the certificate say "ADHS Akademie
    // adult". Nothing here may reintroduce the longer working label.
    for (const module of MODULES) {
      expect(module.title).not.toContain("Basisseminar");
    }
  });
});
