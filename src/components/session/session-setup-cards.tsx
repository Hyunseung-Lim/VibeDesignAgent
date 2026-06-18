"use client";

import ReactMarkdown from "react-markdown";

export type SessionSetupMissionOption = {
  title: string;
  description?: string;
  content?: string;
  assetImages?: SessionSetupAssetImage[];
};

export type SessionSetupAssetImage = {
  url: string;
  note?: string;
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
  parentMissionTitle?: string;
  parentMissionBrief?: string;
  activeOption: SessionSetupMissionOption | null;
  showOption: boolean;
  missionDurationMinutes?: number | null;
};

const setupMarkdownComponents = {
  h1: ({ children }: { children?: React.ReactNode }) => (
    <h1 className="mb-2 mt-4 text-lg font-semibold text-slate-900 first:mt-0">
      {children}
    </h1>
  ),
  h2: ({ children }: { children?: React.ReactNode }) => (
    <h2 className="mb-2 mt-4 text-base font-semibold text-slate-900 first:mt-0">
      {children}
    </h2>
  ),
  h3: ({ children }: { children?: React.ReactNode }) => (
    <h3 className="mb-1 mt-3 text-sm font-semibold text-slate-800">
      {children}
    </h3>
  ),
  p: ({ children }: { children?: React.ReactNode }) => (
    <p className="mb-2 leading-relaxed last:mb-0">{children}</p>
  ),
  ul: ({ children }: { children?: React.ReactNode }) => (
    <ul className="mb-2 ml-5 list-disc space-y-1">{children}</ul>
  ),
  ol: ({ children }: { children?: React.ReactNode }) => (
    <ol className="mb-2 ml-5 list-decimal space-y-1">{children}</ol>
  ),
  li: ({ children }: { children?: React.ReactNode }) => (
    <li className="leading-relaxed">{children}</li>
  ),
  strong: ({ children }: { children?: React.ReactNode }) => (
    <strong className="font-semibold text-slate-900">{children}</strong>
  ),
  code: ({ children }: { children?: React.ReactNode }) => (
    <code className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-xs text-slate-800">
      {children}
    </code>
  ),
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
  parentMissionTitle,
  parentMissionBrief,
  activeOption,
  showOption,
  missionDurationMinutes,
}: SetupMissionSummaryCardProps) {
  const overallTitle = parentMissionTitle?.trim() || missionTitle.trim();
  const overallBrief =
    parentMissionBrief?.trim() || (!activeOption ? missionBrief.trim() : "");
  const optionTitle = activeOption?.title?.trim() || missionTitle.trim();
  const optionBrief =
    missionBrief.trim() && missionBrief.trim() !== overallBrief
      ? missionBrief.trim()
      : activeOption?.description?.trim() || "";
  const assetImages = activeOption?.assetImages ?? [];
  const showOptionSection =
    Boolean(activeOption || optionBrief) &&
    (showOption || Boolean(activeOption) || Boolean(parentMissionBrief));

  return (
    <div className="rounded-2xl border border-slate-200 bg-white px-6 py-5">
      <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">
        전체 미션
      </p>
      {overallTitle && (
        <h2 className="mt-2 text-lg font-semibold text-slate-900">
          {overallTitle}
        </h2>
      )}
      {overallBrief && (
        <p className="mt-1.5 whitespace-pre-wrap text-sm leading-relaxed text-slate-500">
          {overallBrief}
        </p>
      )}

      {missionDurationMinutes ? (
        <div className="mt-5 border-t border-slate-100 pt-4">
          <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">
            제한 시간
          </p>
          <p className="mt-1.5 text-2xl font-bold text-slate-900">
            {missionDurationMinutes}분
          </p>
        </div>
      ) : null}

      {showOptionSection && (
        <div className="mt-5 border-t border-slate-100 pt-4">
          <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">
            해당 옵션
          </p>
          {optionTitle && optionTitle !== overallTitle && (
            <p className="mt-1.5 font-medium text-slate-800">{optionTitle}</p>
          )}
          {optionBrief && (
            <div className="mt-2 text-sm leading-relaxed text-slate-600">
              <ReactMarkdown components={setupMarkdownComponents}>
                {optionBrief}
              </ReactMarkdown>
            </div>
          )}
        </div>
      )}

      {assetImages.length > 0 && (
        <div className="mt-5 border-t border-slate-100 pt-4">
          <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">
            제공 이미지
          </p>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            {assetImages.map((image, index) => (
              <a
                key={`${image.url}-${index}`}
                href={image.url}
                target="_blank"
                rel="noreferrer"
                className="group flex min-w-0 gap-3 rounded-xl border border-slate-100 bg-slate-50/70 p-2 transition hover:border-slate-200 hover:bg-white"
              >
                <span
                  role="img"
                  aria-label={image.note?.trim() || `제공 이미지 ${index + 1}`}
                  className="h-20 w-20 shrink-0 overflow-hidden rounded-lg bg-slate-100 bg-cover bg-center"
                  style={{ backgroundImage: `url(${image.url})` }}
                />
                <span className="min-w-0 flex-1 py-1">
                  <span className="block text-xs font-semibold uppercase tracking-wider text-slate-400">
                    이미지 {index + 1}
                  </span>
                  <span className="mt-1 block whitespace-pre-wrap text-sm leading-relaxed text-slate-600 group-hover:text-slate-800">
                    {image.note?.trim() || "설명이 없습니다."}
                  </span>
                </span>
              </a>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
