export {
  LexicalGraph,
}
export type {
  SearchHit,
}

import type {
  SearchFilters,
  KnowledgeGraphSource,
} from "#kg/port.js";
import {
  type GraphNode,
} from "#kg/ontology.js";

/*
 * Main Concept
 * -----------------------------------------------------------------------------
 * This file defines how a query is answered by lexical overlap. A node ranks by
 * how many of a query's terms it carries, weighted by where in the node each
 * term appears and by how rare that term is across the corpus.
 */

/*
 * Application Usage
 * -----------------------------------------------------------------------------
 * A query term scores the weight of the best field that term hits according to
 * a defined hierarchy (see the code below).
 *
 * A whole-query hit on an id or a name takes a bonus large enough to outrank
 * any accumulated overlap.
 *
 * Lexical overlap is a deliberate prototype choice based on the current size of
 * the corpus (~10^2).
 *
 * LexicalGraph only represents the retrieval half of a provider and is only
 * split for conceptual clarity. A provider whose store performs its own ranking
 * would not split into halves. Such a provider would implement the port as one
 * unit and push the query into the store. The port permits both shapes.
 */

/*
 * Idea: The graph made searchable. Holds every node and ranks them against a
 * question by the words they share with it.
 */
class LexicalGraph implements KnowledgeGraphSource {
  private _nodes: Map<string, GraphNode>;
  private _index: _NodeIndex[];
  // Document frequency per token, over the union of every node's fields.
  private _doc_freq: Map<string, number>;
  // Normalized title/alias -> ids that answer to that name.
  private _names: Map<string, string[]>;

  /*
   * Idea: Read every node once when the graph is built. Answering a question
   * later compares prepared words instead of re-reading text.
   *
   * Two nodes sharing an id is a fault in whatever produced them, not something
   * a corpus author can fix, so it throws rather than reporting. A loader that
   * tolerates duplicates is expected to have resolved them already.
   */
  constructor(nodes: GraphNode[]) {
    this._nodes = new Map();
    this._index = [];
    this._doc_freq = new Map();
    this._names = new Map();

    for (const node of nodes) {
      if (this._nodes.has(node.id)) {
        throw new Error(`LexicalGraph: duplicate node id '${node.id}'`);
      }
      this._nodes.set(node.id, node);

      const tokens: Record<_SearchField, Set<string>> = {
        id:      new Set(_tokenize(node.id)),
        title:   new Set(_tokenize(node.title)),
        aliases: new Set(_tokenize(node.aliases.join(" "))),
        summary: new Set(_tokenize(node.summary)),
        body:    new Set(_tokenize(node.body)),
      };
      this._index.push({ node, tokens });

      const seen = new Set<string>();
      for (const field of _SEARCH_FIELDS) {
        for (const token of tokens[field]) seen.add(token);
      }
      for (const token of seen) {
        this._doc_freq.set(token, (this._doc_freq.get(token) ?? 0) + 1);
      }

      for (const name of [node.title, ...node.aliases]) {
        const key = _normalize(name);
        if ("" === key) continue;
        const ids = this._names.get(key) ?? [];
        ids.push(node.id);
        this._names.set(key, ids);
      }
    }
  }

  /*
   * Idea: How many nodes the graph holds.
   *
   * (void) => number
   * Pure
   * Public
   */
  public size(): number {
    return this._nodes.size;
  }

  /*
   * Idea: Every node the graph holds.
   *
   * (void) => GraphNode[]
   * Pure
   * Public
   */
  public nodes(): GraphNode[] {
    return [...this._nodes.values()];
  }

  /*
   * Idea: Find one node by any name it answers to.
   *
   * (string) => GraphNode | null
   * Falling back to a name matters because a model that has read a summary
   * will sometimes ask for the title it saw rather than the id.
   *
   * Async to satisfy the port. This implementation never awaits.
   * Pure
   * Public
   */
  public async get(id: string): Promise<GraphNode | null> {
    const direct = this._nodes.get(id.trim());
    if (undefined !== direct) return direct;
    const named = this._names.get(_normalize(id));
    if (undefined === named || 0 === named.length) return null;
    return this._nodes.get(named[0]) ?? null;
  }

  /*
   * Idea: The best nodes for a question, in order. How strongly each one
   * matched stays inside.
   *
   * (string, SearchFilters) => GraphNode[]
   * Async to satisfy the port. This implementation never awaits.
   * Pure
   * Public
   */
  public async search(query: string, filters: SearchFilters): Promise<GraphNode[]> {
    return this.search_scored(query, filters).map((hit) => hit.node);
  }

