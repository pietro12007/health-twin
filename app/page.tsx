"use client";

import { useEffect, useRef, useState } from "react";
import type { ChangeEvent, FormEvent } from "react";

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
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages]);

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
          <button
            onClick={resetToForm}
            className="text-sm text-gray-400 hover:text-white transition"
          >
            Edit profile
          </button>
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
          className="max-w-3xl mx-auto px-6 py-4 flex gap-2"
        >
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Ask your Digital Twin anything…"
            disabled={isStreaming}
            className="flex-1 p-3 rounded-lg bg-gray-900 text-white border border-gray-800 focus:outline-none focus:border-blue-400 disabled:opacity-50"
          />
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
            : "bg-gray-900 border border-gray-800 text-gray-100 rounded-2xl px-4 py-3 max-w-[85%] whitespace-pre-wrap leading-relaxed"
        }
      >
        {message.content}
      </div>
    </div>
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
