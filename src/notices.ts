/**
 * System notices are returned as neutral CODES and translated by the user interface
 * (interface language), never hard-coded in a content language on the server.
 */
export const NOTICE_CODES = [
  "demo_content",
  "demo_level_fixed",
  "demo_language_fixed",
  "content_unreviewed",
  "exercises_removed",
  "citations_removed",
  "quiz_questions_removed",
  "evidence_removed",
  "related_reading_only",
  "wikipedia_only",
] as const;
export type NoticeCode = (typeof NOTICE_CODES)[number];
