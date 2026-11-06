export {
  DocumentAuthor,
  SectionStatus,
  DocumentWriteError,
  BODY_SECTION,
  parse_document_template,
  empty_document,
  plain_document,
  write_section,
}
export type {
  Document,
  DocumentSection,
  DocumentTemplate,
  TemplateSection,
  DocumentWrite,
}

import { map_error, type Result } from "#common/result.js";
import { is_boolean, is_object, is_string } from "#common/type-checker.js";

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
 * Idea: One section a template gives its documents.
 *
 * TODO:[documents] template files also carry `model_guidance`, which tells
 * the assistant what belongs in a section, and `user_placeholder`, which a
 * person sees until it is written. Neither is part of a document's shape.
 * Where they should live is still to be discussed.
 */
interface TemplateSection {
  id: string;
  title: string;
  required: boolean;
}

/*
 * Idea: The sections one kind of document has, in order.
 */
interface DocumentTemplate {
  id: string;
  title: string;
  sections: TemplateSection[];
}

const _TEMPLATE_ID = /^[a-z0-9-]+$/;
const _SECTION_ID = /^[a-z][a-z0-9_]*$/;

/*
 * Idea: A template as authored, or the first thing wrong with it.
 *
 * (unknown) => Result<DocumentTemplate>
 * Pure
 * Public
 */
function parse_document_template(value: unknown): Result<DocumentTemplate> {
  if (!is_object(value)) return { ok: false, error: "template must be an object" };
  const { id, title, sections } = value;
  if (!is_string(id) || !_TEMPLATE_ID.test(id)) {
    return { ok: false, error: "template id must be lowercase letters, digits and dashes" };
  }
  if (!_has_text(title)) {
    return { ok: false, error: `template ${id}: title must be a non-empty string` };
  }
  if (!Array.isArray(sections) || 0 === sections.length) {
    return { ok: false, error: `template ${id}: sections must be a non-empty array` };
  }
  const parsed: TemplateSection[] = [];
  for (const [index, raw] of sections.entries()) {
    const section = map_error(
      _parse_template_section(raw), (error) => `template ${id}: section ${index}: ${error}`);
    if (!section.ok) return section;
    if (parsed.some((seen) => seen.id === section.value.id)) {
      return { ok: false, error: `template ${id}: duplicate section id '${section.value.id}'` };
    }
    parsed.push(section.value);
  }
  return { ok: true, value: { id, title, sections: parsed } };
}

/*
 * Idea: One section as authored, or the first thing wrong with it.
 *
 * (unknown) => Result<TemplateSection>
 * An id that every object already answers to is refused, because sections
 * are looked up by id. Fields the shared template does not define are left
 * behind.
 * Pure
 * Private
 */
function _parse_template_section(raw: unknown): Result<TemplateSection> {
  if (!is_object(raw)) return { ok: false, error: "must be an object" };
  const { id, title, required } = raw;
  if (!is_string(id) || !_SECTION_ID.test(id)) {
    return {
      ok: false,
      error: "id must be a lowercase letter, then lowercase letters, digits and underscores",
    };
  }
  if (id in Object.prototype) return { ok: false, error: `id '${id}' is reserved` };
  if (!_has_text(title)) {
    return { ok: false, error: `${id}: title must be a non-empty string` };
  }
  if (!is_boolean(required)) {
    return { ok: false, error: `${id}: required must be a boolean` };
  }
  return { ok: true, value: { id, title, required } };
}

/*
 * Idea: Whether a value is text that says something.
 *
 * (unknown) => boolean
 * Pure
 * Private
 */
function _has_text(value: unknown): value is string {
  return is_string(value) && "" !== value.trim();
}

/*
 * Idea: A document that follows a template, before anyone has written in it.
 *
 * (DocumentTemplate, DocumentAuthor[]) => Document
 * Pure
 * Public
 */
function empty_document(template: DocumentTemplate, writable_by: DocumentAuthor[]): Document {
  return { template_id: template.id, writable_by, revision: 0, sections: {} };
}

/*
 * Idea: Text that already exists, held as a document nobody writes again.
 *
 * (string, DocumentAuthor, string) => Document
 * Blank text gives a document with no body.
 * Pure
 * Public
 */
function plain_document(text: string, author: DocumentAuthor, now: string): Document {
  const document: Document = { template_id: null, writable_by: [], revision: 0, sections: {} };
  if (!_has_text(text)) return document;
  const body: DocumentSection = {
    text,
    status: SectionStatus.COMPLETE,
    written_by: author,
    written_at: now,
  };
  return { ...document, sections: { [BODY_SECTION]: body } };
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
 * (DocumentTemplate | null, Document, DocumentWrite, string)
 *   => Result<Document, DocumentWriteError>
 * `template` is the one the document follows, null when it follows none.
 * Handing over any other throws: that mistake is the caller's, not the
 * author's. Every accepted write is counted, an erasure included.
 * Pure
 * Public
 */
function write_section(
    template: DocumentTemplate | null,
    document: Document,
    write: DocumentWrite,
    now: string): Result<Document, DocumentWriteError> {
  const section_ids = _section_ids(template, document);
  if (!document.writable_by.includes(write.author)) {
    return { ok: false, error: DocumentWriteError.NOT_PERMITTED };
  }
  if (!section_ids.includes(write.section_id)) {
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
 * Idea: The sections a document may have: its template's, or only the body.
 *
 * (DocumentTemplate | null, Document) => string[]
 * Throws when `template` is not the one the document follows.
 * Pure
 * Private
 */
function _section_ids(template: DocumentTemplate | null, document: Document): string[] {
  const given = template?.id ?? null;
  if (given !== document.template_id) {
    throw new Error(
      `document follows template '${document.template_id}', but was given '${given}'`);
  }
  if (null === template) return [BODY_SECTION];
  return template.sections.map((section) => section.id);
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
