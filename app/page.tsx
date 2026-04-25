"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { FormEvent, ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  FIELD_QUESTIONS,
  ONBOARDING_FIELDS,
  ONBOARDING_INTRO,
  parseAnswer,
  type OnboardingField,
} from "@/lib/onboarding";
import HealthDashboard from "@/components/HealthDashboard";
import AgingFace from "@/components/AgingFace";
import type { HealthData } from "@/lib/health-types";

// Web Speech API SpeechRecognition isn't in lib.dom.d.ts — declare what we use.
type SpeechRecognitionAlt = { transcript: string; confidence: number };
type SpeechRecognitionResult = {
  isFinal: boolean;
  length: number;
  [index: number]: SpeechRecognitionAlt;
};
type SpeechRecognitionResultList = {
  length: number;
  [index: number]: SpeechRecognitionResult;
};
type SpeechRecognitionEventLike = {
  results: SpeechRecognitionResultList;
  resultIndex: number;
};
type SpeechRecognitionErrorEventLike = { error: string; message?: string };

interface SpeechRecognitionLike {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: SpeechRecognitionErrorEventLike) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}

type SpeechRecognitionConstructor = new () => SpeechRecognitionLike;

function getSpeechRecognition(): SpeechRecognitionConstructor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    SpeechRecognition?: SpeechRecognitionConstructor;
    webkitSpeechRecognition?: SpeechRecognitionConstructor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

const noopSubscribe = () => () => {};
const getSpeechRecognitionSupportedClient = () =>
  getSpeechRecognition() !== null;
const getSpeechSynthesisSupportedClient = () =>
  typeof window !== "undefined" && "speechSynthesis" in window;
const getCapabilityServerSnapshot = () => false;

