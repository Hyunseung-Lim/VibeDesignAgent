import type { Metadata, Viewport } from "next";
import "./globals.css";
import { Agentation } from "agentation";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";

export const metadata: Metadata = {
  title: "VibeDesign Agent",
  description: "AI 에이전트와 대화만으로 UI/UX 과업을 수행하는 워크스페이스",
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
    <html lang="ko" className="h-full antialiased font-sans">
      <body className="min-h-full flex flex-col">
        <TooltipProvider>{children}</TooltipProvider>
        <Toaster />
        {process.env.NODE_ENV === "development" && <Agentation />}
      </body>
    </html>
  );
}
