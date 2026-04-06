'use client';

import Link from "next/link";
import { useParams } from "next/navigation";
import { useRef, useState } from "react";

const referenceCards = [
  { id: 1, title: "당근", description: "직관적인 1-2단계 제안", tag: "새롭게" },
  { id: 2, title: "Spotify", description: "숫자와 감성의 균형", tag: "음악" },
  { id: 3, title: "Meetup", description: "이벤트 플로우 최적화", tag: "커뮤니티" },
  { id: 4, title: "Framer", description: "애니메이션 중심 워크플로우", tag: "툴" },
];

const ideaTabs = [
  { id: "idea", label: "Idea" },
  { id: "mockup", label: "Mockup" },
  { id: "presentation", label: "Presentation" },
];

const nestedIdeaTabs = [
  { id: "idea-1", label: "아이디어 1 계획" },
  { id: "idea-2", label: "아이디어 2 계획" },
  { id: "idea-3", label: "아이디어 3 계획" },
  { id: "idea-4", label: "아이디어 4 계획" },
];

const historyItems = ["아이디어 1 설명", "아이디어 2 설명", "아이디어 3 설명", "아이디어 4 설명"];

export default function MainScreenPage() {
  const { missionId } = useParams<{ missionId: string }>();
  const [message, setMessage] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const handleMessageChange = (
    event: React.ChangeEvent<HTMLTextAreaElement>,
  ) => {
    setMessage(event.target.value);
    const target = event.target;
    target.style.height = "auto";
    const maxHeight = 96; // up to 3 lines
    target.style.height = `${Math.min(target.scrollHeight, maxHeight)}px`;
  };

  return (
    <div className="flex h-screen flex-col bg-[#f5f5f5] text-slate-900">
      <header className="flex items-center justify-between border-b border-slate-200 bg-white px-6 py-4 lg:px-10">
        <div className="space-y-1">
          <p className="text-sm text-slate-500">Week · {missionId}</p>
          <h1 className="text-xl font-semibold">Project Name</h1>
        </div>
        <div className="flex items-center gap-4 text-sm text-slate-500">
          <span>Version 2</span>
          <Link href="/lobby" className="rounded-full border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-800">
            로비로 돌아가기
          </Link>
        </div>
      </header>

      <main className="flex flex-1 overflow-hidden">
        <section className="flex-1 space-y-6 overflow-y-auto pb-32 pr-6 pt-8 pl-10">
          <div className="rounded-3xl border border-slate-200 bg-white p-6">
            <div className="flex items-center justify-between">
              <p className="text-xl font-semibold text-slate-900">Mission</p>
              <span className="text-sm text-slate-400">4분 전</span>
            </div>
            <div className="mt-4 rounded-2xl border border-slate-100 bg-slate-50 p-4 text-slate-500">
              과제 제목을 입력하고 브리핑을 작성하세요.
            </div>
          </div>

          <div className="rounded-3xl border border-slate-200 bg-white p-6">
            <div className="flex items-center justify-between">
              <p className="text-xl font-semibold text-slate-900">Reference</p>
              <span className="text-sm text-slate-400">10 mins ago</span>
            </div>
            <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              {referenceCards.map((card) => (
                <div key={card.id} className="rounded-2xl border border-slate-100 bg-slate-50 p-4">
                  <div className="flex h-28 w-full items-center justify-center rounded-xl bg-slate-200">
                    <span className="text-xs text-slate-500">Thumbnail</span>
                  </div>
                  <p className="mt-4 text-sm font-semibold text-slate-900">
                    {card.title}
                  </p>
                  <p className="mt-2 text-xs text-slate-500">{card.description}</p>
                  <button className="mt-3 text-xs font-semibold text-slate-700">
                    자료 보기
                  </button>
                </div>
              ))}
            </div>
            <div className="mt-6 flex flex-wrap gap-2 text-xs text-slate-500">
              {nestedIdeaTabs.map((tab) => (
                <button key={tab.id} className="rounded-full border border-slate-200 px-3 py-1 text-slate-600 hover:bg-slate-100">
                  {tab.label}
                </button>
              ))}
            </div>
          </div>

          <div className="rounded-3xl border border-slate-200 bg-white p-6">
            <div className="flex gap-4">
              <div className="flex flex-col space-y-2 text-sm text-slate-600">
                {ideaTabs.map((tab) => (
                  <button
                    key={tab.id}
                    className={`rounded-xl border px-4 py-2 text-left ${
                      tab.id === "idea"
                        ? "border-slate-900 bg-slate-900 text-white"
                        : "border-slate-200 bg-white"
                    }`}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>
              <div className="flex-1 space-y-6">
                <section className="rounded-2xl border border-slate-100 bg-slate-50 p-4">
                  <div className="flex items-center justify-between">
                    <p className="text-lg font-semibold text-slate-900">Idea</p>
                    <span className="text-xs text-slate-400">3 mins ago</span>
                  </div>
                  <p className="mt-3 text-sm text-slate-600">
                    최종 아이디어 제목
                  </p>
                  <div className="mt-3 flex gap-2 text-xs text-slate-500">
                    <span className="rounded-full border border-slate-200 px-3 py-1">
                      음운
                    </span>
                    <span className="rounded-full border border-slate-200 px-3 py-1">
                      Spotify
                    </span>
                  </div>
                </section>
                <section className="rounded-2xl border border-slate-100 bg-slate-50 p-4">
                  <div className="flex items-center justify-between">
                    <p className="text-lg font-semibold text-slate-900">Mockup</p>
                    <button className="text-xs font-semibold text-slate-600">
                      Export
                    </button>
                  </div>
                  <div className="mt-4 h-64 rounded-2xl border border-dashed border-slate-300 bg-white/70" />
                </section>
                <section className="rounded-2xl border border-slate-100 bg-slate-50 p-4">
                  <div className="flex items-center justify-between">
                    <p className="text-lg font-semibold text-slate-900">
                      Presentation
                    </p>
                    <button className="text-xs font-semibold text-slate-600">
                      Export
                    </button>
                  </div>
                  <div className="mt-4 h-56 rounded-2xl border border-dashed border-slate-300 bg-white/70" />
                </section>
              </div>
            </div>
          </div>
        </section>

        <aside className="flex h-full w-full max-w-md flex-col overflow-hidden border-l border-slate-200 bg-white">
          <div className="flex-1 space-y-4 overflow-y-auto p-6">
          <div className="space-y-3">
            <p className="text-sm font-semibold text-slate-900">Add reference.</p>
            <div className="rounded-2xl border border-slate-100 bg-slate-50 p-4 text-sm text-slate-600">
              <p>* Thinking</p>
              <p className="mt-1">· This is the answer.</p>
            </div>
          </div>
          <div className="rounded-2xl border border-slate-100 bg-slate-50 p-4 text-sm text-slate-600">
            <p>* Edit Reference</p>
            <ul className="ml-4 mt-2 list-disc space-y-1">
              <li>This is the result: first one</li>
              <li>Second one</li>
              <li>Third one</li>
            </ul>
          </div>
          <div className="rounded-2xl border border-slate-100 bg-white p-4 text-sm text-slate-600">
            <p>Reference 생성 완료</p>
            <p className="text-xs text-slate-400">Version 1</p>
          </div>
          <div className="space-y-2 rounded-2xl border border-slate-100 bg-slate-50 p-4 text-sm">
            {historyItems.map((item, index) => (
              <div key={item} className="rounded-xl border border-slate-200 bg-white p-3">
                <p className="text-sm text-slate-900">아이디어 {index + 1}</p>
                <p className="text-xs text-slate-500">{item}</p>
              </div>
            ))}
          </div>
          <div className="rounded-2xl border border-slate-100 bg-white p-4 text-sm text-slate-600">
            <p>* This is the result</p>
            <p className="text-xs text-slate-400">Ideation 정리 완료 · Version 2</p>
          </div>
          </div>
          <div className="border-t border-slate-200 bg-white/95 p-4">
            <div className="flex items-start gap-3 rounded-3xl border border-slate-200 bg-white px-4 py-3">
              <textarea
                ref={textareaRef}
                rows={1}
                value={message}
                onChange={handleMessageChange}
                placeholder="에이전트에게 메시지를 입력하세요..."
                className="max-h-24 flex-1 resize-none bg-transparent text-sm text-slate-700 outline-none placeholder:text-slate-400"
              />
              <button className="rounded-full bg-slate-900 px-4 py-2 text-xs font-semibold text-white">
                Send
              </button>
            </div>
          </div>
        </aside>
      </main>
    </div>
  );
}
