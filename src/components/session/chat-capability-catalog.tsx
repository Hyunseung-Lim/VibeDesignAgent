"use client";

// 에이전트 능력 카탈로그 — "부탁할 수 있는 것들"을 워크플로 순서로 보여주는 발견성
// UI. 라우터가 자연어를 6개 액션으로 분류하므로(시안/디자인 스타일/목업 생성/목업
// 수정/레퍼런스/발표) 정확한 명령어는 필요 없다. 예문은 "예:" 톤의 샘플일 뿐이며,
// 클릭하면 입력창을 채워(자동 전송 X) 표현법을 가르친다. 입력 툴바 팝오버와 채팅
// 빈 화면이 같은 데이터를 공유한다(variant로 렌더만 분기).

export type ChatCapability = {
  id: string;
  label: string;
  examples: string[];
  /** 워크플로 의존성 안내 (예: 목업 생성 전 디자인 스타일 필요). */
  note?: string;
};

// 워크플로 순서: 레퍼런스 → 시안 → 디자인 스타일 → 목업 생성 → 요소 수정.
export const CHAT_CAPABILITIES: ChatCapability[] = [
  {
    id: "references",
    label: "레퍼런스 찾기",
    examples: [
      "와인 추천 앱 레퍼런스 찾아줘",
      "레이아웃 구조 참고할 실제 서비스 보여줘",
    ],
  },
  {
    id: "idea",
    label: "시안 잡기",
    examples: ["이 미션 시안 하나 잡아줘", "다른 방향으로 시안 하나 더 만들어줘"],
  },
  {
    id: "design-style",
    label: "디자인 스타일 정하기",
    examples: [
      "미니멀한 다크 테마로 스타일 정해줘",
      "이 레퍼런스 분위기로 컬러랑 폰트 잡아줘",
    ],
  },
  {
    id: "mockup",
    label: "목업 생성",
    examples: ["이 시안으로 목업 만들어줘", "이 레퍼런스처럼 목업 만들어줘"],
    note: "디자인 스타일이 먼저 필요해요",
  },
  {
    id: "edit",
    label: "요소 수정",
    examples: ["이 버튼 색 바꿔줘", "목업 글자 전부 한국어로 바꿔줘"],
    note: "수정할 요소를 클릭해 선택하면 정확해요",
  },
];

type ChatCapabilityCatalogProps = {
  onPick: (example: string) => void;
};

export function ChatCapabilityCatalog({ onPick }: ChatCapabilityCatalogProps) {
  return (
    <div className="flex flex-col gap-3.5">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
        부탁할 수 있는 것들
      </p>
      <ol className="flex flex-col gap-3">
        {CHAT_CAPABILITIES.map((capability, index) => (
          <li key={capability.id} className="flex gap-2.5">
            <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-slate-100 text-[11px] font-semibold text-slate-500">
              {index + 1}
            </span>
            <div className="flex min-w-0 flex-1 flex-col gap-1.5">
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-[13px] font-semibold leading-tight text-slate-800">
                  {capability.label}
                </span>
                {capability.note && (
                  <span className="rounded-full bg-indigo-50 px-2 py-0.5 text-[10px] font-medium text-indigo-500">
                    {capability.note}
                  </span>
                )}
              </div>
              <div className="flex flex-wrap gap-1.5">
                {capability.examples.map((example) => (
                  <button
                    key={example}
                    type="button"
                    onClick={() => onPick(example)}
                    className="rounded-lg border border-slate-200 px-2.5 py-1 text-left text-xs leading-snug text-slate-600 transition hover:border-indigo-200 hover:bg-indigo-50 hover:text-indigo-600"
                  >
                    <span className="text-slate-400">예:</span> {example}
                  </button>
                ))}
              </div>
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}
