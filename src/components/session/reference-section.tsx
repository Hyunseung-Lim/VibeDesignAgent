"use client";

import { ReferenceCard, type SessionReference } from "@/components/session/reference-card";

type ReferenceSectionProps = {
  references: SessionReference[];
  selectedReferenceIds: Set<string>;
  fetching: boolean;
  error: string;
  readOnly: boolean;
  onToggleReference: (reference: SessionReference) => void;
  onDeleteReference: (reference: SessionReference) => void;
};

export function ReferenceSection({
  references,
  selectedReferenceIds,
  fetching,
  error,
  readOnly,
  onToggleReference,
  onDeleteReference,
}: ReferenceSectionProps) {
  return (
    <div className="rounded-3xl border border-slate-200 bg-white p-6">
      <div className="flex items-center justify-between">
        <p className="text-xl font-semibold text-slate-900">Reference</p>
      </div>

      {error && !fetching && (
        <div className="mt-4 rounded-2xl border border-amber-100 bg-amber-50 px-4 py-3 text-sm text-amber-700">
          {error}
        </div>
      )}

      {references.length === 0 && !fetching ? (
        error ? null : (
          <div className="mt-4 rounded-2xl border border-dashed border-slate-200 bg-slate-50 p-6 text-center text-sm text-slate-400">
            {'채팅에서 "레퍼런스 찾아줘"라고 입력하면 관련 UI 이미지가 표시됩니다.'}
          </div>
        )
      ) : (
        <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {references.map((reference) => (
            <ReferenceCard
              key={reference.id}
              reference={reference}
              selected={selectedReferenceIds.has(reference.id)}
              readOnly={readOnly}
              onToggle={onToggleReference}
              onDelete={onDeleteReference}
            />
          ))}
        </div>
      )}
    </div>
  );
}