function stripMarkdownForTTS(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/^\s*#{1,6}\s+/gm, "")
    .replace(/^\s*>\s+/gm, "")
    .replace(/[*_~]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

// Chrome's SpeechSynthesis cuts off long utterances around ~15s. Splitting
// into sentence-sized chunks works around it and gives smoother pacing.
function chunkForTTS(text: string): string[] {
  const cleaned = stripMarkdownForTTS(text);
  if (!cleaned) return [];
  const sentences = cleaned.match(/[^.!?]+[.!?]+|\S+[^.!?]*$/g) ?? [cleaned];
  const chunks: string[] = [];
  let current = "";
  for (const s of sentences) {
    const candidate = current ? `${current} ${s}` : s;
    if (candidate.length > 220 && current) {
      chunks.push(current.trim());
      current = s.trim();
    } else {
      current = candidate.trim();
    }
  }
  if (current) chunks.push(current.trim());
  return chunks;
}

type ChatMessage = {
  role: "user" | "assistant";
  content: string;
};

type CollectedAnswers = Partial<Record<OnboardingField, string>>;

type View = "onboarding" | "building" | "dashboard" | "chat";

const KICKOFF_PROMPT =
  "Now that you've got my profile, give me a personalised, evidence-based snapshot of where my current habits are likely to take my health over the next 5–20 years. Anchor it in my actual numbers, weight it toward the concerns I just shared, and end with three concrete next steps.";

const BUILDING_PHASES = [
  "Loading your health profile…",
  "Calibrating baseline metrics…",
  "Cross-referencing the medical literature…",
  "Projecting long-term trajectories…",
];

function buildHealthDataFromCollected(c: CollectedAnswers): HealthData {
  return {
    age: c.age ?? "",
    heartRate: c.heartRate ?? "",
    sleep: c.sleep ?? "",
    exercise: c.exercise ?? "",
    stress: c.stress ?? "",
    smoker: c.smoker ?? "No",
    concerns: c.concerns ?? "",
  };
}

const initialHealthData: HealthData = buildHealthDataFromCollected({});

export default function Home() {
  const [view, setView] = useState<View>("onboarding");
  const [healthData, setHealthData] = useState<HealthData>(initialHealthData);

  // Onboarding state
  const [collected, setCollected] = useState<CollectedAnswers>({});
  const [stepIndex, setStepIndex] = useState(0);
  const [onboardingMessages, setOnboardingMessages] = useState<ChatMessage[]>([
    { role: "assistant", content: ONBOARDING_INTRO },
  ]);

  // Chat state
  const [messages, setMessages] = useState<ChatMessage[]>([]);

  // Shared composer + voice state
  const [input, setInput] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isMuted, setIsMuted] = useState(false);
  const [isRecording, setIsRecording] = useState(false);

  // Building animation
  const [buildingPhase, setBuildingPhase] = useState(0);

  const speechRecognitionSupported = useSyncExternalStore(
    noopSubscribe,
    getSpeechRecognitionSupportedClient,
    getCapabilityServerSnapshot,
  );
  const speechSynthesisSupported = useSyncExternalStore(
    noopSubscribe,
    getSpeechSynthesisSupportedClient,
    getCapabilityServerSnapshot,
  );

  const onboardingScrollRef = useRef<HTMLDivElement>(null);
  const chatScrollRef = useRef<HTMLDivElement>(null);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const mutedRef = useRef(false);

  useEffect(() => {
    const el =
      view === "onboarding"
        ? onboardingScrollRef.current
        : view === "chat"
          ? chatScrollRef.current
          : null;
    if (el) el.scrollTop = el.scrollHeight;
  }, [view, onboardingMessages, messages]);

  useEffect(() => {
    return () => {
      recognitionRef.current?.abort();
      recognitionRef.current = null;
      if (typeof window !== "undefined") {
        window.speechSynthesis?.cancel();
      }
    };
  }, []);

  useEffect(() => {
    mutedRef.current = isMuted;
    if (isMuted && typeof window !== "undefined") {
      window.speechSynthesis?.cancel();
    }
  }, [isMuted]);

  // Speak the intro on mount. Some browsers (Safari) gate speechSynthesis
  // behind a user gesture and will silently no-op the first call.
  const introSpokenRef = useRef(false);
  useEffect(() => {
    if (introSpokenRef.current) return;
    introSpokenRef.current = true;
    if (!mutedRef.current) {
      speakText(ONBOARDING_INTRO);
    }
  }, []);

  // Cycle the subtext on the building screen.
  useEffect(() => {
    if (view !== "building") return;
    const id = setInterval(() => {
      setBuildingPhase((p) => (p + 1) % BUILDING_PHASES.length);
    }, 700);
    return () => clearInterval(id);
  }, [view]);

  function speakText(text: string) {
    if (typeof window === "undefined") return;
    const synth = window.speechSynthesis;
    if (!synth) return;
    const chunks = chunkForTTS(text);
    if (chunks.length === 0) return;
    synth.cancel();
    for (const chunk of chunks) {
      const utterance = new SpeechSynthesisUtterance(chunk);
      utterance.rate = 1.0;
      utterance.pitch = 1.0;
      synth.speak(utterance);
    }
  }

  function startRecording() {
    const SR = getSpeechRecognition();
    if (!SR) return;
    if (typeof window !== "undefined") {
      window.speechSynthesis?.cancel();
    }
    const recognition = new SR();
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.lang = "en-US";

    recognition.onresult = (event) => {
      let transcript = "";
      for (let i = 0; i < event.results.length; i++) {
        const result = event.results[i];
        const alt = result[0];
        if (alt) transcript += alt.transcript;
      }
      setInput(transcript);
    };

    recognition.onerror = (event) => {
      if (event.error !== "aborted" && event.error !== "no-speech") {
        setError(`Voice input error: ${event.error}`);
      }
      setIsRecording(false);
    };

    recognition.onend = () => {
      setIsRecording(false);
      recognitionRef.current = null;
    };

    recognitionRef.current = recognition;
    setInput("");
    setError(null);
    setIsRecording(true);
    try {
      recognition.start();
    } catch {
      setIsRecording(false);
      recognitionRef.current = null;
    }
  }

  function stopRecording() {
    recognitionRef.current?.stop();
  }

  async function streamOnboardingReply(
    nextCollected: CollectedAnswers,
    field: OnboardingField,
    value: string,
    isLast: boolean,
  ): Promise<string> {
    const nextQuestion = isLast
      ? null
      : FIELD_QUESTIONS[ONBOARDING_FIELDS[stepIndex + 1]];

    setIsStreaming(true);
    setError(null);
    setOnboardingMessages((prev) => [
      ...prev,
      { role: "assistant", content: "" },
    ]);

    if (typeof window !== "undefined") {
      window.speechSynthesis?.cancel();
    }

    let acc = "";
    try {
      const res = await fetch("/api/onboarding", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          collected: nextCollected,
          field,
          value,
          nextQuestion,
        }),
      });

      if (!res.ok || !res.body) {
        const text = await res.text().catch(() => "");
        throw new Error(text || `Request failed (${res.status})`);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      while (true) {
        const { value: chunk, done } = await reader.read();
        if (done) break;
        acc += decoder.decode(chunk, { stream: true });
        setOnboardingMessages((prev) => {
          const copy = prev.slice();
          copy[copy.length - 1] = { role: "assistant", content: acc };
          return copy;
        });
      }

      if (!mutedRef.current && acc.trim()) {
        speakText(acc);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
      setOnboardingMessages((prev) => prev.slice(0, -1));
      throw e;
    } finally {
      setIsStreaming(false);
    }
    return acc;
  }

  async function handleOnboardingSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (isRecording) stopRecording();
    if (isStreaming) return;
    const raw = input.trim();
    if (!raw) return;

    const field = ONBOARDING_FIELDS[stepIndex];
    setInput("");
    setOnboardingMessages((prev) => [...prev, { role: "user", content: raw }]);

    const result = parseAnswer(field, raw);
    if (!result.ok) {
      setOnboardingMessages((prev) => [
        ...prev,
        { role: "assistant", content: result.hint },
      ]);
      if (!mutedRef.current) speakText(result.hint);
      return;
    }

    const nextCollected: CollectedAnswers = {
      ...collected,
      [field]: result.value,
    };
    setCollected(nextCollected);

    const isLast = stepIndex === ONBOARDING_FIELDS.length - 1;

    try {
      await streamOnboardingReply(nextCollected, field, result.value, isLast);
    } catch {
      // streamOnboardingReply already surfaced the error and rolled back.
      return;
    }

    if (isLast) {
      void transitionToChat(nextCollected);
    } else {
      setStepIndex((i) => i + 1);
    }
  }

  async function transitionToChat(finalCollected: CollectedAnswers) {
    const newHealthData = buildHealthDataFromCollected(finalCollected);
    setHealthData(newHealthData);
    setView("building");
    setBuildingPhase(0);

    await new Promise((r) => setTimeout(r, 3000));

    setView("dashboard");
  }

  function handleDashboardContinue() {
    setView("chat");
    setMessages([]);
    void streamChatReply(
      [{ role: "user", content: KICKOFF_PROMPT }],
      healthData,
    );
  }

  async function streamChatReply(
    history: ChatMessage[],
    dataOverride?: HealthData,
  ) {
    const data = dataOverride ?? healthData;
    setIsStreaming(true);
    setError(null);
    setMessages([...history, { role: "assistant", content: "" }]);

    if (typeof window !== "undefined") {
      window.speechSynthesis?.cancel();
    }

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ healthData: data, messages: history }),
      });

      if (!res.ok || !res.body) {
        const text = await res.text().catch(() => "");
        throw new Error(text || `Request failed (${res.status})`);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let acc = "";
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        acc += decoder.decode(value, { stream: true });
        setMessages((prev) => {
          const copy = prev.slice();
          copy[copy.length - 1] = { role: "assistant", content: acc };
          return copy;
        });
      }

      if (!mutedRef.current && acc.trim()) {
        speakText(acc);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
      setMessages((prev) => prev.slice(0, -1));
    } finally {
      setIsStreaming(false);
    }
  }

  async function handleChatSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (isRecording) stopRecording();
    const text = input.trim();
    if (!text || isStreaming) return;
    setInput("");
    await streamChatReply([...messages, { role: "user", content: text }]);
  }

  function restart() {
    if (typeof window !== "undefined") {
      window.speechSynthesis?.cancel();
    }
    recognitionRef.current?.abort();
    recognitionRef.current = null;
    setIsRecording(false);
    setInput("");
    setError(null);
    setMessages([]);
    setHealthData(initialHealthData);
    setCollected({});
    setStepIndex(0);
    setOnboardingMessages([
      { role: "assistant", content: ONBOARDING_INTRO },
    ]);
    introSpokenRef.current = false;
    setView("onboarding");
  }

  // ----- Onboarding view -----
  if (view === "onboarding") {
    return (
      <main className="min-h-screen bg-gray-950 text-white flex flex-col">
        <header className="border-b border-gray-800 bg-gray-950/80 backdrop-blur sticky top-0 z-10">
          <div className="max-w-3xl mx-auto px-6 py-4 flex items-center justify-between">
            <div>
              <h1 className="text-xl font-semibold text-blue-400">
                My Future Health
              </h1>
              <p className="text-xs text-gray-500">
                Building your health profile · question{" "}
                {Math.min(stepIndex + 1, ONBOARDING_FIELDS.length)} of{" "}
                {ONBOARDING_FIELDS.length}
              </p>
            </div>
            {speechSynthesisSupported && (
              <MuteButton
                isMuted={isMuted}
                onToggle={() => setIsMuted((m) => !m)}
              />
            )}
          </div>
          <ProgressBar
            value={
              Math.min(stepIndex, ONBOARDING_FIELDS.length) /
              ONBOARDING_FIELDS.length
            }
          />
        </header>

        <div ref={onboardingScrollRef} className="flex-1 overflow-y-auto">
          <div className="max-w-3xl mx-auto px-6 py-6 space-y-4">
            {onboardingMessages.map((m, i) => (
              <MessageBubble key={i} message={m} />
            ))}
            {isStreaming &&
              onboardingMessages.length > 0 &&
              onboardingMessages[onboardingMessages.length - 1].role ===
                "assistant" &&
              onboardingMessages[onboardingMessages.length - 1].content ===
                "" && <TypingDots />}
            {error && <ErrorBanner message={error} />}
          </div>
        </div>

        <footer className="border-t border-gray-800 bg-gray-950">
          <Composer
            input={input}
            onInputChange={setInput}
            onSubmit={handleOnboardingSubmit}
            isStreaming={isStreaming}
            isRecording={isRecording}
            onMicClick={isRecording ? stopRecording : startRecording}
            speechRecognitionSupported={speechRecognitionSupported}
            placeholder={
              isRecording
                ? "Listening…"
                : "Type your answer, or tap the mic to speak…"
            }
            submitLabel="Send"
          />
        </footer>
      </main>
    );
  }

  // ----- Building view -----
  if (view === "building") {
    return (
      <main className="min-h-screen bg-gray-950 text-white flex items-center justify-center px-6">
        <div className="flex flex-col items-center gap-8 text-center">
          <div className="relative w-32 h-32">
            <div className="absolute inset-0 rounded-full bg-gradient-to-br from-blue-500 via-cyan-400 to-blue-600 opacity-70 blur-2xl animate-pulse" />
            <div className="absolute inset-2 rounded-full bg-gradient-to-br from-blue-400 via-cyan-300 to-blue-500 animate-spin-slow" />
            <div className="absolute inset-6 rounded-full bg-gray-950 flex items-center justify-center">
              <div className="w-3 h-3 rounded-full bg-cyan-300 animate-pulse" />
            </div>
          </div>
          <div>
            <h2 className="text-2xl font-semibold text-white">
              Building your Digital Twin…
            </h2>
            <p className="text-gray-400 mt-2 min-h-[1.5em] transition-opacity">
              {BUILDING_PHASES[buildingPhase]}
            </p>
          </div>
        </div>
        <style jsx>{`
          @keyframes spin-slow {
            from {
              transform: rotate(0deg);
            }
            to {
              transform: rotate(360deg);
            }
          }
          .animate-spin-slow {
            animation: spin-slow 4s linear infinite;
          }
        `}</style>
      </main>
    );
  }

  // ----- Dashboard view -----
  if (view === "dashboard") {
    return (
      <HealthDashboard
        healthData={healthData}
        onContinue={handleDashboardContinue}
      />
    );
  }

  // ----- Chat view -----
  const lastMessage = messages[messages.length - 1];
  const latestAssistantText =
    lastMessage && lastMessage.role === "assistant" ? lastMessage.content : "";

  return (
    <main className="min-h-screen bg-gray-950 text-white flex flex-col">
      <header className="border-b border-gray-800 bg-gray-950/80 backdrop-blur sticky top-0 z-10">
        <div className="max-w-3xl mx-auto px-6 py-4 flex items-center justify-between gap-4">
          <div className="min-w-0">
            <h1 className="text-xl font-semibold text-blue-400">
              My Future Health
            </h1>
            <p className="text-xs text-gray-500 truncate">
              Age {healthData.age || "—"} · HR {healthData.heartRate || "—"} bpm
              · Sleep {healthData.sleep || "—"}h · Exercise{" "}
              {healthData.exercise || "—"}×/wk · Stress{" "}
              {healthData.stress || "—"}/10 · {healthData.smoker || "—"}
              {healthData.concerns
                ? ` · Focus: ${healthData.concerns}`
                : ""}
            </p>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            {speechSynthesisSupported && (
              <MuteButton
                isMuted={isMuted}
                onToggle={() => setIsMuted((m) => !m)}
              />
            )}
            <button
              onClick={restart}
              className="text-sm text-gray-400 hover:text-white transition px-2 py-1"
            >
              Restart
            </button>
          </div>
        </div>
      </header>

      <div ref={chatScrollRef} className="flex-1 overflow-y-auto">
        <div className="max-w-3xl mx-auto px-6 pt-8 pb-6">
          <AgingFace
            healthData={healthData}
            latestAssistantText={latestAssistantText}
          />
        </div>
        <div className="max-w-3xl mx-auto px-6 pb-6 space-y-4">
          {messages.map((m, i) => (
            <MessageBubble key={i} message={m} />
          ))}
          {isStreaming &&
            messages.length > 0 &&
            messages[messages.length - 1].role === "assistant" &&
            messages[messages.length - 1].content === "" && <TypingDots />}
          {error && <ErrorBanner message={error} />}
        </div>
      </div>

      <footer className="border-t border-gray-800 bg-gray-950">
        <Composer
          input={input}
          onInputChange={setInput}
          onSubmit={handleChatSubmit}
          isStreaming={isStreaming}
          isRecording={isRecording}
          onMicClick={isRecording ? stopRecording : startRecording}
          speechRecognitionSupported={speechRecognitionSupported}
          placeholder={
            isRecording ? "Listening…" : "Ask your Digital Twin anything…"
          }
          submitLabel="Send"
        />
      </footer>
    </main>
  );
}

