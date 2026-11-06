export {
  DocumentAuthor,
  SectionStatus,
  DocumentWriteError,
  BODY_SECTION,
  write_section,
}
export type {
  Document,
  DocumentSection,
  DocumentWrite,
}

import type { Result } from "#common/result.js";

/*
 * Main Concept
 * -----------------------------------------------------------------------------
 * This file defines a document: text held in named sections, which a user and
 * an assistant may each be allowed to write. A template fixes the sections a
 * document has. A document that follows no template has one section, its body.
 *
 * A document changes one section at a time. Each change names the revision
 * its author read, so no author overwrites what it has not seen.
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

/*
 * Idea: One author's change to one section.
 *
 * `revision` is the document's revision as the author read it. Blank `text`
 * erases the section.
 */
interface DocumentWrite {
  section_id: string;
  text: string;
  status: SectionStatus;
  author: DocumentAuthor;
  revision: number;
}

/*
 * Idea: Why a write was refused.
 */
enum DocumentWriteError {
  NOT_PERMITTED = "not_permitted",
  NO_SUCH_SECTION = "no_such_section",
  STALE = "stale",
}

/*
 * Idea: The document after a write, or why the write was refused.
 *
 * (Document, DocumentWrite, string) => Result<Document, DocumentWriteError>
 * Only a document with no template has its section checked here. Every
 * accepted write is counted, an erasure included.
 * Pure
 * Public
 */
function write_section(
    document: Document,
    write: DocumentWrite,
    now: string): Result<Document, DocumentWriteError> {
  if (!document.writable_by.includes(write.author)) {
    return { ok: false, error: DocumentWriteError.NOT_PERMITTED };
  }
  if (null === document.template_id && BODY_SECTION !== write.section_id) {
    return { ok: false, error: DocumentWriteError.NO_SUCH_SECTION };
  }
  if (write.revision !== document.revision) {
    return { ok: false, error: DocumentWriteError.STALE };
  }
  const written = {
    ...document,
    revision: document.revision + 1,
    sections: _sections_after(document.sections, write, now),
  };
  return { ok: true, value: written };
}

/*
 * Idea: The sections once a write has replaced or erased its own.
 *
 * (Record<string, DocumentSection>, DocumentWrite, string)
 *   => Record<string, DocumentSection>
 * Pure
 * Private
 */
function _sections_after(
    sections: Record<string, DocumentSection>,
    write: DocumentWrite,
    now: string): Record<string, DocumentSection> {
  const { [write.section_id]: _replaced, ...kept } = sections;
  if ("" === write.text.trim()) return kept;
  const section: DocumentSection = {
    text: write.text,
    status: write.status,
    written_by: write.author,
    written_at: now,
  };
  return { ...kept, [write.section_id]: section };
}
