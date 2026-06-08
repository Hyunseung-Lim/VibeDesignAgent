const DEFAULT_STEPS = [
  "미션 옵션을 먼저 선택합니다.",
  "에이전트가 노트를 작성하고, 사용자는 노트를 선택합니다.",
  "목업은 여러 디자인으로 생성할 수 있고, 우클릭으로 삭제할 수 있습니다.",
  "프레젠테이션은 생성된 목업 캡쳐를 기반으로 만듭니다.",
];

export function OnboardingSteps({ steps = DEFAULT_STEPS }: { steps?: string[] }) {
  return (
    <div className="mt-8 grid gap-3 text-sm text-foreground">
      {steps.map((item, index) => (
        <div
          key={item}
          className="flex gap-3 rounded-lg border border-border bg-muted/40 p-4"
        >
          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground">
            {index + 1}
          </span>
          <p>{item}</p>
        </div>
      ))}
    </div>
  );
}