// ---------- Subcomponents ----------

type ComposerProps = {
  input: string;
  onInputChange: (v: string) => void;
  onSubmit: (e: FormEvent<HTMLFormElement>) => void;
  isStreaming: boolean;
  isRecording: boolean;
  onMicClick: () => void;
  speechRecognitionSupported: boolean;
  placeholder: string;
  submitLabel: string;
};

function Composer({
  input,
  onInputChange,
  onSubmit,
  isStreaming,
  isRecording,
  onMicClick,
  speechRecognitionSupported,
  placeholder,
  submitLabel,
}: ComposerProps) {
  return (
    <form
      onSubmit={onSubmit}
      className="max-w-3xl mx-auto px-6 py-4 flex gap-2 items-stretch"
    >
      <input
        type="text"
        value={input}
        onChange={(e) => onInputChange(e.target.value)}
        placeholder={placeholder}
        disabled={isStreaming}
        className="flex-1 p-3 rounded-lg bg-gray-900 text-white border border-gray-800 focus:outline-none focus:border-blue-400 disabled:opacity-50"
      />
      {speechRecognitionSupported && (
        <button
          type="button"
          onClick={onMicClick}
          disabled={isStreaming}
          title={isRecording ? "Stop recording" : "Record voice message"}
          aria-label={isRecording ? "Stop recording" : "Record voice message"}
          aria-pressed={isRecording}
          className={
            isRecording
              ? "px-3 bg-red-600 hover:bg-red-700 rounded-lg text-white transition animate-pulse"
              : "px-3 bg-gray-800 hover:bg-gray-700 rounded-lg text-gray-200 transition disabled:opacity-50 disabled:cursor-not-allowed"
          }
        >
          <MicIcon />
        </button>
      )}
      <button
        type="submit"
        disabled={isStreaming || input.trim() === ""}
        className="px-5 py-3 bg-blue-500 hover:bg-blue-600 disabled:bg-gray-700 disabled:text-gray-400 disabled:cursor-not-allowed rounded-lg font-semibold text-white transition"
      >
        {submitLabel}
      </button>
    </form>
  );
}

