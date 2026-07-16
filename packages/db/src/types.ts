export {
  Application,
  Chat,
  ChatMemory,
  ChatMessage,
  ChatMessageRole,
  ChatMessageWithFileIds,
  ChatTranscriptTurn,
  File,
  FileStatus,
  Project,
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
