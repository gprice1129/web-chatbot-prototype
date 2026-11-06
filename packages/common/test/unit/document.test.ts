import { describe, it } from "node:test";
import * as assert from "node:assert/strict";

import {
  DocumentAuthor,
  SectionStatus,
  DocumentWriteError,
  BODY_SECTION,
  parse_document_template,
  empty_document,
  plain_document,
  write_section,
  type Document,
  type DocumentTemplate,
  type DocumentWrite,
} from "#common/document.js";

const NOW = "2026-11-06T00:00:00.000Z";
const LATER = "2026-11-06T00:05:00.000Z";

const TEMPLATE: DocumentTemplate = {
  id: "irb-protocol",
  title: "IRB Protocol",
  sections: [
    { id: "background", title: "Background", required: true },
    { id: "aims", title: "Specific aims", required: false },
  ],
};

// TEMPLATE as a content file would hold it, with `patch` laid over it.
function authored(patch: object = {}): unknown {
  return { ...JSON.parse(JSON.stringify(TEMPLATE)), ...patch };
}

// TEMPLATE's first section as authored, with `patch` laid over it, alone.
function authored_section(patch: object): unknown {
  return authored({ sections: [{ ...TEMPLATE.sections[0], ...patch }] });
}

describe("parse_document_template", () => {
  it("reads a template as authored, sections in order", () => {
    assert.deepEqual(parse_document_template(authored()), { ok: true, value: TEMPLATE });
  });

  it("leaves behind what the shared template does not define", () => {
    const with_extras = authored_section({
      model_guidance: "Why the question matters.",
      user_placeholder: "Why this study matters.",
    });
    assert.deepEqual(parse_document_template(with_extras), {
      ok: true,
      value: { ...TEMPLATE, sections: [TEMPLATE.sections[0]] },
    });
  });

  it("names the first thing wrong with the template", () => {
    const refused = (value: unknown, error: string) => {
      assert.deepEqual(parse_document_template(value), { ok: false, error });
    };
    refused(null, "template must be an object");
    refused(authored({ id: "IRB Protocol" }),
      "template id must be lowercase letters, digits and dashes");
    refused(authored({ title: " " }), "template irb-protocol: title must be a non-empty string");
    refused(authored({ sections: [] }),
      "template irb-protocol: sections must be a non-empty array");
    refused(authored({ sections: [TEMPLATE.sections[0], TEMPLATE.sections[0]] }),
      "template irb-protocol: duplicate section id 'background'");
  });

  it("names the section and what is wrong with it", () => {
    const refused = (patch: object, error: string) => {
      assert.deepEqual(
        parse_document_template(authored_section(patch)),
        { ok: false, error: `template irb-protocol: section 0: ${error}` });
    };
    const bad_id = "id must be a lowercase letter, then lowercase letters, digits and underscores";
    refused({ id: "has-dash" }, bad_id);
    refused({ id: "__proto__" }, bad_id);
    refused({ id: "constructor" }, "id 'constructor' is reserved");
    refused({ title: "" }, "background: title must be a non-empty string");
    refused({ required: "yes" }, "background: required must be a boolean");
    assert.deepEqual(
      parse_document_template(authored({ sections: ["aims"] })),
      { ok: false, error: "template irb-protocol: section 0: must be an object" });
  });
});

// A document being built from TEMPLATE: both parties may write it.
function built(): Document {
  return empty_document(TEMPLATE, [DocumentAuthor.USER, DocumentAuthor.ASSISTANT]);
}

// An uploaded file: its text is the body, and nobody writes it again.
function uploaded(): Document {
  return plain_document("The proposal as uploaded.", DocumentAuthor.USER, NOW);
}

describe("empty_document", () => {
  it("follows its template, with nothing written and no writes counted", () => {
    assert.deepEqual(empty_document(TEMPLATE, [DocumentAuthor.ASSISTANT]), {
      template_id: "irb-protocol",
      writable_by: [DocumentAuthor.ASSISTANT],
      revision: 0,
      sections: {},
    });
  });
});