  /*
   * Idea: The same ranking with each node's strength attached, for
   * inspecting how the order was reached.
   *
   * (string, SearchFilters) => SearchHit[]
   * Rank nodes against a query by IDF-weighted term overlap, filtered by the
   * ontology facets, best first. Ties break on id so results are stable.
   *
   * Provider-specific: the scores are this implementation's own scale. Callers
   * that only need ranking should use search().
   * Pure
   * Public
   */
  public search_scored(query: string, filters: SearchFilters): SearchHit[] {
    const limit = Math.max(1, filters.limit);
    const terms = [...new Set(_tokenize(query))];
    const normalized = _normalize(query);
    const exact_named = new Set(this._names.get(normalized) ?? []);

    const hits: SearchHit[] = [];
    for (const entry of this._index) {
      if (!_is_eligible(entry.node, filters)) continue;
      let score = this._score(entry, terms);
      if (normalized === _normalize(entry.node.id)) score += _EXACT_ID_BONUS;
      else if (exact_named.has(entry.node.id)) score += _EXACT_NAME_BONUS;
      if (score <= 0) continue;
      hits.push({ node: entry.node, score });
    }
    hits.sort((a, b) =>
      b.score - a.score || a.node.id.localeCompare(b.node.id));
    return hits.slice(0, limit);
  }

  /*
   * Idea: How well one node answers a question.
   *
   * (_NodeIndex, string[]) => number
   * Each query term contributes the weight of the best field it hits, scaled by
   * how rare the term is across the corpus. The total is scaled by how much of
   * the query the node covered. Best-field rather than every-field keeps a term
   * repeated through a long body from outweighing a term in a title.
   * Pure
   * Private
   */
  private _score(entry: _NodeIndex, terms: string[]): number {
    if (0 === terms.length) return 0;
    let total = 0;
    let matched = 0;
    for (const term of terms) {
      let best = 0;
      for (const field of _SEARCH_FIELDS) {
        if (_FIELD_WEIGHTS[field] <= best) continue;
        if (_field_hit(entry.tokens[field], term)) best = _FIELD_WEIGHTS[field];
      }
      if (0 === best) continue;
      matched++;
      total += best * this._idf(term);
    }
    if (0 === matched) return 0;
    return total * (0.5 + 0.5 * (matched / terms.length));
  }

  /*
   * Idea: How much a word narrows the field.
   *
   * (string) => number
   * Inverse document frequency.
   * Pure
   * Private
   */
  private _idf(term: string): number {
    const total = Math.max(1, this._index.length);
    const freq = this._doc_freq.get(term) ?? 0;
    return Math.log(1 + total / (1 + freq));
  }
}

/*
 * Idea: A node and how strongly it matched.
 *
 * The strength is an IDF-weighted overlap magnitude, comparable only within one
 * result set from this implementation.
 */
interface SearchHit {
  node: GraphNode;
  score: number;
}

/*
 * Idea: A node in its prepared form, ready to be compared against a question.
 *
 * Precomputed token sets per node, so a query scans sets rather than re-parsing
 * text on every search.
 */
interface _NodeIndex {
  node: GraphNode;
  tokens: Record<_SearchField, Set<string>>;
}

/*
 * Idea: Whether a node is eligible at all, separately from how well it matches.
 *
 * (GraphNode, SearchFilters) => boolean
 * An empty filter list means "no constraint".
 * Pure
 * Private
 */
function _is_eligible(node: GraphNode, filters: SearchFilters): boolean {
  if (__excluded_by_deprecation(node.deprecated, filters)
      || __excluded_by_type(node.type, filters)
      || __excluded_by_level(node.level, filters)
      || __excluded_by_audience(node.audiences, filters)) {
    return false;
  }
  return true;

  function __excluded_by_deprecation(
      deprecated: boolean, filters: SearchFilters): boolean {
    return true !== filters.include_deprecated && deprecated;
  }

  function __excluded_by_type(type: string, filters: SearchFilters): boolean {
    const types = filters.types;
    if (undefined === types || 0 === types.length) return false;
    return !types.includes(type);
  }

  function __excluded_by_level(level: string | null, filters: SearchFilters): boolean {
    const levels = filters.levels;
    if (undefined === levels || 0 === levels.length) return false;
    // A node with no level (a module or a track) cannot satisfy a level filter.
    return null === level || !levels.includes(level);
  }

  function __excluded_by_audience(audiences: string[], filters: SearchFilters): boolean {
    const wanted = filters.audiences;
    if (undefined === wanted || 0 === wanted.length) return false;
    // One audience in common is enough; a node may serve several.
    return !wanted.some((audience) => audiences.includes(audience));
  }
}

