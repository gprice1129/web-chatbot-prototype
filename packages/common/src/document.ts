export {
  DocumentAuthor,
  SectionStatus,
  DocumentWriteError,
  BODY_SECTION,
  parse_document_template,
  load_document_templates,
  empty_document,
  readonly_document,
  parse_document_sections,
  write_section,
  document_standing,
}
export type {
  Document,
  DocumentSection,
  DocumentTemplate,
  TemplateSection,
  TemplateMetadata,
  TemplateGuidance,
  DocumentWrite,
  DocumentStanding,
}

import * as path from "node:path";

import { find_files, read_text } from "#common/file.js";
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
 *
 * A document is kept as a head pointer over immutable versions. A version is
 * a file holding the document's sections as JSON, and nothing else: what the
 * document follows, who may write it and its revision are kept once, with the
 * pointer.
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
 * Idea: What a section is called, and whether a document must have it.
 */
interface TemplateMetadata {
  id: string;
  title: string;
  required: boolean;
}

/*
 * Idea: What belongs in a section, in words written for its reader.
 *
 * `model` is written for the model.
 *
 * TODO:[documents] template files also carry `user_placeholder`, which a
 * person sees until a section is written. Nothing reads it yet; it belongs
 * here.
 */
interface TemplateGuidance {
  model: string;
}

/*
 * Idea: One section a template gives its documents: what it is, and what
 * belongs in it.
 */
