// Integration test for Ally's knowledge-graph tool calling.
//
// Ally carries two tools: kg_search (node summaries for a query) and kg_get
// (whole nodes by id). Nothing in these turns tells the model to use them. The
// turns are what a researcher might type, and the test checks whether the
// model reaches for the tools on its own. The API returns only Ally's final
// text, so each reply is checked for what only the corpus could have supplied:
// the node's own phrasing, its name when asked where the guidance came from,
// and a "no" for a topic the corpus does not cover.
//
//   npm run kg-tools -- [base-url]
//
// The server must be running with AUTH_MODE=mock, which seeds `testuser` and
// configures the mock auth service to ignore the password, and with
// MODEL_MODE=real: the mock model never calls tools, so there is nothing to
// observe under it. The knowledge base must be the project corpus, which holds
// the node `hallucinated-citations` ("Fabricated citations"). The test creates
// its own chat and deletes it afterwards.

// Match `curl -k` for the local self-signed cert. Set before any fetch so
// undici picks it up when the global dispatcher is created.
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

interface KgToolsOptions {
  base_url: string;
  username: string;
  password: string;
}

// One scripted turn and what its reply must contain.
interface Turn {
  message: string;
  expect: RegExp[];
  why: string;
}

// Phrasing from the body of the `hallucinated-citations` node that general
// knowledge would not produce. Only kg_get returns bodies.
const NODE_PHRASING = /well-formed|on-the-nose|obscure/i;

const TURNS: Turn[] = [
  {
    message:
      "An AI tool gave me a list of references for a grant proposal I'm "
      + "writing. How can I tell whether they're real?",
    expect: [/DOI/, /knowledge base/i, NODE_PHRASING],
    why: "a grounded answer credits the knowledge base and uses the node's own wording",
  },
  {
    message: "Where is that guidance from?",
    expect: [/knowledge base/i],
    why: "asked for provenance, a grounded answer names the knowledge base",
  },
  {
    message: "What's the single quickest check I can do on one citation?",
    expect: [/doi\.org|well-formed but dead/i],
    why: "this phrasing is in the node body, which only kg_get returns",
  },
  {
    message: "Do you have anything on quantum chromodynamics?",
    expect: [/\b(no|nothing|not|don't|doesn't|isn't|outside|beyond)\b/i],
    why: "a topic the corpus lacks should be declined, not invented",
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

// Send one message to Ally and return the reply's text blocks.
async function ask(
    base_url: string, cookie: string, chat_id: string, message: string): Promise<string[]> {
  const res = await fetch(`${base_url}/api/applications/ally`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: cookie },
    body: JSON.stringify({ chat_id, message }),
  });
  const body = await res.text();
  if (res.status !== 200) throw new Error(`Ally failed (HTTP ${res.status}): ${body}`);
  return (JSON.parse(body) as { message: string[] }).message;
}

// Run the scripted turns, failing on the first reply that lacks what its tool
// call must have supplied.
export async function kg_tools(opts: KgToolsOptions): Promise<void> {
  const cookie = await login(opts);
  const chat_id = await create_chat(opts.base_url, cookie);
  try {
    for (const turn of TURNS) {
      const reply = (await ask(opts.base_url, cookie, chat_id, turn.message)).join("\n");
      console.log(`\n> ${turn.message}\n\n${reply}`);
      for (const pattern of turn.expect) {
        if (pattern.test(reply)) continue;
        throw new Error(
          `Reply did not match ${pattern} (${turn.why}).\nReply was:\n${reply}`);
      }
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
  console.log("\nkg-tools: all turns matched");
}