/*
 * Idea: Reduce text to the words that can tell one node from another.
 *
 * (string) => string[]
 * The same reduction runs on a node's fields and on a query, so a word dropped
 * from one is dropped from the other.
 *
 * Hyphenated ids split into their parts, which is what makes
 * `hallucinated-citations` reachable from "hallucinated citations".
 * Pure
 * Private
 */
function _tokenize(text: string): string[] {
  return _normalize(text)
    .split(" ")
    .filter((token) => token.length > 1 && !_STOPWORDS.has(token));
}

/*
 * Idea: Reduce text to one comparable whole, for asking whether two names
 * are the same thing.
 *
 * (string) => string
 * Unlike _tokenize, nothing is dropped: a name made mostly of common words
 * still has to match exactly.
 * Pure
 * Private
 */
function _normalize(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

/*
 * Idea: Whether a word turns up among a field's words, with different forms
 * of the same word counting as a match.
 *
 * (Set<string>, string) => boolean
 * Prefix matching in either direction is a cheap stand-in for a stemmer, so
 * "hallucination" reaches "hallucinated".
 * Pure
 * Private
 */
function _field_hit(tokens: Set<string>, term: string): boolean {
  if (tokens.has(term)) return true;
  if (term.length < _MIN_PREFIX_LEN) return false;
  for (const token of tokens) {
    if (token.startsWith(term)) return true;
    if (token.length >= _MIN_PREFIX_LEN && term.startsWith(token)) return true;
  }
  return false;
}

/*
 * Idea: Where a word appears says how much the match is worth.
 *
 * Aliases outrank prose because the corpus authors alternate names
 * deliberately: a reader's own words reach a node through its aliases, while
 * its title uses the institution's words.
 */
const _FIELD_WEIGHTS = Object.freeze({
  title:   6,
  aliases: 5,
  id:      4,
  summary: 2,
  body:    1,
});

/*
 * Idea: The parts of a node that carry text a word can match.
 *
 * Derived from the weights rather than restated, so a newly weighted field
 * cannot be silently left unsearched. Declaration order is descending weight,
 * which lets _score stop at the first field a word hits.
 */
type _SearchField = keyof typeof _FIELD_WEIGHTS;
const _SEARCH_FIELDS = Object.keys(_FIELD_WEIGHTS) as _SearchField[];

/*
 * Idea: Naming a thing exactly means that thing, not something that merely
 * shares words with it.
 *
 * Large enough to be decisive rather than to win on points. An id outranks a
 * name because an id is unique by construction, while a title or alias may be
 * shared by more than one node.
 */
const _EXACT_ID_BONUS = 100;
const _EXACT_NAME_BONUS = 60;

/*
 * Idea: Words common enough that finding one tells you nothing.
 *
 * The base is NLTK's English stopword list, written out the way `_tokenize`
 * sees text, so a contraction such as "don't" appears as `don`. A published
 * list is used rather than a hand-picked one so the boundary is auditable.
 */
const _BASE_STOPWORDS = `
  i me my myself we our ours ourselves you youre youve youll youd your yours
  yourself yourselves he him his himself she shes her hers herself it its itself
  they them their theirs themselves what which who whom this that thatll these
  those am is are was were be been being have has had having do does did doing a
  an the and but if or because as until while of at by for with about against
  between into through during before after above below to from up down in out on
  off over under again further then once here there when where why how all any
  both each few more most other some such no nor not only own same so than too
  very s t can will just don dont should shouldve now d ll m o re ve y ain aren
  arent couldn couldnt didn didnt doesn doesnt hadn hadnt hasn hasnt haven havent
  isn isnt ma mightn mightnt mustn mustnt needn neednt shan shant shouldn
  shouldnt wasn wasnt weren werent won wont wouldn wouldnt
`;

/*
 * Idea: Words that tell you nothing in this corpus, though a general list
 * would keep them.
 *
 * `use`, `used` and `using` are the load-bearing ones. The corpus teaches
 * people to use AI tools, so those words run through it and separate nothing.
 * The rest are asking verbs common in a question to a chatbot and absent from
 * the base.
 */
const _CORPUS_STOPWORDS = "get give may use used using want";

const _STOPWORDS = new Set(
  `${_BASE_STOPWORDS} ${_CORPUS_STOPWORDS}`
    .split(/\s+/)
    .filter((word) => word.length > 1));

/*
 * Idea: How much of a word must match before a partial match is worth
 * believing.
 *
 * Below this, prefix matching pairs unrelated words more often than related
 * ones: "ai" would reach "aim" and "aid".
 */
const _MIN_PREFIX_LEN = 4;
