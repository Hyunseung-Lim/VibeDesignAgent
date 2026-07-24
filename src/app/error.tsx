"use client";

import { useEffect } from "react";

// 세그먼트 에러 바운더리: 렌더/커밋 중 uncaught 예외가 나면 전체 트리 언마운트
// 대신 이 fallback을 보여준다. 리뷰 draft는 서버에 임시 저장되므로 새로고침
// 후 복원된다는 안내를 함께 준다 (15.336).
export default function Error({
  error,
  unstable_retry,
}: {
  error: Error & { digest?: string };
  unstable_retry: () => void;
}) {
  useEffect(() => {
    console.error("[app] segment error boundary", error);
  }, [error]);

  return (
    <div className="flex min-h-full flex-1 flex-col items-center justify-center gap-4 px-6 py-16 text-center">
      <p className="text-lg font-semibold text-foreground">
        일시적인 오류가 발생했습니다
      </p>
      <p className="max-w-md text-sm leading-relaxed text-muted-foreground">
        다시 시도하거나 페이지를 새로고침해 주세요. 작성 중이던 리뷰 답변과
        메모리 변경 내용은 서버에 임시 저장된 범위까지 그대로 복원됩니다.
      </p>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => unstable_retry()}
          className="rounded-lg bg-foreground px-4 py-2 text-sm font-medium text-background"
        >
          다시 시도
        </button>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-foreground"
        >
          새로고침
        </button>
      </div>
      {error.digest ? (
        <p className="text-[11px] text-muted-foreground">
          오류 코드: {error.digest}
        </p>
      ) : null}
    </div>
  );
}
