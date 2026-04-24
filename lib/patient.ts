export type Sex = "Female" | "Male" | "Non-binary";
export type SmokingStatus = "No" | "Yes" | "Former smoker";

export type SyntheticPatient = {
  age: number;
  gender: Sex;
  bmi: number;
  bloodPressure: { systolic: number; diastolic: number };
  restingHeartRate: number;
  sleepHours: number;
  exerciseDaysPerWeek: number;
  stressLevel: number;
  smokingStatus: SmokingStatus;
  familyHistory: { heartDisease: boolean; diabetes: boolean };
  currentMedications: string[];
};

export type PatientHints = {
  age?: number;
  smokingStatus?: SmokingStatus;
  restingHeartRate?: number;
  sleepHours?: number;
  exerciseDaysPerWeek?: number;
  stressLevel?: number;
};

// FNV-1a 32-bit. Used to derive a deterministic PRNG seed from form inputs
// so the same profile always produces the same synthetic baseline.
export function hashStringToSeed(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

// mulberry32 PRNG — small, fast, good enough for synthetic data.
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const range = (rng: () => number, min: number, max: number) =>
  rng() * (max - min) + min;
const intRange = (rng: () => number, min: number, max: number) =>
  Math.floor(range(rng, min, max + 1));
const pick = <T,>(rng: () => number, opts: readonly T[]) =>
  opts[Math.floor(rng() * opts.length)];
const chance = (rng: () => number, p: number) => rng() < p;
const round1 = (n: number) => Math.round(n * 10) / 10;

export function generatePatient(
  rng: () => number = Math.random,
  hints: PatientHints = {},
): SyntheticPatient {
  const age = hints.age ?? intRange(rng, 25, 75);
  const gender = pick<Sex>(rng, ["Female", "Male", "Non-binary"]);

  const bmi = round1(range(rng, 20, 32));

  const systolicBase = age < 40 ? 115 : age < 55 ? 125 : 135;
  const systolic = intRange(rng, systolicBase - 8, systolicBase + 14);
  const diastolic = intRange(rng, 70, 92);

  const restingHeartRate = hints.restingHeartRate ?? intRange(rng, 58, 88);
  const sleepHours = hints.sleepHours ?? round1(range(rng, 5.5, 8.5));
  const exerciseDaysPerWeek =
    hints.exerciseDaysPerWeek ?? intRange(rng, 0, 6);
  const stressLevel = hints.stressLevel ?? intRange(rng, 2, 9);

  const smokingStatus =
    hints.smokingStatus ??
    pick<SmokingStatus>(rng, [
      "No",
      "No",
      "No",
      "No",
      "Former smoker",
      "Former smoker",
      "Yes",
    ]);

  const familyHistory = {
    heartDisease: chance(rng, 0.3),
    diabetes: chance(rng, 0.25),
  };

  const meds: string[] = [];
  if (systolic >= 135 || diastolic >= 85) {
    meds.push(
      pick(rng, [
        "Lisinopril 10mg daily",
        "Amlodipine 5mg daily",
        "Losartan 50mg daily",
      ]),
    );
  }
  if (familyHistory.heartDisease && age > 45 && chance(rng, 0.6)) {
    meds.push("Atorvastatin 20mg daily");
  }
  if (familyHistory.diabetes && bmi > 28 && chance(rng, 0.5)) {
    meds.push("Metformin 500mg twice daily");
  }
  if (stressLevel >= 7 && chance(rng, 0.4)) {
    meds.push(
      pick(rng, ["Sertraline 50mg daily", "Escitalopram 10mg daily"]),
    );
  }
  if (sleepHours < 6.5 && chance(rng, 0.3)) {
    meds.push("Melatonin 3mg at bedtime");
  }
  if (smokingStatus === "Former smoker" && chance(rng, 0.2)) {
    meds.push("Nicotine replacement (lozenge, 2mg PRN)");
  }
  if (meds.length === 0) {
    meds.push("Multivitamin daily");
  }

  return {
    age,
    gender,
    bmi,
    bloodPressure: { systolic, diastolic },
    restingHeartRate,
    sleepHours,
    exerciseDaysPerWeek,
    stressLevel,
    smokingStatus,
    familyHistory,
    currentMedications: meds,
  };
}
