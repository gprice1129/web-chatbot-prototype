import { describe, it } from "node:test";
import * as assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";

import {
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
    {
      metadata: { id: "background", title: "Background", required: true },
      guidance: { model: "Why it matters." },
    },
    {
      metadata: { id: "aims", title: "Specific aims", required: false },
      guidance: { model: "Numbered aims." },
    },
    {
      metadata: { id: "design", title: "Study design", required: true },
      guidance: { model: "What is done." },
    },
  ],
};

// TEMPLATE's sections as a content file would hold them: flat, each one guided.
function authored_sections(): Array<Record<string, unknown>> {
  return TEMPLATE.sections.map((section) => ({
    ...section.metadata, model_guidance: section.guidance.model,
  }));
}

// TEMPLATE's file as authored, with `patch` laid over it.
function authored(patch: object = {}): unknown {
  return { id: TEMPLATE.id, title: TEMPLATE.title, sections: authored_sections(), ...patch };
}

// TEMPLATE's first section as authored, with `patch` laid over it, alone.
function authored_section(patch: object): unknown {
  return authored({ sections: [{ ...authored_sections()[0], ...patch }] });
}

describe("parse_document_template", () => {
  it("reads a template file as authored, sections in order", () => {
    assert.deepEqual(parse_document_template(authored()), { ok: true, value: TEMPLATE });
  });

  it("leaves behind what the template does not define", () => {
    const with_extras = authored_section({ user_placeholder: "Why this study matters." });
    assert.deepEqual(
      parse_document_template(with_extras),
      { ok: true, value: { ...TEMPLATE, sections: [TEMPLATE.sections[0]] } });
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
    refused(authored({ sections: "none" }),
      "template irb-protocol: sections must be a non-empty array");
    refused(authored({ sections: [authored_sections()[0], authored_sections()[0]] }),
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
    refused({ model_guidance: " " }, "background: model_guidance must be a non-empty string");
    refused({ model_guidance: undefined },
      "background: model_guidance must be a non-empty string");
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
  return readonly_document("The proposal as uploaded.", DocumentAuthor.USER, NOW);
}

// Materialize `files` under a fresh temp directory, run the test, clean up.
async function with_templates(
  files: Record<string, string>,
  run: (dir: string) => Promise<void>,
): Promise<void> {
  const dir = mkdtempSync(path.join(tmpdir(), "templates-"));
  try {
    for (const [rel, text] of Object.entries(files)) {
      const file = path.join(dir, rel);
      mkdirSync(path.dirname(file), { recursive: true });
      writeFileSync(file, text);
    }
    await run(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe("load_document_templates", () => {
  // TEMPLATE's file as it sits on disk, with `patch` laid over it.
  const file_of = (patch: object = {}) => JSON.stringify(authored(patch));

  it("reads every template at the top of the directory, keyed by id", async () => {
    await with_templates({
      "irb-protocol.json": file_of(),
      "budget.json": file_of({ id: "budget", title: "Budget" }),
      "notes.md": "not a template",
      "drafts/unfinished.json": "{",
    }, async (dir) => {
      const loaded = await load_document_templates(dir);
      assert.ok(loaded.ok);
      assert.deepEqual(Object.keys(loaded.value).sort(), ["budget", "irb-protocol"]);
      assert.deepEqual(loaded.value["irb-protocol"], TEMPLATE);
      assert.equal(loaded.value["budget"].title, "Budget");
    });
  });

  it("names the file and the first thing wrong with it", async () => {
    const refused = async (files: Record<string, string>, error: RegExp) => {
      await with_templates(files, async (dir) => {
        const loaded = await load_document_templates(dir);
        assert.equal(loaded.ok, false);
        if (!loaded.ok) assert.match(loaded.error, error);
      });
    };
    await refused({ "irb-protocol.json": "{" }, /irb-protocol\.json: not valid JSON$/);
    await refused({ "irb-protocol.json": file_of({ title: "" }) },
      /irb-protocol\.json: template irb-protocol: title must be a non-empty string$/);
    await refused({ "protocol.json": file_of() },
      /protocol\.json: template id 'irb-protocol' must match the file name$/);
    await refused({ "irb-protocol.json": JSON.stringify(authored_section({ model_guidance: "" })) },
      /irb-protocol\.json: template irb-protocol: section 0: background: model_guidance/);
  });

  it("refuses a directory that is not there", async () => {
    const loaded = await load_document_templates(path.join(tmpdir(), "templates-not-there"));
    assert.equal(loaded.ok, false);
    if (!loaded.ok) assert.match(loaded.error, /templates-not-there: unreadable/);
  });
});

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

describe("readonly_document", () => {
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
    assert.deepEqual(readonly_document(" \n", DocumentAuthor.USER, NOW).sections, {});
  });
});

// A document's sections as a version file holds them, decoded.
function kept(document: Document): Record<string, unknown> {
  return JSON.parse(JSON.stringify(document.sections));
}

describe("parse_document_sections", () => {
  it("reads back sections as they were kept", () => {
    const written = write_section(TEMPLATE, built(), write_of(), NOW);
    assert.ok(written.ok);
    assert.deepEqual(
      parse_document_sections(TEMPLATE.id, kept(written.value)),
      { ok: true, value: written.value.sections });
    assert.deepEqual(parse_document_sections(TEMPLATE.id, kept(built())), { ok: true, value: {} });
    assert.deepEqual(
      parse_document_sections(null, kept(uploaded())),
      { ok: true, value: uploaded().sections });
  });

  it("does not hold sections to their template", () => {
    assert.equal(parse_document_sections("irb-protocol", kept(uploaded())).ok, true);
  });

  it("names the section and what is wrong with it", () => {
    const body = kept(uploaded())[BODY_SECTION] as object;
    const refused = (sections: unknown, error: string) => {
      assert.deepEqual(
        parse_document_sections(TEMPLATE.id, sections), { ok: false, error });
    };
    refused([], "sections must be an object");
    refused("{}", "sections must be an object");
    refused({ aims: "text" }, "section aims: must be an object");
    refused({ aims: { ...body, text: " " } }, "section aims: text must be a non-empty string");
    refused({ aims: { ...body, status: "empty" } }, "section aims: unknown status");
    refused({ aims: { ...body, written_by: "system" } }, "section aims: unknown written_by");
    refused({ aims: { ...body, written_at: "yesterday" } },
      "section aims: written_at must be an ISO 8601 time");
    refused({ "has-dash": body }, "section has-dash: not a section id");
    refused(JSON.parse(`{ "__proto__": ${JSON.stringify(body)} }`),
      "section __proto__: not a section id");
    refused({ constructor: body }, "section constructor: not a section id");
  });

  it("admits only a body when the document follows no template", () => {
    const body = kept(uploaded())[BODY_SECTION] as object;
    assert.deepEqual(parse_document_sections(null, { aims: body }), {
      ok: false,
      error: "section aims: only a body without a template",
    });
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

// `document` after each write in turn, every one made against what it left.
function after_writes(document: Document, ...writes: Partial<DocumentWrite>[]): Document {
  let current = document;
  for (const patch of writes) {
    const written = write_section(
      TEMPLATE, current, write_of({ ...patch, revision: current.revision }), NOW);
    assert.ok(written.ok);
    current = written.value;
  }
  return current;
}

describe("document_standing", () => {
  it("counts every required section outstanding before anything is written", () => {
    assert.deepEqual(
      document_standing(TEMPLATE, built()),
      { outstanding: ["background", "design"], leftover: [] });
  });

  it("clears a required section only once it is complete", () => {
    const drafted = after_writes(built(),
      { section_id: "design", status: SectionStatus.NEEDS_REVIEW },
      { section_id: "background", status: SectionStatus.COMPLETE });
    assert.deepEqual(document_standing(TEMPLATE, drafted).outstanding, ["design"]);

    const finished = after_writes(drafted,
      { section_id: "design", status: SectionStatus.COMPLETE });
    assert.deepEqual(document_standing(TEMPLATE, finished).outstanding, []);
  });

  it("asks nothing of a section that is not required", () => {
    const optional = after_writes(built(), { section_id: "aims", status: SectionStatus.DRAFT });
    assert.deepEqual(
      document_standing(TEMPLATE, optional).outstanding, ["background", "design"]);
  });

  it("names the written sections its template no longer has", () => {
    const written = after_writes(built(),
      { section_id: "aims" }, { section_id: "design" });
    const trimmed: DocumentTemplate = {
      ...TEMPLATE, sections: [TEMPLATE.sections[0]],
    };
    assert.deepEqual(
      document_standing(trimmed, written),
      { outstanding: ["background"], leftover: ["aims", "design"] });
  });

  it("asks nothing of a document that follows no template", () => {
    assert.deepEqual(document_standing(null, uploaded()), { outstanding: [], leftover: [] });
  });

  it("throws when handed a template the document does not follow", () => {
    assert.throws(
      () => document_standing(null, built()),
      /follows template 'irb-protocol', but was given 'null'/);
  });
});
