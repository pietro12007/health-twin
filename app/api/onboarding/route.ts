import Anthropic from "@anthropic-ai/sdk";
import type { NextRequest } from "next/server";
import { FIELD_LABELS, type OnboardingField } from "@/lib/onboarding";

export const runtime = "nodejs";

type Body = {
  collected?: Record<string, string>;
  field?: OnboardingField;
  value?: string;
  nextQuestion?: string | null;
};

export async function POST(request: NextRequest) {
  if (!process.env.ANTHROPIC_API_KEY) {
    return Response.json(
      { error: "ANTHROPIC_API_KEY is not configured on the server." },
      { status: 500 },
    );
  }

  let body: Body;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const { collected = {}, field, value, nextQuestion } = body;
  if (!field || typeof value !== "string") {
    return Response.json(
      { error: "Request must include field and value." },
      { status: 400 },
    );
  }

  const fieldLabel = FIELD_LABELS[field] ?? field;

  const systemPrompt = `You are the user's Digital Health Twin, conducting a brief, warm, conversational health onboarding — the first 30 seconds of a real consultation.

Format strictly:
- Two short sentences. No markdown, no headers, no preambles, no emoji, no lists.
- Plain conversational prose, second person.

Sentence 1 — Acknowledge their ${fieldLabel} ("${value}") naturally and warmly. Vary your opener across questions (don't always start with "Got it"). When relevant, you may add a brief observation grounded in well-established medical or behavioural research — for example, that short habitual sleep is associated with cardiometabolic risk in large cohorts; that even modest weekly exercise is associated with substantial all-cause mortality reductions; that chronic high stress contributes to allostatic load. Keep it human, never clinical, never alarmist, never diagnostic.

Sentence 2 — ${
    nextQuestion
      ? `Ask the next question. The exact question to convey: "${nextQuestion}". Phrase it naturally as part of the conversation; you may rephrase but you MUST preserve the intent and any specific guidance (such as suggesting they check a phone or watch for heart rate, or offering "yes / no / former smoker" framing).`
      : `Tell them you have everything you need and you're going to build their Digital Twin now. Make it feel like a real consultation wrapping up. Keep it to one short sentence. Do NOT ask another question.`
  }

Profile collected so far (for your context — do NOT list it back to them): ${JSON.stringify(collected)}.

Output ONLY the two sentences as plain text. No surrounding quotes, no prefix labels, no markdown.`;

  const client = new Anthropic();

  const stream = client.messages.stream({
    model: "claude-opus-4-7",
    max_tokens: 256,
    system: systemPrompt,
    messages: [{ role: "user", content: value }],
  });

  const encoder = new TextEncoder();
  const readable = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        for await (const event of stream) {
          if (
            event.type === "content_block_delta" &&
            event.delta.type === "text_delta"
          ) {
            controller.enqueue(encoder.encode(event.delta.text));
          }
        }
        controller.close();
      } catch (err) {
        const message = err instanceof Error ? err.message : "stream error";
        controller.enqueue(encoder.encode(`\n\n[stream error: ${message}]`));
        controller.close();
      }
    },
  });

  return new Response(readable, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
}
