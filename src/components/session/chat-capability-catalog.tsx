"use client";

import type { ChatComposerCommand } from "@/lib/session/chat-composer";

type ChatCapabilityCatalogProps = {
  commands: ChatComposerCommand[];
  onPick: (command: ChatComposerCommand) => void;
};

export function ChatCapabilityCatalog({
  commands,
  onPick,
}: ChatCapabilityCatalogProps) {
  return (
    <div className="flex flex-col gap-3.5">
      <div className="flex flex-col gap-1">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
          새로 만들기
        </p>
        <p className="text-xs leading-relaxed text-slate-500">
          <code className="font-semibold text-slate-700">/</code>로 만들고,
          <code className="ml-1 font-semibold text-slate-700">@</code>로 현재
          세션의 기존 항목을 언급할 수 있어요.
        </p>
      </div>
      <div className="grid gap-1.5">
        {commands.map((command) => (
          <button
            key={command.id}
            type="button"
            disabled={Boolean(command.disabledReason)}
            onClick={() => onPick(command)}
            className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 px-3 py-2 text-left transition enabled:hover:border-indigo-200 enabled:hover:bg-indigo-50 disabled:cursor-not-allowed disabled:opacity-45"
          >
            <code className="shrink-0 text-xs font-semibold text-indigo-600">
              {command.label}
            </code>
            <span className="truncate text-[11px] text-slate-400">
              {command.disabledReason ?? command.description}
            </span>
          </button>
        ))}
      </div>
      <p className="text-[11px] leading-relaxed text-slate-400">
        대상이 없으면 현재 선택된 시안에서 작업합니다.
      </p>
    </div>
  );
}
