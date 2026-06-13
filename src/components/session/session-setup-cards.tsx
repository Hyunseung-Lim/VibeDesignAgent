"use client";

export type SessionSetupMissionOption = {
  title: string;
  description?: string;
};

type ProfileInputCardProps = {
  value: string;
  onChange: (value: string) => void;
};

type ProfileReviewCardProps = {
  value: string;
};

type SetupMissionSummaryCardProps = {
  missionTitle: string;
  missionBrief: string;
  activeOption: SessionSetupMissionOption | null;
  showOption: boolean;
  missionDurationMinutes?: number | null;
};

export function ProfileInputCard({ value, onChange }: ProfileInputCardProps) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white px-6 py-5">
      <p className="font-semibold text-slate-900">
        에이전트가 미리 알아야 할 것들
      </p>
      <p className="mt-1 text-sm leading-relaxed text-slate-500">
        미션을 진행할 때 처음부터 반영해야 하는 정보를 적어주세요. 브랜드
        컬러, 타겟 사용자, 프로젝트 제약 조건처럼 대화만으로 알기 어려운
        맥락이 좋습니다.
      </p>
      <textarea
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder="예: 이 미션에서는 브랜드 컬러를 네이비로 유지해야 해요. 타겟은 20대 여성이고, 앱 출시는 3개월 안에 해야 해요."
        rows={5}
        className="mt-4 w-full resize-none rounded-xl border border-slate-200 px-3 py-2.5 text-sm leading-relaxed text-slate-700 outline-none placeholder:text-slate-300 focus:border-slate-400"
      />
    </div>
  );
}

export function ProfileReviewCard({ value }: ProfileReviewCardProps) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white px-6 py-5">
      <p className="font-semibold text-slate-900">입력한 정보</p>
      <div className="mt-3">
        {value.trim() ? (
          <p className="whitespace-pre-wrap text-sm leading-relaxed text-slate-700">
            {value}
          </p>
        ) : (
          <p className="text-sm text-slate-400">입력한 정보가 없습니다.</p>
        )}
      </div>
    </div>
  );
}

export function SetupMissionSummaryCard({
  missionTitle,
  missionBrief,
  activeOption,
  showOption,
  missionDurationMinutes,
}: SetupMissionSummaryCardProps) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white px-6 py-5">
      <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">
        미션
      </p>
      <h2 className="mt-2 text-lg font-semibold text-slate-900">
        {missionTitle}
      </h2>
      {missionBrief && (
        <p className="mt-1.5 whitespace-pre-wrap text-sm leading-relaxed text-slate-500">
          {missionBrief}
        </p>
      )}
      {activeOption && showOption && (
        <div className="mt-4 border-t border-slate-100 pt-4">
          <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">
            선택한 옵션
          </p>
          <p className="mt-1.5 font-medium text-slate-800">
            {activeOption.title}
          </p>
          {activeOption.description && (
            <p className="mt-1 text-sm leading-relaxed text-slate-500">
              {activeOption.description}
            </p>
          )}
        </div>
      )}
      {missionDurationMinutes ? (
        <div className="mt-4 border-t border-slate-100 pt-4">
          <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">
            제한 시간
          </p>
          <p className="mt-1.5 text-2xl font-bold text-slate-900">
            {missionDurationMinutes}분
          </p>
        </div>
      ) : null}
    </div>
  );
}
