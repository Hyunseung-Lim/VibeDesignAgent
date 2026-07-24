"use client";

import { useEffect } from "react";

// 루트 layout까지 대체하는 최후의 에러 바운더리. 이 파일이 활성화되면 루트
// layout(globals.css 포함)이 렌더되지 않으므로 스타일은 인라인으로만 쓴다.
export default function GlobalError({
  error,
  unstable_retry,
}: {
  error: Error & { digest?: string };
  unstable_retry: () => void;
}) {
  useEffect(() => {
    console.error("[app] global error boundary", error);
  }, [error]);

  return (
    <html lang="ko" translate="no">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: "16px",
          padding: "64px 24px",
          textAlign: "center",
          fontFamily: "system-ui, sans-serif",
          color: "#0f172a",
          background: "#ffffff",
        }}
      >
        <p style={{ margin: 0, fontSize: "18px", fontWeight: 600 }}>
          일시적인 오류가 발생했습니다
        </p>
        <p
          style={{
            margin: 0,
            maxWidth: "28rem",
            fontSize: "14px",
            lineHeight: 1.6,
            color: "#64748b",
          }}
        >
          다시 시도하거나 페이지를 새로고침해 주세요. 작성 중이던 리뷰 답변과
          메모리 변경 내용은 서버에 임시 저장된 범위까지 그대로 복원됩니다.
        </p>
        <div style={{ display: "flex", gap: "8px" }}>
          <button
            type="button"
            onClick={() => unstable_retry()}
            style={{
              borderRadius: "8px",
              border: "none",
              background: "#0f172a",
              color: "#ffffff",
              padding: "8px 16px",
              fontSize: "14px",
              fontWeight: 500,
              cursor: "pointer",
            }}
          >
            다시 시도
          </button>
          <button
            type="button"
            onClick={() => window.location.reload()}
            style={{
              borderRadius: "8px",
              border: "1px solid #e2e8f0",
              background: "#ffffff",
              color: "#0f172a",
              padding: "8px 16px",
              fontSize: "14px",
              fontWeight: 500,
              cursor: "pointer",
            }}
          >
            새로고침
          </button>
        </div>
        {error.digest ? (
          <p style={{ margin: 0, fontSize: "11px", color: "#94a3b8" }}>
            오류 코드: {error.digest}
          </p>
        ) : null}
      </body>
    </html>
  );
}
