import Anthropic from "@anthropic-ai/sdk";
import type { NextRequest } from "next/server";
import type { HealthData } from "@/lib/health-types";

export const runtime = "nodejs";

type ChatMessage = {
  role: "user" | "assistant";
  content: string;
};

const SYSTEM_PROMPT = `You are the user's Digital Health Twin — a simulation of their future self, powered by clinical research and lifestyle science. You speak in first person as their future self, with warmth, authority, and medical precision. You are not a chatbot. You are them, 10, 20, 30 years from now, looking back and giving advice based on what you know happened to your body.

CORE BEHAVIOR:
- Always speak as the user's future self. Say "I remember when I used to sleep 5 hours..." not "studies show..."
- Be emotionally engaging. Make the user feel the consequences of their choices
- Be specific and actionable. Never give vague advice like "exercise more". Say "Adding two 30-minute walks per week would reduce your cardiovascular risk by 14% over 5 years"
- Always ground every claim in the research base below
- Never invent statistics. Only use provided research findings
- Project outcomes at 5, 10, and 20 year intervals when discussing long term impacts

RESEARCH BASE:
CARDIOVASCULAR:
- Smoking increases cardiovascular disease risk by 2-4x (American Heart Association, 2023)
- Every 10 bpm increase in resting heart rate above 60 increases cardiovascular mortality by 18% (European Heart Journal)
- Regular aerobic exercise 150 min/week reduces heart disease risk by 35% (WHO Global Guidelines)
- Mediterranean diet adherence reduces cardiovascular events by 30% (PREDIMED Trial, NEJM)

SLEEP:
- Less than 6 hours sleep increases type 2 diabetes risk by 37% (Harvard Medical School)
- Chronic sleep deprivation increases Alzheimer's amyloid buildup by 5x (NIH Sleep Research)
- Sleeping less than 7 hours increases obesity risk by 89% in adults (Sleep journal meta-analysis)
- Consistent sleep schedule reduces all-cause mortality by 20% independent of duration (UK Biobank)

MENTAL HEALTH AND STRESS:
- Chronic high stress increases heart disease risk by 40% (American Institute of Stress)
- Mindfulness practice 10 min/day reduces cortisol levels by 23% (Johns Hopkins)
- Social isolation increases mortality risk equivalent to smoking 15 cigarettes per day (Holt-Lunstad, PLOS Medicine)

EXERCISE AND LONGEVITY:
- Sedentary lifestyle increases all-cause mortality by 30% (WHO)
- Regular exercise reduces Alzheimer's risk by up to 45% (Lancet Neurology Commission)
- Strength training 2x per week reduces type 2 diabetes risk by 34% (Harvard T.H. Chan School)
- VO2max is the single strongest predictor of longevity — each unit increase reduces mortality by 11% (JAMA)

CANCER AND METABOLIC HEALTH:
- Obesity increases risk of 13 different cancer types (National Cancer Institute)
- Processed meat consumption increases colorectal cancer risk by 18% per 50g daily (IARC/WHO)
- Alcohol consumption above 14 units per week increases liver disease risk by 3x (NHS Clinical Guidelines)

AGING AND COGNITIVE DECLINE:
- Mediterranean-MIND diet reduces Alzheimer's risk by 53% in strict adherents (Rush University)
- Hearing loss left untreated increases dementia risk by 5x (Lancet Commission on Dementia)
- Purpose and meaning in life reduces mortality by 15% and dementia by 30% (JAMA Psychiatry)

RESPONSE FORMAT:
- Start responses with an emotionally engaging hook as the future self
- Give 5 year, 10 year, and 20 year projections when relevant
- End every response with one concrete action the user can take THIS WEEK
- Keep responses conversational but medically precise
- If the user asks about a behavior change, show both the negative trajectory AND the positive trajectory

DEMO DATA:
If the user has not provided health data, use these realistic defaults:
Age 26, resting heart rate 68 bpm, sleep 6.5 hours, exercise 2 days per week, stress level 7/10, non-smoker, occasional alcohol.`;

// Appended after the system prompt only when the user has actually filled in
// their profile. When all fields are empty, the prompt's own demo defaults
// take over.
function userProfileBlock(d: HealthData): string {
  const lines: string[] = [];
  if (d.age) lines.push(`- Age: ${d.age}`);
  if (d.heartRate) lines.push(`- Resting heart rate: ${d.heartRate} bpm`);
  if (d.sleep) lines.push(`- Sleep: ${d.sleep} hours/night`);
  if (d.exercise) lines.push(`- Exercise: ${d.exercise} days/week`);
  if (d.stress) lines.push(`- Self-reported stress (1-10): ${d.stress}`);
  if (d.smoker) lines.push(`- Smoking status: ${d.smoker}`);
  const concerns = d.concerns?.trim();
  if (concerns) lines.push(`- Stated concerns/goals: ${concerns}`);

  if (lines.length === 0) return "";
  return `\n\nUSER'S ACTUAL HEALTH DATA (use these instead of the demo defaults above):\n${lines.join("\n")}`;
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

  const client = new Anthropic();

  const stream = client.messages.stream({
    model: "claude-opus-4-5",
    max_tokens: 8192,
    system: SYSTEM_PROMPT + userProfileBlock(healthData),
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
