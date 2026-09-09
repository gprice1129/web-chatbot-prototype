// Integration test for Ally's knowledge-graph tool calling.
//
// Ally carries two tools: kg_search (node summaries for a query) and kg_get
// (whole nodes by id). Nothing in these turns tells the model to use them. The
// turns are what a researcher might type, and the test checks whether the
// model reaches for the tools on its own.
//
// With DEBUG_MODE=true the server returns a `debug` trace beside each reply:
// the model rounds, every tool call with its input and result, and the tokens
// spent. The assertions read that trace. A failure means the model did not
// make the tool call the turn needed, not that it phrased its answer
// differently.
//
//   npm run kg-tools -- [base-url]
//
// The server must be running with AUTH_MODE=mock, which seeds `testuser` and
// configures the mock auth service to ignore the password; with
// MODEL_MODE=real, since the mock model never calls tools; and with
// DEBUG_MODE=true. The knowledge base must be the project corpus. The test
// creates its own chat and deletes it afterwards.

// Match `curl -k` for the local self-signed cert. Set before any fetch so
// undici picks it up when the global dispatcher is created.
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

interface KgToolsOptions {
  base_url: string;
  username: string;
  password: string;
}

// One tool call as the server reports it.
interface TraceToolCall {
  round: number;
  name: string;
  input: Record<string, unknown>;
  ok: boolean;
  result: string;
}

// What happened behind one reply.
interface Trace {
  rounds: number;
  tool_calls: TraceToolCall[];
  usage: { input_tokens: number; output_tokens: number };
}

interface AllyReply {
  message: string[];
  debug?: Trace;
}

// One scripted turn and the tool activity its reply must show.
interface Turn {
  message: string;
  check: (trace: Trace) => boolean;
  why: string;
}

// The tool calls of `name` that succeeded.
function successful(trace: Trace, name: string): TraceToolCall[] {
  return trace.tool_calls.filter((call) => call.name === name && call.ok);
}

const TURNS: Turn[] = [
  {
    message:
      "An AI tool gave me a list of references for a grant proposal I'm "
      + "writing. How can I tell whether they're real?",
    check: (trace) => successful(trace, "kg_search").length > 0
      && successful(trace, "kg_get").length > 0,
    why: "a question about an AI risk should be answered from the corpus: search, then open a node",
  },
  {
    message: "Can I paste patient notes into ChatGPT to get a quick summary?",
    check: (trace) => successful(trace, "kg_search").length > 0
      && successful(trace, "kg_get").length > 0,
    why: "a policy question must be answered from the policy node, not from general knowledge",
  },
  {
    message: "Is there any guidance on using AI to analyze flow cytometry data?",
    check: (trace) => successful(trace, "kg_search").some((call) =>
      /cytometry/i.test(String(call.input["query"]))),
    why: "a topic that might be covered must be checked in the corpus, not guessed at",
  },
];

// Log in and return the session cookie that gated routes require.
async function login(opts: KgToolsOptions): Promise<string> {
  const res = await fetch(`${opts.base_url}/api/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: opts.username, password: opts.password }),
  });
  if (res.status !== 200) {
    throw new Error(`Login failed (HTTP ${res.status}): ${await res.text()}`);
  }
  // getSetCookie() keeps each Set-Cookie header separate; .get() would merge them.
  const cookie = res.headers.getSetCookie()
    .map((sc) => sc.split(";", 1)[0]!)
    .find((c) => c.startsWith("session="));
  if (!cookie) throw new Error("Login response had no session cookie");
  return cookie;
}

// Create a chat for the conversation and return its id.
async function create_chat(base_url: string, cookie: string): Promise<string> {
  const res = await fetch(`${base_url}/api/chats`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: cookie },
    body: JSON.stringify({ title: "kg-tools composite" }),
  });
  if (res.status !== 201 && res.status !== 200) {
    throw new Error(`Chat create failed (HTTP ${res.status}): ${await res.text()}`);
  }
  return (JSON.parse(await res.text()) as { id: string }).id;
}

// Remove the chat so the run leaves nothing behind.
async function delete_chat(base_url: string, cookie: string, chat_id: string): Promise<void> {
  const res = await fetch(`${base_url}/api/chats/${encodeURIComponent(chat_id)}`, {
    method: "DELETE",
    headers: { Cookie: cookie },
  });
  if (res.status >= 300) {
    throw new Error(`Chat delete failed (HTTP ${res.status}): ${await res.text()}`);
  }
}

// Send one message to Ally and return the reply with its trace.
async function ask(
    base_url: string, cookie: string, chat_id: string, message: string): Promise<AllyReply> {
  const res = await fetch(`${base_url}/api/applications/ally`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: cookie },
    body: JSON.stringify({ chat_id, message }),
  });
  const body = await res.text();
  if (res.status !== 200) throw new Error(`Ally failed (HTTP ${res.status}): ${body}`);
  return JSON.parse(body) as AllyReply;
}

// The trace as one line per tool call, for reading alongside the reply.
function describe_trace(trace: Trace): string {
  const lines = [
    `[rounds: ${trace.rounds}; tokens in/out: `
    + `${trace.usage.input_tokens}/${trace.usage.output_tokens}]`,
  ];
  for (const call of trace.tool_calls) {
    const outcome = call.ok ? "ok" : `error: ${call.result}`;
    lines.push(`  round ${call.round}: ${call.name}(${JSON.stringify(call.input)}) -> ${outcome}`);
  }
  return lines.join("\n");
}

// Run the scripted turns, failing on the first whose trace lacks the tool
// call the turn needed.
export async function kg_tools(opts: KgToolsOptions): Promise<void> {
  const cookie = await login(opts);
  const chat_id = await create_chat(opts.base_url, cookie);
  try {
    for (const turn of TURNS) {
      const reply = await ask(opts.base_url, cookie, chat_id, turn.message);
      if (undefined === reply.debug) {
        throw new Error("The server returned no debug trace. Start it with DEBUG_MODE=true.");
      }
      console.log(`\n> ${turn.message}\n\n${reply.message.join("\n")}\n`);
      console.log(describe_trace(reply.debug));
      if (turn.check(reply.debug)) continue;
      throw new Error(`Expected tool activity missing: ${turn.why}.`);
    }
  } finally {
    await delete_chat(opts.base_url, cookie, chat_id);
  }
}

// CLI driver. Throws on any failure, which surfaces as a non-zero exit code.
if (import.meta.url === `file://${process.argv[1]}`) {
  await kg_tools({
    base_url: process.argv[2] ?? "http://localhost:8080",
    username: process.env.TEST_USERNAME ?? "testuser",
    password: process.env.TEST_PASSWORD ?? "irrelevant",
  });
  console.log("\nkg-tools: every turn made the tool calls it needed");
}
