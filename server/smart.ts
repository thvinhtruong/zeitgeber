import Anthropic from "@anthropic-ai/sdk";

// Credentials resolve the SDK's usual way (ANTHROPIC_API_KEY, or an
// `ant auth login` profile in local dev). Created lazily so the server boots
// fine without a key — only /assess needs one.
let client: Anthropic | null = null;

export const LETTERS = ["specific", "measurable", "achievable", "relevant", "time_bound"] as const;
type Letter = (typeof LETTERS)[number];

export interface SmartAssessment {
  criteria: Record<Letter, { score: number; feedback: string }>; // score 1-5
  overall: number; // 0-100, derived from the five scores
  summary: string;
  suggestion: string; // the goal rewritten to be fully S.M.A.R.T
}

const criterion = {
  type: "object",
  properties: { score: { type: "integer" }, feedback: { type: "string" } },
  required: ["score", "feedback"],
  additionalProperties: false,
};

const SCHEMA = {
  type: "object",
  properties: {
    ...Object.fromEntries(LETTERS.map((l) => [l, criterion])),
    summary: { type: "string" },
    suggestion: { type: "string" },
  },
  required: [...LETTERS, "summary", "suggestion"],
  additionalProperties: false,
};

const SYSTEM = `You review personal goals against the S.M.A.R.T framework for a self-tracking app.

Score each criterion from 1 (missing) to 5 (fully met):
- specific: is it clear exactly what will be done or achieved?
- measurable: is there a number, threshold, or observable result that shows it's done?
- achievable: is it realistic for one person in the time given? Penalise only clear over-reach, not ambition.
- relevant: does it read as a meaningful goal for its category, with a reason behind it?
- time_bound: is there a deadline or cadence? A target date given separately counts.

For each criterion write one short sentence of feedback addressed to the user ("you"), saying what's missing or what works.
summary: one or two sentences on the goal overall.
suggestion: the goal rewritten as a single S.M.A.R.T sentence, keeping the user's intent and language; if it is already fully S.M.A.R.T, return it lightly tightened.`;

export async function assessGoal(goal: {
  title: string;
  details: string;
  category: string;
  target_date: string | null;
  today: string;
}): Promise<SmartAssessment> {
  client ??= new Anthropic();
  const prompt = [
    `Category: ${goal.category}`,
    `Goal: ${goal.title}`,
    goal.details.trim() ? `Details: ${goal.details.trim()}` : null,
    `Target date: ${goal.target_date ?? "none given"}`,
    `Today: ${goal.today}`,
  ]
    .filter(Boolean)
    .join("\n");

  const res = await client.beta.messages.create({
    model: "claude-opus-5-5",
    max_tokens: 16000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    output_config: { effort: "medium", format: { type: "json_schema", schema: SCHEMA } },
    system: SYSTEM,
    messages: [{ role: "user", content: prompt }],
  });

  if (res.stop_reason === "refusal") throw new Error("the AI declined to assess this goal");
  if (res.stop_reason === "max_tokens") throw new Error("the AI response was cut off");
  const text = res.content.find((b) => b.type === "text");
  if (!text || text.type !== "text") throw new Error("the AI returned no assessment");

  const raw = JSON.parse(text.text);
  const clamp = (n: unknown) => Math.min(5, Math.max(1, Math.round(Number(n) || 1)));
  const criteria = Object.fromEntries(
    LETTERS.map((l) => [l, { score: clamp(raw[l]?.score), feedback: String(raw[l]?.feedback ?? "") }]),
  ) as SmartAssessment["criteria"];
  const sum = LETTERS.reduce((s, l) => s + criteria[l].score, 0);
  return {
    criteria,
    // 5 → 0, 25 → 100: a goal that misses every letter scores 0, not 20
    overall: Math.round(((sum - 5) / 20) * 100),
    summary: String(raw.summary ?? ""),
    suggestion: String(raw.suggestion ?? ""),
  };
}

// A friendlier message for the common setup failure.
export function describeAIError(err: unknown): string {
  if (err instanceof Anthropic.AuthenticationError)
    return "AI is not configured: set ANTHROPIC_API_KEY on the server";
  if (err instanceof Anthropic.RateLimitError) return "AI is rate-limited, try again shortly";
  if (err instanceof Anthropic.APIError) return `AI request failed (${err.status ?? "network"})`;
  if (err instanceof Error && /credentials|api key|apiKey/i.test(err.message))
    return "AI is not configured: set ANTHROPIC_API_KEY on the server";
  return err instanceof Error ? err.message : "AI request failed";
}
