export {
  Application,
  Chat,
  ChatMemory,
  ChatMessage,
  ChatMessageRole,
  ChatMessageWithFileIds,
  ChatTranscriptTurn,
  EmbeddingChunk,
  EmbeddingMatch,
  File,
  FileStatus,
  Project,
  SearchEmbeddingsParams,
  Session,
  User
}

enum FileStatus {
  UPLOADED = "uploaded",
  QUEUED = "queued",
  PARSED = "parsed",
  PARSE_FAILED = "parse_failed",
}

enum ChatMessageRole {
  USER = "user",
  ASSISTANT = "assistant",
  SYSTEM = "system",
  TOOL = "tool",
}

interface Session {
  id: string;
  user_id: string;
  session_token: string;
  auth_method: string;
  created_at: Date;
  expires_at: Date;
  last_activity_at: Date;
  revoked_at: Date | null;
  ip_address: string | null;
  user_agent: string | null;
}

interface User {
  id: string;
  password_hash: string;
}

interface Application {
  id: string;
  slug: string;
  name: string;
  description: string | null;
}

interface Chat {
  id: string;
  user_id: string;
  title: string;
  metadata: Record<string, unknown>;
  created_at: Date;
  updated_at: Date;
}

interface Project {
  id: string;
  user_id: string;
  name: string;
  description: string | null;
  instructions: string | null;
  memory_enabled: boolean;
  metadata: Record<string, unknown>;
  created_at: Date;
  updated_at: Date;
}

interface ChatMessage {
  id: string;
  chat_id: string;
  role: ChatMessageRole;
  content: string;
  metadata: Record<string, unknown>;
  created_at: Date;
}

interface ChatMessageWithFileIds extends ChatMessage {
  file_ids: string[];
}

interface ChatTranscriptTurn {
  role: ChatMessageRole;
  content: string;
  created_at: Date;
}

interface ChatMemory {
  id: string;
  chat_id: string;
  user_id: string;
  kind: string;
  content: string;
  source_through: Date;
  created_at: Date;
  updated_at: Date;
}

// One chunk to store. `embedding` must be EMBEDDING_DIMENSIONS wide and should
// be unit-normalized.
interface EmbeddingChunk {
  owner_kind: string;
  owner_id: string;
  chunk_index: number;
  content: string;
  embedding: number[];
  model: string;
}

interface SearchEmbeddingsParams {
  user_id: string;
  embedding: number[];
  // Only vectors from this model are comparable to `embedding`.
  model: string;
  // Restrict to these owner kinds. Omit to search all of them.
  owner_kinds?: string[];
  // Max hits. Applied as the ANN top-k before min_similarity trims it.
  limit?: number;
  // Drop hits below this cosine similarity. Defaults to 0 (keep everything).
  min_similarity?: number;
}

// A semantic-search hit. Normally similarity is cosine distance inverted
// ([-1, 1]). Vectors from the Embedder port are unit-normalized which
// puts it in [0, 1] with 1 meaning identical.
interface EmbeddingMatch {
  owner_kind: string;
  owner_id: string;
  chunk_index: number;
  content: string;
  similarity: number;
}

interface File {
  id: string;
  user_id: string;
  original_filename: string | null;
  mime_type: string;
  size_bytes: string; // bigint deserializes to string from pg
  checksum_sha256: string | null;
  storage_backend: string;
  storage_key: string;
  status: FileStatus;
  parse_error: string | null;
  metadata: Record<string, unknown>;
  created_at: Date;
  updated_at: Date;
}
