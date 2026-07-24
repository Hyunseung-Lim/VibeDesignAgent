import type { Metadata, Viewport } from "next";
import "./globals.css";
import { Agentation } from "agentation";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";

export const metadata: Metadata = {
  title: "VibeDesign Agent",
  description: "AI 에이전트와 대화만으로 UI/UX 과업을 수행하는 워크스페이스",
  // Chrome 자동번역이 텍스트 노드를 <font>로 감싸 React가 관리하는 DOM을
  // 변조하면, 리스트 재구성이 큰 커밋(리뷰 토글 등)에서 removeChild 계열
  // 크래시가 난다. 한국어 연구 도구라 번역이 필요 없으므로 전면 차단한다.
  other: { google: "notranslate" },
};

// Desktop-only fixed layout: mobile browsers render the page at a fixed
// 1024px virtual viewport (zoomed out) instead of a responsive layout.
// Keep in sync with body { min-width } in globals.css.
export const viewport: Viewport = {
  width: 1024,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko" translate="no" className="h-full antialiased font-sans">
      <body className="min-h-full flex flex-col">
        <TooltipProvider>{children}</TooltipProvider>
        <Toaster />
        {process.env.NODE_ENV === "development" && <Agentation />}
      </body>
    </html>
  );
}