function MuteButton({
  isMuted,
  onToggle,
}: {
  isMuted: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      title={isMuted ? "Unmute voice output" : "Mute voice output"}
      aria-label={isMuted ? "Unmute voice output" : "Mute voice output"}
      aria-pressed={isMuted}
      className="p-2 rounded-lg text-gray-400 hover:text-white hover:bg-gray-800 transition"
    >
      {isMuted ? <VolumeMutedIcon /> : <VolumeOnIcon />}
    </button>
  );
}

function ProgressBar({ value }: { value: number }) {
  return (
    <div className="h-1 bg-gray-900">
      <div
        className="h-full bg-blue-500 transition-all duration-500 ease-out"
        style={{ width: `${Math.max(0, Math.min(1, value)) * 100}%` }}
      />
    </div>
  );
}

function TypingDots() {
  return (
    <div className="flex">
      <div className="bg-gray-900 border border-gray-800 rounded-2xl px-4 py-3 text-gray-400">
        <span className="inline-flex gap-1">
          <Dot delay="0ms" />
          <Dot delay="150ms" />
          <Dot delay="300ms" />
        </span>
      </div>
    </div>
  );
}

function ErrorBanner({ message }: { message: string }) {
  return (
    <div className="bg-red-950/50 border border-red-800 text-red-200 rounded-lg p-3 text-sm">
      {message}
    </div>
  );
}

