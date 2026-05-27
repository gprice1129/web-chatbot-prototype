export {
  parse_file,
}

import mammoth from "mammoth";
import pdf_parse from "pdf-parse";

// TODO:[common] extract common utilities
const MIME_PDF = "application/pdf";
const MIME_DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

async function parse_file(buffer: Buffer, mime_type: string): Promise<string> {
  switch (mime_type) {
    case MIME_PDF: {
      const result = await pdf_parse(buffer);
      return result.text;
    }
    case MIME_DOCX: {
      const result = await mammoth.extractRawText({ buffer });
      return result.value;
    }
    default:
      throw new Error(`Unsupported mime type for parsing: ${mime_type}`);
  }
}
