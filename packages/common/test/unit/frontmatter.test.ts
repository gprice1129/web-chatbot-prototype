import { describe, it } from "node:test";
import * as assert from "node:assert/strict";

import {
  separate_frontmatter,
  parse_frontmatter,
  _has_non_ascii,
  _has_content,
  _is_field_map,
} from "#common/frontmatter.js";

describe("separate_frontmatter", () => {
  it("cuts a document at its delimiters", () => {
    const { frontmatter, body } = separate_frontmatter("---\nid: sample\n---\n# A sample\n");
    assert.equal(frontmatter, "id: sample\n");
    assert.equal(body, "# A sample\n");
  });

  it("returns the whole document as body when there is no frontmatter", () => {
    const { frontmatter, body } = separate_frontmatter("# Just markdown\n");
    assert.equal(frontmatter, "");
    assert.equal(body, "# Just markdown\n");
  });

  it("handles a document that ends on its closing delimiter", () => {
    const { frontmatter, body } = separate_frontmatter("---\nid: no-body\n---");
    assert.equal(frontmatter, "id: no-body\n");
    assert.equal(body, "");
  });

  it("treats an unclosed frontmatter block as no frontmatter", () => {
    const document = "---\nid: unterminated\n";
    const { frontmatter, body } = separate_frontmatter(document);
    assert.equal(frontmatter, "");
    assert.equal(body, document);
  });

  it("accepts trailing whitespace on the opening delimiter", () => {
    for (const opener of ["--- ", "---\t", "---   "]) {
      const { frontmatter, body } = separate_frontmatter(`${opener}\nid: a\n---\nbody\n`);
      assert.equal(frontmatter, "id: a\n", `opener ${JSON.stringify(opener)}`);
      assert.equal(body, "body\n", `opener ${JSON.stringify(opener)}`);
    }
  });

  it("accepts trailing whitespace on the closing delimiter", () => {
    const { frontmatter, body } = separate_frontmatter("---\nid: a\n---  \nbody\n");
    assert.equal(frontmatter, "id: a\n");
    assert.equal(body, "body\n");
  });

  it("takes four dashes as ordinary content, not a delimiter", () => {
    const document = "----\nid: a\n---\nbody\n";
    const { frontmatter, body } = separate_frontmatter(document);
    assert.equal(frontmatter, "");
    assert.equal(body, document);
  });

  it("normalises CRLF, so a Windows-authored document cuts the same", () => {
    const { frontmatter, body } = separate_frontmatter("---\r\nid: crlf\r\n---\r\nbody\r\n");
    assert.equal(frontmatter, "id: crlf\n");
    assert.equal(body, "body\n");
  });
});

function fields(block: string): Record<string, any> {
  const parsed = parse_frontmatter(block);
  assert.ok(parsed.ok, parsed.ok ? "" : `unexpected failure: ${parsed.error}`);
  return parsed.value;
}

function refusal(block: string): string {
  const parsed = parse_frontmatter(block);
  assert.equal(parsed.ok, false, `expected ${JSON.stringify(block)} to be refused`);
  return parsed.ok ? "" : parsed.error;
}

describe("parse_frontmatter", () => {
  it("keeps a date a string rather than a Date", () => {
    // Pins the schema argument.
    assert.equal(fields("reviewed: 2026-08-06\n")["reviewed"],
                 "2026-08-06");
  });

  it("passes a declared-but-empty key through as null", () => {
    assert.equal(fields("edges:\n")["edges"],
                 null);
  });

  it("refuses a block that declares nothing", () => {
    for (const block of ["", "\n", "   \n", "# only a comment\n"]) {
      assert.match(refusal(block), /expected at least one `key: value` field`?/,
                   JSON.stringify(block));
    }
  });

  it("refuses a block that will not parse, naming the line", () => {
    assert.match(refusal("id: a\n  bad indent: x\n"),
                 /^frontmatter line 2: /);
  });

  it("refuses a duplicated key rather than letting one win", () => {
    assert.match(refusal("a: 1\na: 2\n"),
                 /^frontmatter line 2: duplicated mapping key/);
  });

  it("refuses a block that is not a mapping", () => {
    assert.match(refusal("- a\n- b\n"),
                 /expected a block of `key: value` fields/);
    assert.match(refusal("just a scalar\n"),
                 /expected a block of `key: value` fields/);
  });

  it("refuses a block that is not plain ASCII", () => {
    assert.match(refusal("id: a\nsummary: TODO \u2014 a dash\n"),
                 /^frontmatter: expected ASCII text$/);
  });
});

describe("_has_non_ascii", () => {
  it("is false for a block that is ASCII throughout", () => {
    assert.equal(_has_non_ascii("id: a\ntype: risk\n"), false);
  });

  it("is true wherever there is non-ascii character", () => {
    assert.equal(_has_non_ascii("\u2014"), true);
    assert.equal(_has_non_ascii("id: a\nb: \u2014\n"), true);
    assert.equal(_has_non_ascii("id: a\nb: c\n\u00ab"), true);
  });

  it("is true for a character built from a surrogate pair", () => {
    assert.equal(_has_non_ascii("emoji: \u{1F3A7}"), true);
  });

  it("is false for every ASCII character, including the awkward ones", () => {
    assert.equal(_has_non_ascii("k: ~!@#$%^&*()_+`-=[]{}|;\':\",./<>?"), false);
  });
});

describe("_has_content", () => {
  it("is false when every line is blank or a comment", () => {
    for (const block of ["", "\n", "   ", "# note", "\n  # note\n\n"]) {
      assert.equal(_has_content(block), false, JSON.stringify(block));
    }
  });

  it("is true as soon as one line carries a field", () => {
    assert.equal(_has_content("# note\nid: a\n"), true);
    assert.equal(_has_content("\n\nid: a"), true);
  });
});

describe("_is_field_map", () => {
  it("accepts a mapping", () => {
    assert.equal(_is_field_map({ a: 1 }), true);
    assert.equal(_is_field_map({}), true);
  });

  it("rejects what a frontmatter block may not be", () => {
    for (const value of [null, undefined, [1, 2], "text", 12, true]) {
      assert.equal(_is_field_map(value), false, JSON.stringify(value ?? null));
    }
  });
});