interface TemplateSection {
  metadata: TemplateMetadata;
  guidance: TemplateGuidance;
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
 * Idea: A template file as authored, or the first thing wrong with it.
 *
 * (unknown) => Result<DocumentTemplate>
 * `value` is the file's JSON, decoded.
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
    const section_id = section.value.metadata.id;
    if (parsed.some((seen) => seen.metadata.id === section_id)) {
      return { ok: false, error: `template ${id}: duplicate section id '${section_id}'` };
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
 * are looked up by id. Fields the template does not define are left behind.
 * Pure
 * Private
 */
function _parse_template_section(raw: unknown): Result<TemplateSection> {
  if (!is_object(raw)) return { ok: false, error: "must be an object" };
  const { id, title, required, model_guidance } = raw;
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
  if (!_has_text(model_guidance)) {
    return { ok: false, error: `${id}: model_guidance must be a non-empty string` };
  }
  const metadata: TemplateMetadata = { id, title, required };
  return { ok: true, value: { metadata, guidance: { model: model_guidance } } };
}

/*
 * Idea: The templates under a directory, keyed by id, or the first thing
 * wrong with any of them.
 *
 * (string) => Result<Record<string, DocumentTemplate>>
 * A template is one JSON file, named for its id, at the top of `root`. Every
 * error names the file.
 * Side Effect: reads the filesystem
 * Public
 */
async function load_document_templates(
    root: string): Promise<Result<Record<string, DocumentTemplate>>> {
  const found = map_error(
    await find_files(root, { extension: ".json" }), (error) => `${root}: ${error}`);
  if (!found.ok) return found;
  const templates: Record<string, DocumentTemplate> = {};
  for (const file of found.value.files) {
    const read = map_error(await _read_template_file(file), (error) => `${file}: ${error}`);
    if (!read.ok) return read;
    templates[read.value.id] = read.value;
  }
  return { ok: true, value: templates };
}

/*
 * Idea: One template file read whole, or the first thing wrong with it.
 *
 * (string) => Result<DocumentTemplate>
 * Side Effect: reads the filesystem
 * Private
 */
async function _read_template_file(file: string): Promise<Result<DocumentTemplate>> {
  const text = await read_text(file);
  if (!text.ok) return text;
  let authored: unknown;
  try {
    authored = JSON.parse(text.value);
  } catch {
    return { ok: false, error: "not valid JSON" };
  }
  const parsed = parse_document_template(authored);
  if (!parsed.ok) return parsed;
  const { id } = parsed.value;
  if (path.basename(file, ".json") !== id) {
    return { ok: false, error: `template id '${id}' must match the file name` };
  }
  return parsed;
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
function readonly_document(text: string, author: DocumentAuthor, now: string): Document {
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
 * Idea: A document's sections read back from a version file, or the first
 * thing wrong with them.
 *
 * (string | null, unknown) => Result<Record<string, DocumentSection>>
 * `value` is the file's JSON, decoded. `template_id` is the document's: with
 * none, only a body is admitted. A document that follows a template is not
 * held to that template here; `document_standing` is.
 * Pure
 * Public
 */
function parse_document_sections(
    template_id: string | null, value: unknown): Result<Record<string, DocumentSection>> {
  if (!is_object(value)) return { ok: false, error: "sections must be an object" };
  const parsed: Record<string, DocumentSection> = {};
  for (const [id, raw] of Object.entries(value)) {
    if (null === template_id && BODY_SECTION !== id) {
      return { ok: false, error: `section ${id}: only a body without a template` };
    }
    if (!_SECTION_ID.test(id) || id in Object.prototype) {
      return { ok: false, error: `section ${id}: not a section id` };
    }
    const section = map_error(_parse_section(raw), (error) => `section ${id}: ${error}`);
    if (!section.ok) return section;
    parsed[id] = section.value;
  }
  return { ok: true, value: parsed };
}

/*
 * Idea: One section read back, or the first thing wrong with it.
 *
 * (unknown) => Result<DocumentSection>
 * Pure
 * Private
 */
function _parse_section(raw: unknown): Result<DocumentSection> {
  if (!is_object(raw)) return { ok: false, error: "must be an object" };
  const { text, status, written_by, written_at } = raw;
  if (!_has_text(text)) return { ok: false, error: "text must be a non-empty string" };
  if (!_is_status(status)) return { ok: false, error: "unknown status" };
  if (!_is_author(written_by)) return { ok: false, error: "unknown written_by" };
  if (!_is_iso_time(written_at)) {
    return { ok: false, error: "written_at must be an ISO 8601 time" };
  }
  return { ok: true, value: { text, status, written_by, written_at } };
}

/*
 * (unknown) => boolean
 * Pure
 * Private
 */
function _is_author(value: unknown): value is DocumentAuthor {
  return (Object.values(DocumentAuthor) as unknown[]).includes(value);
}

/*
 * (unknown) => boolean
 * Pure
 * Private
 */
function _is_status(value: unknown): value is SectionStatus {
  return (Object.values(SectionStatus) as unknown[]).includes(value);
}

/*
 * Idea: Whether a value is a time exactly as this application writes one.
 *
 * (unknown) => boolean
 * Pure
 * Private
 */
function _is_iso_time(value: unknown): value is string {
  if (!is_string(value)) return false;
  const time = new Date(value);
  if (Number.isNaN(time.getTime())) return false;
  return time.toISOString() === value;
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
 * Idea: How far a document is from what its template asks of it.
 *
 * `outstanding` are the required sections not yet complete, in template
 * order. `leftover` are the written sections the template does not name.
 */
interface DocumentStanding {
  outstanding: string[];
  leftover: string[];
}

/*
 * Idea: A document measured against the template it follows.
 *
 * (DocumentTemplate | null, Document) => DocumentStanding
 * Throws when `template` is not the one the document follows.
 * Pure
 * Public
 */
function document_standing(
    template: DocumentTemplate | null, document: Document): DocumentStanding {
  const section_ids = _section_ids(template, document);
  const outstanding = _required_ids(template).filter((id) => !_is_complete(document, id));
  const leftover = Object.keys(document.sections).filter((id) => !section_ids.includes(id));
  return { outstanding, leftover };
}

/*
 * (DocumentTemplate | null) => string[]
 * Pure
 * Private
 */
function _required_ids(template: DocumentTemplate | null): string[] {
  if (null === template) return [];
  return template.sections
    .filter((section) => section.metadata.required)
    .map((section) => section.metadata.id);
}

/*
 * (Document, string) => boolean
 * Pure
 * Private
 */
function _is_complete(document: Document, section_id: string): boolean {
  if (!Object.hasOwn(document.sections, section_id)) return false;
  return SectionStatus.COMPLETE === document.sections[section_id].status;
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
  return template.sections.map((section) => section.metadata.id);
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
