# kg-tools

Integration test of Ally's knowledge-graph tool calling through `POST /api/applications/ally`. Ally carries two tools: `kg_search` (node summaries for a query) and `kg_get` (whole nodes by id). Nothing in the turns tells the model to use them. The turns are what a researcher might type, and the test checks whether the model reaches for the tools on its own.

The API returns only Ally's final text, so each reply is checked for what only the corpus could have supplied. The test creates its own chat, runs four turns, and deletes the chat afterwards. The phrases it looks for are read from the `hallucinated-citations` node:

1. "An AI tool gave me a list of references for a grant proposal I'm writing. How can I tell whether they're real?" The reply must mention the DOI, credit the knowledge base, and use the node's own wording (`well-formed`, `on-the-nose`, or `obscure`), which general knowledge would not produce.
2. "Where is that guidance from?" The reply must credit the knowledge base.
3. "What's the single quickest check I can do on one citation?" The reply must say `doi.org` or `well-formed but dead`, phrasing from the node body, which only `kg_get` returns.
4. "Do you have anything on quantum chromodynamics?" The reply must decline (no, nothing, outside scope), showing a topic the corpus lacks is not invented.

Each reply is printed for eyeballing. The run fails on the first reply that lacks what its tool call must have supplied. Because nothing steers the model, a failure here means the model answered from general knowledge instead of consulting the corpus. That is a finding about the prompt and model, not a bug in the server.

## Prerequisites

- Webserver running and reachable (default `http://localhost:8080`).
- Server started with `AUTH_MODE=mock`, which seeds `testuser` and configures the mock auth service to ignore the password.
- Server started with `MODEL_MODE=real`. The mock model never calls tools, so there is nothing to observe under it.
- The knowledge base mounted into the server is the project corpus (`config/knowledge_base`), which holds the `hallucinated-citations` node the assertions are pinned to.
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
