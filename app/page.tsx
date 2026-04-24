"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { ChangeEvent, FormEvent, ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

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

type HealthData = {
  age: string;
  heartRate: string;
  sleep: string;
  exercise: string;
  stress: string;
  smoker: string;
};

type ChatMessage = {
  role: "user" | "assistant";
  content: string;
};

const initialHealthData: HealthData = {
  age: "",
  heartRate: "",
  sleep: "",
  exercise: "",
  stress: "",
  smoker: "No",
};

const KICKOFF_PROMPT =
  "Give me a personalised, evidence-based snapshot of where my current habits are likely to take my health over the next 5–20 years. Anchor it in my actual numbers, call out the highest-impact change I should focus on first, and end with three concrete next steps.";

export default function Home() {
  const [healthData, setHealthData] = useState<HealthData>(initialHealthData);
  const [view, setView] = useState<"form" | "chat">("form");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isMuted, setIsMuted] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
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
  const scrollRef = useRef<HTMLDivElement>(null);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const mutedRef = useRef(false);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages]);

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

  const updateField =
    (key: keyof HealthData) =>
    (e: ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
      setHealthData((prev) => ({ ...prev, [key]: e.target.value }));
    };

  const isFormValid =
    healthData.age !== "" &&
    healthData.heartRate !== "" &&
    healthData.sleep !== "" &&
    healthData.exercise !== "" &&
    healthData.stress !== "";

  async function streamReply(history: ChatMessage[]) {
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
        body: JSON.stringify({ healthData, messages: history }),
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

  function handleProfileSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!isFormValid || isStreaming) return;
    setView("chat");
    void streamReply([{ role: "user", content: KICKOFF_PROMPT }]);
  }

  async function handleSendMessage(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (isRecording) stopRecording();
    const text = input.trim();
    if (!text || isStreaming) return;
    setInput("");
    await streamReply([...messages, { role: "user", content: text }]);
  }

  function resetToForm() {
    setView("form");
    setMessages([]);
    setError(null);
    setInput("");
    if (typeof window !== "undefined") {
      window.speechSynthesis?.cancel();
    }
    recognitionRef.current?.abort();
    recognitionRef.current = null;
    setIsRecording(false);
  }

  if (view === "form") {
    return (
      <main className="min-h-screen bg-gray-950 text-white p-8">
        <div className="max-w-2xl mx-auto">
          <h1 className="text-4xl font-bold text-center mb-2 text-blue-400">
            My Future Health
          </h1>
          <p className="text-center text-gray-400 mb-8">
            Meet Your Digital Twin
          </p>

          <form
            onSubmit={handleProfileSubmit}
            className="bg-gray-900 rounded-2xl p-6 space-y-4"
          >
            <h2 className="text-xl font-semibold text-white">
              Your Health Profile
            </h2>

            <div>
              <label className="text-gray-400 text-sm">Age</label>
              <input
                type="number"
                min={1}
                max={120}
                placeholder="e.g. 28"
                value={healthData.age}
                onChange={updateField("age")}
                className="w-full mt-1 p-3 rounded-lg bg-gray-800 text-white border border-gray-700 focus:outline-none focus:border-blue-400"
              />
            </div>

            <div>
              <label className="text-gray-400 text-sm">
                Average Heart Rate (bpm)
              </label>
              <input
                type="number"
                min={30}
                max={220}
                placeholder="e.g. 72"
                value={healthData.heartRate}
                onChange={updateField("heartRate")}
                className="w-full mt-1 p-3 rounded-lg bg-gray-800 text-white border border-gray-700 focus:outline-none focus:border-blue-400"
              />
            </div>

            <div>
              <label className="text-gray-400 text-sm">
                Average Sleep (hours/night)
              </label>
              <input
                type="number"
                min={0}
                max={24}
                step="0.5"
                placeholder="e.g. 7"
                value={healthData.sleep}
                onChange={updateField("sleep")}
                className="w-full mt-1 p-3 rounded-lg bg-gray-800 text-white border border-gray-700 focus:outline-none focus:border-blue-400"
              />
            </div>

            <div>
              <label className="text-gray-400 text-sm">
                Exercise (days/week)
              </label>
              <input
                type="number"
                min={0}
                max={7}
                placeholder="e.g. 3"
                value={healthData.exercise}
                onChange={updateField("exercise")}
                className="w-full mt-1 p-3 rounded-lg bg-gray-800 text-white border border-gray-700 focus:outline-none focus:border-blue-400"
              />
            </div>

            <div>
              <label className="text-gray-400 text-sm">Stress Level (1-10)</label>
              <input
                type="number"
                min={1}
                max={10}
                placeholder="e.g. 5"
                value={healthData.stress}
                onChange={updateField("stress")}
                className="w-full mt-1 p-3 rounded-lg bg-gray-800 text-white border border-gray-700 focus:outline-none focus:border-blue-400"
              />
            </div>

            <div>
              <label className="text-gray-400 text-sm">Smoker?</label>
              <select
                value={healthData.smoker}
                onChange={updateField("smoker")}
                className="w-full mt-1 p-3 rounded-lg bg-gray-800 text-white border border-gray-700 focus:outline-none focus:border-blue-400"
              >
                <option>No</option>
                <option>Yes</option>
                <option>Former smoker</option>
              </select>
            </div>

            <button
              type="submit"
              disabled={!isFormValid}
              className="w-full mt-4 p-4 bg-blue-500 hover:bg-blue-600 disabled:bg-gray-700 disabled:text-gray-400 disabled:cursor-not-allowed rounded-lg font-semibold text-white transition"
            >
              Generate My Digital Twin →
            </button>
          </form>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-gray-950 text-white flex flex-col">
      <header className="border-b border-gray-800 bg-gray-950/80 backdrop-blur sticky top-0 z-10">
        <div className="max-w-3xl mx-auto px-6 py-4 flex items-center justify-between">
          <div>
            <h1 className="text-xl font-semibold text-blue-400">
              My Future Health
            </h1>
            <p className="text-xs text-gray-500">
              Age {healthData.age || "—"} · HR {healthData.heartRate || "—"} bpm
              · Sleep {healthData.sleep || "—"}h · Exercise{" "}
              {healthData.exercise || "—"}×/wk · Stress{" "}
              {healthData.stress || "—"}/10 · {healthData.smoker || "—"}
            </p>
          </div>
          <div className="flex items-center gap-1">
            {speechSynthesisSupported && (
              <button
                type="button"
                onClick={() => setIsMuted((m) => !m)}
                title={isMuted ? "Unmute voice output" : "Mute voice output"}
                aria-label={
                  isMuted ? "Unmute voice output" : "Mute voice output"
                }
                aria-pressed={isMuted}
                className="p-2 rounded-lg text-gray-400 hover:text-white hover:bg-gray-800 transition"
              >
                {isMuted ? <VolumeMutedIcon /> : <VolumeOnIcon />}
              </button>
            )}
            <button
              onClick={resetToForm}
              className="text-sm text-gray-400 hover:text-white transition px-2 py-1"
            >
              Edit profile
            </button>
          </div>
        </div>
      </header>

      <div ref={scrollRef} className="flex-1 overflow-y-auto">
        <div className="max-w-3xl mx-auto px-6 py-6 space-y-4">
          {messages.map((m, i) => (
            <MessageBubble key={i} message={m} />
          ))}
          {isStreaming &&
            messages.length > 0 &&
            messages[messages.length - 1].role === "assistant" &&
            messages[messages.length - 1].content === "" && (
              <div className="flex">
                <div className="bg-gray-900 border border-gray-800 rounded-2xl px-4 py-3 text-gray-400">
                  <span className="inline-flex gap-1">
                    <Dot delay="0ms" />
                    <Dot delay="150ms" />
                    <Dot delay="300ms" />
                  </span>
                </div>
              </div>
            )}
          {error && (
            <div className="bg-red-950/50 border border-red-800 text-red-200 rounded-lg p-3 text-sm">
              {error}
            </div>
          )}
        </div>
      </div>

      <footer className="border-t border-gray-800 bg-gray-950">
        <form
          onSubmit={handleSendMessage}
          className="max-w-3xl mx-auto px-6 py-4 flex gap-2 items-stretch"
        >
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={
              isRecording
                ? "Listening…"
                : "Ask your Digital Twin anything…"
            }
            disabled={isStreaming}
            className="flex-1 p-3 rounded-lg bg-gray-900 text-white border border-gray-800 focus:outline-none focus:border-blue-400 disabled:opacity-50"
          />
          {speechRecognitionSupported && (
            <button
              type="button"
              onClick={isRecording ? stopRecording : startRecording}
              disabled={isStreaming}
              title={isRecording ? "Stop recording" : "Record voice message"}
              aria-label={
                isRecording ? "Stop recording" : "Record voice message"
              }
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
            Send
          </button>
        </form>
      </footer>
    </main>
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