describe("plain_document", () => {
  it("holds the text as a finished body by its author, closed to everyone", () => {
    assert.deepEqual(uploaded(), {
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
    });
  });

  it("has no body when the text is blank", () => {
    assert.deepEqual(plain_document(" \n", DocumentAuthor.USER, NOW).sections, {});
  });
});

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
    const written = write_section(TEMPLATE, built(), write_of(), NOW);
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
    const first = write_section(TEMPLATE, before, write_of(), NOW);
    assert.ok(first.ok);
    const second = write_section(TEMPLATE, first.value, write_of({
      section_id: "background",
      text: "Why it matters.",
      author: DocumentAuthor.USER,
      revision: 1,
    }), LATER);
    assert.ok(second.ok);
    const third = write_section(TEMPLATE, second.value, write_of({
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
    const first = write_section(TEMPLATE, built(), write_of(), NOW);
    assert.ok(first.ok);
    const erased = write_section(
      TEMPLATE, first.value, write_of({ text: "  \n", revision: 1 }), LATER);
    assert.ok(erased.ok);
    assert.deepEqual(erased.value.sections, {});
    assert.equal(erased.value.revision, 2);
  });

  it("refuses an author the document is not writable by", () => {
    const by_assistant = write_section(
      null, uploaded(), write_of({ section_id: BODY_SECTION }), NOW);
    assert.deepEqual(by_assistant, { ok: false, error: DocumentWriteError.NOT_PERMITTED });
    const by_user = write_section(
      null, uploaded(), write_of({ section_id: BODY_SECTION, author: DocumentAuthor.USER }), NOW);
    assert.deepEqual(by_user, { ok: false, error: DocumentWriteError.NOT_PERMITTED });
  });

  it("refuses a write made against a revision that has moved on, whoever makes it", () => {
    // Both read revision 0. The user's write lands first.
    const by_user = write_section(
      TEMPLATE, built(), write_of({ author: DocumentAuthor.USER, text: "Mine." }), NOW);
    assert.ok(by_user.ok);
    const by_assistant = write_section(TEMPLATE, by_user.value, write_of(), LATER);
    assert.deepEqual(by_assistant, { ok: false, error: DocumentWriteError.STALE });

    const ahead = write_section(TEMPLATE, built(), write_of({ revision: 4 }), NOW);
    assert.deepEqual(ahead, { ok: false, error: DocumentWriteError.STALE });
  });

  it("admits only the sections its template names", () => {
    const unknown = write_section(TEMPLATE, built(), write_of({ section_id: "budget" }), NOW);
    assert.deepEqual(unknown, { ok: false, error: DocumentWriteError.NO_SUCH_SECTION });
    const body = write_section(TEMPLATE, built(), write_of({ section_id: BODY_SECTION }), NOW);
    assert.deepEqual(body, { ok: false, error: DocumentWriteError.NO_SUCH_SECTION });
  });

  it("admits only the body when the document follows no template", () => {
    const plain: Document = { ...uploaded(), writable_by: [DocumentAuthor.USER] };
    const elsewhere = write_section(null, plain, write_of({ author: DocumentAuthor.USER }), NOW);
    assert.deepEqual(elsewhere, { ok: false, error: DocumentWriteError.NO_SUCH_SECTION });

    const body = write_section(null, plain, write_of({
      section_id: BODY_SECTION, text: "Replaced.", author: DocumentAuthor.USER,
    }), LATER);
    assert.ok(body.ok);
    assert.equal(body.value.sections[BODY_SECTION].text, "Replaced.");
  });

  it("throws when handed a template the document does not follow", () => {
    const other: DocumentTemplate = { ...TEMPLATE, id: "budget-justification" };
    assert.throws(
      () => write_section(other, built(), write_of(), NOW),
      /follows template 'irb-protocol', but was given 'budget-justification'/);
    assert.throws(
      () => write_section(null, built(), write_of(), NOW),
      /follows template 'irb-protocol', but was given 'null'/);
    assert.throws(
      () => write_section(TEMPLATE, uploaded(), write_of(), NOW),
      /follows template 'null', but was given 'irb-protocol'/);
  });
});
