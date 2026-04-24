import Anthropic from "@anthropic-ai/sdk";
import type { NextRequest } from "next/server";
import {
  generatePatient,
  hashStringToSeed,
  mulberry32,
  type SmokingStatus,
  type SyntheticPatient,
} from "@/lib/patient";

export const runtime = "nodejs";

type HealthData = {
  age: string;
  heartRate: string;
  sleep: string;
  exercise: string;
  stress: string;
  smoker: string;
  concerns?: string;
};

type ChatMessage = {
  role: "user" | "assistant";
  content: string;
};

function parseIntOrUndefined(v: string): number | undefined {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : undefined;
}

function parseFloatOrUndefined(v: string): number | undefined {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : undefined;
}

function asSmokingStatus(v: string): SmokingStatus | undefined {
  return v === "No" || v === "Yes" || v === "Former smoker" ? v : undefined;
}

// Seeded so identical form inputs always produce the same synthetic baseline,
// keeping projections consistent across turns of the same conversation.
function buildBaseline(d: HealthData): SyntheticPatient {
  const seed = hashStringToSeed(JSON.stringify(d));
  const rng = mulberry32(seed);
  return generatePatient(rng, {
    age: parseIntOrUndefined(d.age),
    smokingStatus: asSmokingStatus(d.smoker),
    restingHeartRate: parseIntOrUndefined(d.heartRate),
    sleepHours: parseFloatOrUndefined(d.sleep),
    exerciseDaysPerWeek: parseIntOrUndefined(d.exercise),
    stressLevel: parseIntOrUndefined(d.stress),
  });
}

function buildSystemPrompt(d: HealthData, b: SyntheticPatient): string {
  const userProvidedLines = [
    `- Age: ${d.age || "(not provided)"}`,
    `- Resting heart rate: ${d.heartRate || "(not provided)"} bpm`,
    `- Sleep: ${d.sleep || "(not provided)"} hours/night`,
    `- Exercise: ${d.exercise || "(not provided)"} days/week`,
    `- Self-reported stress (1–10): ${d.stress || "(not provided)"}`,
    `- Smoking status: ${d.smoker || "(not provided)"}`,
  ];
  const concerns = d.concerns?.trim();
  if (concerns) {
    userProvidedLines.push(`- Stated concerns / goals: ${concerns}`);
  }
  const userProvided = userProvidedLines.join("\n");

  const assumed = [
    `- Gender: ${b.gender}`,
    `- BMI: ${b.bmi}`,
    `- Blood pressure: ${b.bloodPressure.systolic}/${b.bloodPressure.diastolic} mmHg`,
    `- Family history of heart disease: ${b.familyHistory.heartDisease ? "Yes" : "No"}`,
    `- Family history of type 2 diabetes: ${b.familyHistory.diabetes ? "Yes" : "No"}`,
    `- Current medications: ${b.currentMedications.join(", ")}`,
  ].join("\n");

  return `You are the user's Digital Health Twin — a personalised health-projection assistant grounded in current peer-reviewed medical research (cardiology, sleep medicine, exercise physiology, behavioural and preventive medicine).

Voice and approach:
- Speak directly to the user in a warm, concrete, second-person voice.
- Project how their current habits are likely to shape their health 1, 5, 10, and 20 years from now, drawing on established risk frameworks where relevant (e.g. ACC/AHA cardiovascular risk, Framingham, sleep-debt and all-cause mortality cohorts, MET-minutes and exercise-dose research, allostatic-load research on chronic stress).
- Translate findings into specific, achievable changes tailored to *their* numbers — not generic advice.
- When the user asks "what if I changed X", respond with a concrete comparative projection (current trajectory vs. modified trajectory) and the rough magnitude of effect supported by the literature.
- Reference the *type* of evidence (meta-analysis, RCT, large prospective cohort, longitudinal cohort) without inventing specific paper titles, author names, or DOIs.
- Be honest about uncertainty. Where the evidence is mixed or the user's data is sparse, say so.

Safety:
- You are not a replacement for medical care. If the user describes acute or red-flag symptoms (chest pain, severe shortness of breath, neurological changes, suicidal ideation, etc.), tell them clearly to seek urgent in-person medical evaluation and do not attempt to diagnose.

The user's current health profile:

User-provided values (treat as ground truth):
${userProvided}

Estimated baseline (model-generated assumptions to round out the profile — treat as plausible defaults rather than confirmed facts; ask the user if a value seems likely to materially change the projection):
${assumed}

Use the full profile to make every answer specific. Numbers, projections, and recommendations should reference these actual values — no generic advice. When the user corrects an assumed value, integrate the correction immediately and adjust subsequent projections.`;
}

export async function POST(request: NextRequest) {
  if (!process.env.ANTHROPIC_API_KEY) {
    return Response.json(
      { error: "ANTHROPIC_API_KEY is not configured on the server." },
      { status: 500 },
    );
  }

  let body: { healthData?: HealthData; messages?: ChatMessage[] };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const { healthData, messages } = body;
  if (!healthData || !Array.isArray(messages) || messages.length === 0) {
    return Response.json(
      { error: "Request must include healthData and a non-empty messages array." },
      { status: 400 },
    );
  }

  const baseline = buildBaseline(healthData);

  const client = new Anthropic();

  const stream = client.messages.stream({
    model: "claude-opus-4-7",
    max_tokens: 8192,
    system: buildSystemPrompt(healthData, baseline),
    messages: messages.map((m) => ({ role: m.role, content: m.content })),
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
