/**
 * AI classification of free-text feedback: sentiment, themes and a concern flag.
 * Runs from the scheduler tick. Server-only.
 */
import Anthropic from "@anthropic-ai/sdk";
import { createAdminClient } from "@/lib/supabase/admin";
import { raiseConcern } from "@/lib/responses";
import type { Organisation, Response } from "@/lib/types";

export const THEMES = [
  "punctuality",
  "communication",
  "staff attitude",
  "dignity",
  "safety",
  "medication",
  "office responsiveness",
  "booking",
  "explanation of findings",
  "cost",
  "other",
] as const;
export type Theme = (typeof THEMES)[number];

export interface Classification {
  sentiment: "positive" | "neutral" | "negative";
  themes: Theme[];
  concern: boolean;
  concern_reason: string | null;
}

const TOOL_NAME = "record_classification";

const SYSTEM_PROMPT = `You classify short free-text feedback left by clients, relatives, carers, pilots or patients of a small UK care agency, GP-run aviation medical practice or private clinic.

Call the ${TOOL_NAME} tool exactly once with:
- sentiment: positive, neutral or negative (overall tone).
- themes: up to 4 tags from the fixed list that the text actually touches on. Use "other" only when nothing else fits. Empty list is fine for a bare "thanks".
- concern: true if the text contains a complaint, anything about safety or risk, any hint of abuse, neglect or safeguarding, a medication error or medicine problem, an expression of distress, or a request to be contacted or called back. Err towards flagging: a manager reviewing a false alarm costs little; a missed safeguarding concern costs a great deal.
- concern_reason: one plain-English sentence saying why it was flagged, or null when concern is false.`;

function isTheme(value: unknown): value is Theme {
  return typeof value === "string" && (THEMES as readonly string[]).includes(value);
}

function coerce(input: unknown): Classification | null {
  if (!input || typeof input !== "object") return null;
  const obj = input as Record<string, unknown>;
  const sentiment = obj.sentiment;
  if (sentiment !== "positive" && sentiment !== "neutral" && sentiment !== "negative") return null;
  const rawThemes = Array.isArray(obj.themes) ? obj.themes : [];
  const themes: Theme[] = [];
  for (const t of rawThemes) {
    const tag = typeof t === "string" ? t.trim().toLowerCase() : t;
    if (isTheme(tag) && !themes.includes(tag) && themes.length < 4) themes.push(tag);
  }
  const concern = obj.concern === true;
  const reason = typeof obj.concern_reason === "string" && obj.concern_reason.trim() ? obj.concern_reason.trim() : null;
  return { sentiment, themes, concern, concern_reason: concern ? (reason ?? "Flagged for review") : null };
}

/** Classifies one piece of text. Exposed for ad hoc use and tests. */
export async function classifyText(client: Anthropic, model: string, text: string): Promise<Classification> {
  const message = await client.messages.create({
    model,
    max_tokens: 400,
    system: SYSTEM_PROMPT,
    tools: [
      {
        name: TOOL_NAME,
        description: "Record the classification of one piece of feedback.",
        input_schema: {
          type: "object",
          properties: {
            sentiment: { type: "string", enum: ["positive", "neutral", "negative"] },
            themes: { type: "array", maxItems: 4, items: { type: "string", enum: [...THEMES] } },
            concern: { type: "boolean" },
            concern_reason: { type: ["string", "null"] },
          },
          required: ["sentiment", "themes", "concern", "concern_reason"],
        },
      },
    ],
    tool_choice: { type: "tool", name: TOOL_NAME },
    messages: [{ role: "user", content: `Feedback text:\n\n"""\n${text.slice(0, 6000)}\n"""` }],
  });

  for (const block of message.content) {
    if (block.type === "tool_use" && block.name === TOOL_NAME) {
      const parsed = coerce(block.input);
      if (parsed) return parsed;
    }
  }
  throw new Error("Model did not return a usable classification");
}

export async function classifyPendingResponses(limit = 25): Promise<{ processed: number; flagged: number }> {
  const admin = createAdminClient();
  const nowIso = () => new Date().toISOString();

  // Responses with nothing to read: just mark them processed.
  const { data: empty } = await admin
    .from("responses")
    .select("id")
    .is("ai_processed_at", null)
    .is("free_text", null)
    .limit(500);
  const emptyIds = ((empty ?? []) as Array<{ id: string }>).map((r) => r.id);
  if (emptyIds.length > 0) {
    await admin.from("responses").update({ ai_processed_at: nowIso() }).in("id", emptyIds);
  }

  const { data } = await admin
    .from("responses")
    .select("*")
    .is("ai_processed_at", null)
    .not("free_text", "is", null)
    .order("created_at", { ascending: true })
    .limit(limit);
  const pending = (data ?? []) as Response[];
  if (pending.length === 0) return { processed: emptyIds.length, flagged: 0 };

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    // No key: mark as processed so the scheduler does not retry forever.
    await admin
      .from("responses")
      .update({ ai_processed_at: nowIso() })
      .in("id", pending.map((r) => r.id));
    console.warn("[ai] ANTHROPIC_API_KEY not set; skipped classification of", pending.length, "responses");
    return { processed: emptyIds.length + pending.length, flagged: 0 };
  }

  const client = new Anthropic({ apiKey });
  const model = process.env.ANTHROPIC_MODEL ?? "claude-haiku-5-5";
  const orgs = new Map<string, Organisation>();

  let processed = emptyIds.length;
  let flagged = 0;

  for (const r of pending) {
    const text = (r.free_text ?? "").trim();
    if (!text) {
      await admin.from("responses").update({ ai_processed_at: nowIso() }).eq("id", r.id);
      processed++;
      continue;
    }
    try {
      const result = await classifyText(client, model, text);
      await admin
        .from("responses")
        .update({
          sentiment: result.sentiment,
          themes: result.themes,
          concern: r.concern || result.concern,
          concern_reason: result.concern ? result.concern_reason : r.concern_reason,
          ai_processed_at: nowIso(),
        })
        .eq("id", r.id);
      processed++;

      if (result.concern) {
        let org = orgs.get(r.organisation_id);
        if (!org) {
          const { data: o } = await admin.from("organisations").select("*").eq("id", r.organisation_id).single();
          if (o) {
            org = o as Organisation;
            orgs.set(org.id, org);
          }
        }
        if (org) {
          await raiseConcern(org, r.id, "ai_flag", result.concern_reason ?? "Flagged by AI review");
          flagged++;
        }
      }
    } catch (e) {
      // Leave ai_processed_at null so a transient API failure is retried next tick.
      console.error(`[ai] classification failed for response ${r.id}:`, e instanceof Error ? e.message : e);
    }
  }

  return { processed, flagged };
}
