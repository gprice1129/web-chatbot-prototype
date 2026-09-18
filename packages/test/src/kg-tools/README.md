# kg-tools

Integration test of Ally's knowledge-graph tool calling through `POST /api/applications/ally`. Ally carries two tools: `kg_search` (node summaries for a query) and `kg_get` (whole nodes by id). Nothing in the turns tells the model to use them. The turns are what a researcher might type, and the test checks whether the model reaches for the tools on its own.

With `DEBUG_MODE=true` the server returns a `debug` trace beside each reply: the model rounds, every tool call with its input and result, and the tokens spent. The assertions read that trace, so a failure means the model did not make the tool call the turn needed, not that it phrased its answer differently.

The test creates its own chat, runs three turns, and deletes the chat afterwards:

1. "An AI tool gave me a list of references for a grant proposal I'm writing. How can I tell whether they're real?" The trace must show a successful `kg_search` and a successful `kg_get`: the corpus was searched and a node was opened.
2. "Can I paste patient notes into ChatGPT to get a quick summary?" The same, for a policy question. Policy must come from the policy node, not general knowledge.
3. "Is there any guidance on using AI to analyze flow cytometry data?" The trace must show a `kg_search` naming the topic. The corpus does not cover it, but it plausibly could, so an honest answer requires checking. A clearly out-of-scope topic (particle physics, say) gets declined without a lookup, which is fine and is not what this turn tests.

Each reply is printed with its trace for eyeballing.

## Prerequisites

- Webserver running and reachable (default `http://localhost:8080`).
- Server started with `AUTH_MODE=mock`, which seeds `testuser` and configures the mock auth service to ignore the password.
- Server started with `MODEL_MODE=real`. The mock model never calls tools.
- Server started with `DEBUG_MODE=true`, so replies carry the trace.
- The knowledge base mounted into the server is the project corpus (`packages/static/knowledge`).
- Self-signed cert is fine — the script sets `NODE_TLS_REJECT_UNAUTHORIZED=0`.

## Run

From `packages/test/`:

```sh
npm run build
npm run kg-tools -- [base-url]
```

`base-url` defaults to `http://localhost:8080`. Pass a full URL (e.g. `https://localhost`) to target a TLS frontend.

## Env overrides

| Var        | Default      | Notes                                                            |
| ---------- | ------------ | ---------------------------------------------------------------- |
| `TEST_USERNAME` | `testuser`   | Seeded automatically when the server runs with `AUTH_MODE=mock`.   |
| `TEST_PASSWORD` | `irrelevant` | The mock auth service ignores the password for the seeded user. |
