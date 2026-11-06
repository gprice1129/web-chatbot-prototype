import { describe, it } from "node:test";
import * as assert from "node:assert/strict";

import {
  DocumentAuthor,
  SectionStatus,
  DocumentWriteError,
  BODY_SECTION,
  write_section,
  type Document,
  type DocumentWrite,
} from "#common/document.js";

const NOW = "2026-11-06T00:00:00.000Z";
const LATER = "2026-11-06T00:05:00.000Z";

// A document being built from a template: both parties may write it.
function built(): Document {
  return {
    template_id: "irb-protocol",
    writable_by: [DocumentAuthor.USER, DocumentAuthor.ASSISTANT],
    revision: 0,
    sections: {},
  };
}

// An uploaded file: its text is the body, and nobody writes it again.
function uploaded(): Document {
  return {
    template_id: null,
    writable_by: [],
    revision: 0,
    sections: {
      [BODY_SECTION]: {
        text: "The proposal as uploaded.",
        status: SectionStatus.COMPLETE,
        written_by: DocumentAuthor.USER,
        written_at: NOW,
      },
    },
  };
}

function write_of(patch: Partial<DocumentWrite> = {}): DocumentWrite {
  return {
    section_id: "aims",
    text: "1. Measure readmission.",
    status: SectionStatus.DRAFT,
    author: DocumentAuthor.ASSISTANT,
    revision: 0,
    ...patch,
  };
}

describe("write_section", () => {
  it("writes a section as its author gave it and counts the write", () => {
    const written = write_section(built(), write_of(), NOW);
    assert.deepEqual(written, {
      ok: true,
      value: {
        template_id: "irb-protocol",
        writable_by: [DocumentAuthor.USER, DocumentAuthor.ASSISTANT],
        revision: 1,
        sections: {
          aims: {
            text: "1. Measure readmission.",
            status: SectionStatus.DRAFT,
            written_by: DocumentAuthor.ASSISTANT,
            written_at: NOW,
          },
        },
      },
    });
  });

  it("replaces one section and leaves the others and the original alone", () => {
    const before = built();
    const first = write_section(before, write_of(), NOW);
    assert.ok(first.ok);
    const second = write_section(first.value, write_of({
      section_id: "background",
      text: "Why it matters.",
      author: DocumentAuthor.USER,
      revision: 1,
    }), LATER);
    assert.ok(second.ok);
    const third = write_section(second.value, write_of({
      text: "1. Measure readmission within 30 days.",
      status: SectionStatus.NEEDS_REVIEW,
      author: DocumentAuthor.USER,
      revision: 2,
    }), LATER);
    assert.ok(third.ok);

    assert.equal(third.value.revision, 3);
    assert.deepEqual(third.value.sections["aims"], {
      text: "1. Measure readmission within 30 days.",
      status: SectionStatus.NEEDS_REVIEW,
      written_by: DocumentAuthor.USER,
      written_at: LATER,
    });
    assert.equal(third.value.sections["background"], second.value.sections["background"]);
    assert.deepEqual(before.sections, {});
  });

  it("erases a section written blank, and counts that too", () => {
    const first = write_section(built(), write_of(), NOW);
    assert.ok(first.ok);
    const erased = write_section(first.value, write_of({ text: "  \n", revision: 1 }), LATER);
    assert.ok(erased.ok);
    assert.deepEqual(erased.value.sections, {});
    assert.equal(erased.value.revision, 2);
  });

  it("refuses an author the document is not writable by", () => {
    const by_assistant = write_section(
      uploaded(), write_of({ section_id: BODY_SECTION }), NOW);
    assert.deepEqual(by_assistant, { ok: false, error: DocumentWriteError.NOT_PERMITTED });
    const by_user = write_section(
      uploaded(), write_of({ section_id: BODY_SECTION, author: DocumentAuthor.USER }), NOW);
    assert.deepEqual(by_user, { ok: false, error: DocumentWriteError.NOT_PERMITTED });
  });

  it("refuses a write made against a revision that has moved on, whoever makes it", () => {
    // Both read revision 0. The user's write lands first.
    const by_user = write_section(
      built(), write_of({ author: DocumentAuthor.USER, text: "Mine." }), NOW);
    assert.ok(by_user.ok);
    const by_assistant = write_section(by_user.value, write_of(), LATER);
    assert.deepEqual(by_assistant, { ok: false, error: DocumentWriteError.STALE });

    const ahead = write_section(built(), write_of({ revision: 4 }), NOW);
    assert.deepEqual(ahead, { ok: false, error: DocumentWriteError.STALE });
  });

  it("admits only the body when the document follows no template", () => {
    const plain: Document = { ...uploaded(), writable_by: [DocumentAuthor.USER] };
    const elsewhere = write_section(plain, write_of({ author: DocumentAuthor.USER }), NOW);
    assert.deepEqual(elsewhere, { ok: false, error: DocumentWriteError.NO_SUCH_SECTION });

    const body = write_section(plain, write_of({
      section_id: BODY_SECTION, text: "Replaced.", author: DocumentAuthor.USER,
    }), LATER);
    assert.ok(body.ok);
    assert.equal(body.value.sections[BODY_SECTION].text, "Replaced.");
  });
});