function MessageBubble({ message }: { message: ChatMessage }) {
  const isUser = message.role === "user";
  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
      <div
        className={
          isUser
            ? "bg-blue-600 text-white rounded-2xl px-4 py-3 max-w-[80%] whitespace-pre-wrap"
            : "bg-gray-900 border border-gray-800 text-gray-100 rounded-2xl px-4 py-3 max-w-[85%] leading-relaxed"
        }
      >
        {isUser ? message.content : <AssistantMarkdown text={message.content} />}
      </div>
    </div>
  );
}

function AssistantMarkdown({ text }: { text: string }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        h1: ({ children }: { children?: ReactNode }) => (
          <h1 className="text-xl font-semibold text-white mt-3 mb-2 first:mt-0">
            {children}
          </h1>
        ),
        h2: ({ children }: { children?: ReactNode }) => (
          <h2 className="text-lg font-semibold text-white mt-3 mb-2 first:mt-0">
            {children}
          </h2>
        ),
        h3: ({ children }: { children?: ReactNode }) => (
          <h3 className="text-base font-semibold text-blue-300 mt-3 mb-1 first:mt-0">
            {children}
          </h3>
        ),
        h4: ({ children }: { children?: ReactNode }) => (
          <h4 className="text-sm font-semibold text-blue-300 mt-3 mb-1 first:mt-0 uppercase tracking-wide">
            {children}
          </h4>
        ),
        p: ({ children }: { children?: ReactNode }) => (
          <p className="my-2 first:mt-0 last:mb-0">{children}</p>
        ),
        ul: ({ children }: { children?: ReactNode }) => (
          <ul className="list-disc pl-5 my-2 space-y-1">{children}</ul>
        ),
        ol: ({ children }: { children?: ReactNode }) => (
          <ol className="list-decimal pl-5 my-2 space-y-1">{children}</ol>
        ),
        li: ({ children }: { children?: ReactNode }) => (
          <li className="leading-relaxed">{children}</li>
        ),
        strong: ({ children }: { children?: ReactNode }) => (
          <strong className="font-semibold text-white">{children}</strong>
        ),
        em: ({ children }: { children?: ReactNode }) => (
          <em className="italic">{children}</em>
        ),
        a: ({
          children,
          href,
        }: {
          children?: ReactNode;
          href?: string;
        }) => (
          <a
            href={href}
            target="_blank"
            rel="noreferrer noopener"
            className="text-blue-400 underline underline-offset-2 hover:text-blue-300"
          >
            {children}
          </a>
        ),
        blockquote: ({ children }: { children?: ReactNode }) => (
          <blockquote className="border-l-2 border-gray-700 pl-3 my-2 text-gray-300 italic">
            {children}
          </blockquote>
        ),
        code: ({
          inline,
          children,
        }: {
          inline?: boolean;
          children?: ReactNode;
        }) =>
          inline ? (
            <code className="bg-gray-800 text-blue-200 rounded px-1 py-0.5 text-[0.9em] font-mono">
              {children}
            </code>
          ) : (
            <code className="font-mono text-[0.9em]">{children}</code>
          ),
        pre: ({ children }: { children?: ReactNode }) => (
          <pre className="bg-gray-950 border border-gray-800 rounded-lg p-3 my-2 overflow-x-auto text-sm">
            {children}
          </pre>
        ),
        hr: () => <hr className="border-gray-800 my-4" />,
        table: ({ children }: { children?: ReactNode }) => (
          <div className="overflow-x-auto my-2">
            <table className="min-w-full text-sm border-collapse">
              {children}
            </table>
          </div>
        ),
        th: ({ children }: { children?: ReactNode }) => (
          <th className="border border-gray-800 bg-gray-800 px-2 py-1 text-left font-semibold">
            {children}
          </th>
        ),
        td: ({ children }: { children?: ReactNode }) => (
          <td className="border border-gray-800 px-2 py-1 align-top">
            {children}
          </td>
        ),
      }}
    >
      {text}
    </ReactMarkdown>
  );
}

function Dot({ delay }: { delay: string }) {
  return (
    <span
      className="inline-block w-2 h-2 rounded-full bg-gray-500 animate-bounce"
      style={{ animationDelay: delay }}
    />
  );
}

function MicIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="w-5 h-5"
      aria-hidden="true"
    >
      <rect x="9" y="2" width="6" height="12" rx="3" />
      <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
      <line x1="12" y1="19" x2="12" y2="23" />
      <line x1="8" y1="23" x2="16" y2="23" />
    </svg>
  );
}

function VolumeOnIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="w-5 h-5"
      aria-hidden="true"
    >
      <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
      <path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07" />
    </svg>
  );
}

function VolumeMutedIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="w-5 h-5"
      aria-hidden="true"
    >
      <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
      <line x1="23" y1="9" x2="17" y2="15" />
      <line x1="17" y1="9" x2="23" y2="15" />
    </svg>
  );
}
