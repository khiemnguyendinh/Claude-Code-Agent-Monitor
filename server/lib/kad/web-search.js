/**
 * @file server/lib/kad/web-search.js — real web search for the Researcher's
 * kad_web_search tool (spec 04 §2). Provider: Tavily (chosen 2026-07-04; LLM-native,
 * simple REST). Reads TAVILY_API_KEY from env (put it in mcp/.env or the server env).
 * No key → structured ENOWEBSEARCH error (never a fake result — anti-mock rule).
 */
const PROVIDER = (process.env.KAD_WEBSEARCH_PROVIDER || "tavily").toLowerCase();

async function tavily(query, { maxResults = 5 } = {}) {
  const key = process.env.TAVILY_API_KEY;
  if (!key) {
    const e = new Error("web search not configured: set TAVILY_API_KEY");
    e.code = "ENOWEBSEARCH";
    throw e;
  }
  const resp = await fetch("https://api.tavily.com/search", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      api_key: key,
      query,
      max_results: Math.min(maxResults, 10),
      search_depth: "basic",
      include_answer: true,
    }),
  });
  if (!resp.ok) {
    const e = new Error(`tavily ${resp.status}: ${(await resp.text()).slice(0, 200)}`);
    e.code = "EWEBSEARCH";
    throw e;
  }
  const data = await resp.json();
  return {
    provider: "tavily",
    query,
    answer: data.answer || null,
    results: (data.results || []).map((r) => ({ title: r.title, url: r.url, content: r.content, score: r.score })),
  };
}

async function search(query, opts) {
  if (!query || typeof query !== "string") {
    const e = new Error("query is required");
    e.code = "EBADQUERY";
    throw e;
  }
  if (PROVIDER === "tavily") return tavily(query, opts || {});
  const e = new Error(`unknown web search provider '${PROVIDER}'`);
  e.code = "ENOWEBSEARCH";
  throw e;
}

module.exports = { search };
