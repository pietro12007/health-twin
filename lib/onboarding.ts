export type OnboardingField =
  | "age"
  | "heartRate"
  | "sleep"
  | "exercise"
  | "stress"
  | "smoker"
  | "concerns";

export const ONBOARDING_FIELDS: readonly OnboardingField[] = [
  "age",
  "heartRate",
  "sleep",
  "exercise",
  "stress",
  "smoker",
  "concerns",
];

export const FIELD_LABELS: Record<OnboardingField, string> = {
  age: "age",
  heartRate: "resting heart rate",
  sleep: "average sleep",
  exercise: "exercise frequency",
  stress: "stress level",
  smoker: "smoking status",
  concerns: "health concerns",
};

export const FIELD_QUESTIONS: Record<OnboardingField, string> = {
  age: "How old are you?",
  heartRate:
    "What's your average resting heart rate? Most phones and smartwatches have been logging this passively — feel free to check.",
  sleep: "On average, how many hours of sleep do you get per night?",
  exercise: "How many days a week do you exercise?",
  stress:
    "On a scale of 1 to 10, how would you rate your typical stress level?",
  smoker: "Do you smoke? You can say yes, no, or former smoker.",
  concerns:
    "Last one — are there any specific health concerns or goals you'd like us to focus on?",
};

export const ONBOARDING_INTRO =
  "Hi, I'm your Digital Health Twin. I'm going to ask you a few questions to build your health profile. Let's start — how old are you?";

export type AnswerResult =
  | { ok: true; value: string }
  | { ok: false; hint: string };

export function parseAnswer(
  field: OnboardingField,
  raw: string,
): AnswerResult {
  const trimmed = raw.trim();
  if (!trimmed) {
    return {
      ok: false,
      hint: "Sorry, I didn't catch that — could you say that again?",
    };
  }

  switch (field) {
    case "age": {
      const n = extractInt(trimmed, 5, 120);
      return n == null
        ? {
            ok: false,
            hint: "Sorry, could you give me your age as a whole number?",
          }
        : { ok: true, value: String(n) };
    }
    case "heartRate": {
      const n = extractInt(trimmed, 30, 220);
      return n == null
        ? {
            ok: false,
            hint: "Could you give me your average heart rate as a number, in beats per minute?",
          }
        : { ok: true, value: String(n) };
    }
    case "sleep": {
      const n = extractFloat(trimmed, 0, 24);
      return n == null
        ? {
            ok: false,
            hint: "Could you give me your average sleep in hours, like 7 or 6.5?",
          }
        : { ok: true, value: String(n) };
    }
    case "exercise": {
      const n = extractInt(trimmed, 0, 7);
      return n == null
        ? {
            ok: false,
            hint: "Could you tell me how many days a week you exercise — a number from 0 to 7?",
          }
        : { ok: true, value: String(n) };
    }
    case "stress": {
      const n = extractInt(trimmed, 1, 10);
      return n == null
        ? {
            ok: false,
            hint: "Could you rate your stress as a number from 1 to 10?",
          }
        : { ok: true, value: String(n) };
    }
    case "smoker": {
      const s = parseSmokingStatus(trimmed);
      return s == null
        ? {
            ok: false,
            hint: "Could you say whether you smoke — yes, no, or former smoker?",
          }
        : { ok: true, value: s };
    }
    case "concerns":
      return { ok: true, value: trimmed.slice(0, 500) };
  }
}

function extractInt(s: string, min: number, max: number): number | null {
  const m = s.match(/-?\d+(?:\.\d+)?/);
  if (!m) return null;
  const n = parseFloat(m[0]);
  if (Number.isNaN(n) || n < min || n > max) return null;
  return Math.round(n);
}

function extractFloat(s: string, min: number, max: number): number | null {
  const m = s.match(/-?\d+(?:\.\d+)?/);
  if (!m) return null;
  const n = parseFloat(m[0]);
  if (Number.isNaN(n) || n < min || n > max) return null;
  return n;
}

function parseSmokingStatus(
  s: string,
): "Yes" | "No" | "Former smoker" | null {
  const lower = s.toLowerCase();
  // Order matters: "I used to smoke" contains "smoke", so check former first.
  if (/\b(former|used to|quit|gave up|stopped|ex[- ]?smoker)\b/.test(lower)) {
    return "Former smoker";
  }
  if (/\b(no|none|never|nope|don'?t|do not|not a smoker)\b/.test(lower)) {
    return "No";
  }
  if (/\b(yes|yeah|yep|yup|smoke|smoker|cigarette|vape|vaping)\b/.test(lower)) {
    return "Yes";
  }
  return null;
}
