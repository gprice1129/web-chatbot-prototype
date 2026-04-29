export {
  parse_file,
}

import * as fs from "node:fs";
import mammoth from "mammoth";
import pdf_parse from "pdf-parse";

// TODO:[common] extract common utilities
const MIME_PDF = "application/pdf";
const MIME_DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

async function parse_file(file_path: string, mime_type: string): Promise<string> {
  switch (mime_type) {
    case MIME_PDF: {
      const buf = await fs.promises.readFile(file_path);
      const result = await pdf_parse(buf);
      return result.text;
    }
    case MIME_DOCX: {
      const result = await mammoth.extractRawText({ path: file_path });
      return result.value;
    }
    default:
      throw new Error(`Unsupported mime type for parsing: ${mime_type}`);
  }
}
