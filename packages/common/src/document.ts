export {
  DocumentAuthor,
  SectionStatus,
  BODY_SECTION,
}
export type {
  Document,
  DocumentSection,
}

/*
 * Main Concept
 * -----------------------------------------------------------------------------
 * This file defines a document: text held in named sections, which a user and
 * an assistant may each be allowed to write. A template fixes the sections a
 * document has. A document that follows no template has one section, its body.
 */

/*
 * Idea: A party that can write a document.
 */
enum DocumentAuthor {
  USER = "user",
  ASSISTANT = "assistant",
}

/*
 * Idea: Where a section stands, as its author judged it.
 */
enum SectionStatus {
  INCOMPLETE = "incomplete",
  DRAFT = "draft",
  NEEDS_REVIEW = "needs_review",
  COMPLETE = "complete",
}

/*
 * Idea: The one section of a document that follows no template.
 */
const BODY_SECTION = "body";

/*
 * Idea: One part of a document, as it was last written.
 *
 * `written_at` is an ISO 8601 time.
 */
interface DocumentSection {
  text: string;
  status: SectionStatus;
  written_by: DocumentAuthor;
  written_at: string;
}

/*
 * Idea: What has been written so far, and who may write more.
 *
 * `sections` is keyed by section id and holds only the sections that have
 * been written. `revision` counts the writes made.
 */
interface Document {
  template_id: string | null;
  writable_by: DocumentAuthor[];
  revision: number;
  sections: Record<string, DocumentSection>;
}
