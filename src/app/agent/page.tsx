export default function AgentManagePlaceholder() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-slate-950 px-4 text-center text-white">
      <div className="max-w-md space-y-4">
        <p className="text-sm uppercase tracking-[0.3em] text-slate-400">
          Agent Manage
        </p>
        <h1 className="text-3xl font-semibold">
          에이전트 관리 화면은 곧 제공됩니다
        </h1>
        <p className="text-base text-slate-200">
          현재는 로비에서 과제를 선택할 수 있습니다. 상태 패널과 메모리 뷰는
          다음 스프린트에서 구현될 예정입니다.
        </p>
      </div>
    </div>
  );
}
