import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";

const MODEL = process.env.CLAUDE_MODEL || "claude-opus-5-5";
const BATCH_SIZE = 12;
// Server-side refusal fallbacks are only accepted on these models (not Haiku).
const FALLBACK_MODELS = new Set(["claude-opus-5-5", "claude-opus-5", "claude-fable-5-1", "claude-sonnet-5-5"]);
const fallbackParams = FALLBACK_MODELS.has(MODEL)
  ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" }
  : {};

export const CATEGORIES = [
  "news",
  "funny",
  "event",
  "traffic_weather",
  "culture_sport",
  "lost_found",
  "marketplace",
  "other",
];

const SummarySchema = z.object({
  items: z.array(
    z.object({
      id: z.string(),
      headline: z.string(),
      summary: z.string(),
      category: z.string(),
      funScore: z.number(),
      localScore: z.number(),
      emoji: z.string(),
    }),
  ),
});

const DigestSchema = z.object({
  title: z.string(),
  intro: z.string(),
  highlights: z.array(z.object({ id: z.string(), line: z.string() })),
});

const StoryGroupsSchema = z.object({
  groups: z.array(z.object({ ids: z.array(z.string()) })),
});

let client;
const getClient = () => (client ??= new Anthropic());

function systemPrompt(location) {
  return `You write a local news feed for people living in ${location.name}, ${location.region}. Nearby places that count as local: ${location.nearby.join(", ")}.

Your input is a mix of news articles (RSS) and posts from local Facebook pages and community groups, where people share everything from road closures to a moose in someone's garden. Write all output in ${location.language}.

For each item:
- headline: a short, clear headline (max ~10 words). For Facebook posts, invent one that captures the post.
- summary: 1-3 sentences saying what happened, where and when, if known. Keep the humour and warmth of funny community posts; don't make them dry.
- category: news, funny (amusing or charming everyday stuff), event (something people can attend), traffic_weather, culture_sport, lost_found, marketplace (buying/selling/giving away), or other.
- funScore: 0-10, how entertaining or delightful it is to read.
- localScore: 0-10, how much it concerns ${location.name} specifically (regional news about elsewhere in the county scores low).
- emoji: one fitting emoji.

Community posts come from private people. Never include the full names, phone numbers, addresses or other personal details of private individuals in headlines or summaries; refer to them generically ("en alting", "en hundeeier"). Public figures, businesses and organisations may be named.

Only use facts present in the item. If the text is too thin to summarise, say what little is known rather than guessing. Return every input id exactly once.`;
}

async function structured(schema, system, content, effort) {
  const message = await getClient().beta.messages.parse({
    model: MODEL,
    max_tokens: 16000,
    ...fallbackParams,
    output_config: { effort, format: betaZodOutputFormat(schema) },
    system,
    messages: [{ role: "user", content }],
  });
  if (message.stop_reason === "refusal") {
    throw new Error(`Claude declined: ${message.stop_details?.explanation ?? "refusal"}`);
  }
  if (message.stop_reason === "max_tokens" || !message.parsed_output) {
    throw new Error(`Incomplete response (stop_reason: ${message.stop_reason})`);
  }
  return message.parsed_output;
}

const clamp = (n) => Math.max(0, Math.min(10, Math.round(n)));

/** Summarises items in batches. Returns Map<id, ai>; items missing from the map failed. */
export async function summarizeItems(items, location, { onBatch } = {}) {
  const results = new Map();
  for (let i = 0; i < items.length; i += BATCH_SIZE) {
    const batch = items.slice(i, i + BATCH_SIZE);
    const payload = batch.map((it) => ({
      id: it.id,
      type: it.sourceType === "rss" ? "news article" : "community post",
      source: it.source,
      published: it.publishedAt,
      title: it.title || undefined,
      text: it.text,
    }));
    try {
      const out = await structured(
        SummarySchema,
        systemPrompt(location),
        `Summarise these ${batch.length} items:\n\n${JSON.stringify(payload, null, 2)}`,
        "low",
      );
      const ids = new Set(batch.map((b) => b.id));
      for (const s of out.items) {
        if (!ids.has(s.id)) continue;
        results.set(s.id, {
          headline: s.headline,
          summary: s.summary,
          category: CATEGORIES.includes(s.category) ? s.category : "other",
          funScore: clamp(s.funScore),
          localScore: clamp(s.localScore),
          emoji: s.emoji,
        });
      }
    } catch (err) {
      logApiError("summarise", err);
      if (isFatal(err)) throw err;
    }
    onBatch?.(results);
  }
  return results;
}

/** Groups items that report the same story (e.g. one event covered by several outlets). */
export async function findSameStories(items, location) {
  const list = items.map((i) => ({ id: i.id, source: i.source, published: i.publishedAt, headline: i.ai.headline, summary: i.ai.summary }));
  const out = await structured(
    StoryGroupsSchema,
    systemPrompt(location),
    `Below are recent items from several news outlets and community pages. Several outlets often cover the same event, and the same article can appear twice.

Group together items that report the same story: the same event, incident, decision or announcement. Follow-up articles with genuinely new developments, or different events on a similar topic, are separate stories. Return only groups of two or more items; leave out items that are unique.

${JSON.stringify(list, null, 2)}`,
    "low",
  );
  const known = new Set(list.map((l) => l.id));
  return out.groups.map((g) => [...new Set(g.ids.filter((id) => known.has(id)))]).filter((g) => g.length > 1);
}

/** A short, upbeat overview of the most interesting recent items. */
export async function buildDigest(items, location) {
  const recent = items
    .filter((i) => i.ai && !i.dupOf && Date.now() - new Date(i.publishedAt) < 2 * 86_400_000)
    .sort((a, b) => b.ai.localScore + b.ai.funScore - (a.ai.localScore + a.ai.funScore))
    .slice(0, 25)
    .map((i) => ({ id: i.id, category: i.ai.category, headline: i.ai.headline, summary: i.ai.summary }));
  if (recent.length === 0) return null;

  const out = await structured(
    DigestSchema,
    systemPrompt(location),
    `Write today's digest for ${location.name} from the summaries below.
- title: a catchy title like "Dette skjer i ${location.name} i dag".
- intro: 2-3 friendly sentences giving the overall picture, like a local radio host.
- highlights: the 3-6 most interesting items (mix serious news with at least one fun one if available), each with its id and a one-line teaser.

${JSON.stringify(recent, null, 2)}`,
    "medium",
  );
  const known = new Set(recent.map((r) => r.id));
  return { ...out, highlights: out.highlights.filter((h) => known.has(h.id)), generatedAt: new Date().toISOString() };
}

function isFatal(err) {
  return err instanceof Anthropic.AuthenticationError || err instanceof Anthropic.PermissionDeniedError;
}

function logApiError(what, err) {
  if (err instanceof Anthropic.AuthenticationError) {
    console.error(`[ai] ${what}: no valid Anthropic credentials (set ANTHROPIC_API_KEY)`);
  } else if (err instanceof Anthropic.RateLimitError) {
    console.error(`[ai] ${what}: rate limited, will retry next refresh`);
  } else if (err instanceof Anthropic.APIError) {
    console.error(`[ai] ${what}: API error ${err.status}: ${err.message}`);
  } else {
    console.error(`[ai] ${what}: ${err.message}`);
  }
}
