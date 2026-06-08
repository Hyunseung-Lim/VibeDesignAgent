"use client";

import type { RefObject, ReactElement, ReactNode } from "react";
import React from "react";
import ReactMarkdown from "react-markdown";

export type DesignStyleSectionStyle = {
  id: string;
  title: string;
  content: string;
  createdAt?: number;
};

type DesignStyleSectionProps = {
  sectionRef: RefObject<HTMLElement | null>;
  style: DesignStyleSectionStyle | null | undefined;
  open: boolean;
  onToggle: () => void;
};

const HEX_COLOR_RE = /(#[0-9A-Fa-f]{6}|#[0-9A-Fa-f]{3})\b/g;

function parseColorTokens(text: string): ReactNode[] {
  const parts: ReactNode[] = [];
  let last = 0;
  let match: RegExpExecArray | null;
  HEX_COLOR_RE.lastIndex = 0;

  while ((match = HEX_COLOR_RE.exec(text)) !== null) {
    if (match.index > last) parts.push(text.slice(last, match.index));

    const hex = match[1];
    parts.push(
      <span
        key={match.index}
        className="inline-flex items-center gap-1 align-middle"
      >
        <span
          className="inline-block h-3 w-3 shrink-0 rounded-sm border border-black/10"
          style={{ backgroundColor: hex }}
        />
        <code className="font-mono text-[10px] text-indigo-700">{hex}</code>
      </span>,
    );
    last = match.index + match[0].length;
  }

  if (last < text.length) parts.push(text.slice(last));
  return parts;
}

function withColorTokens(children: ReactNode): ReactNode {
  if (typeof children === "string") return parseColorTokens(children);
  if (Array.isArray(children)) {
    return children.map((child, index) =>
      typeof child === "string"
        ? parseColorTokens(child).map((node, nodeIndex) =>
            typeof node === "string"
              ? node
              : React.cloneElement(node as ReactElement, {
                  key: `${index}-${nodeIndex}`,
                }),
          )
        : child,
    );
  }
  return children;
}

export function DesignStyleSection({
  sectionRef,
  style,
  open,
  onToggle,
}: DesignStyleSectionProps) {
  return (
    <section ref={sectionRef} className="space-y-3 scroll-mt-4">
      <div className="overflow-hidden rounded-2xl border border-indigo-100 bg-indigo-50/40">
        <button
          type="button"
          onClick={onToggle}
          className="flex w-full items-center justify-between px-4 py-3 text-left"
        >
          <span className="flex items-center gap-2">
            <span className="flex h-7 w-7 items-center justify-center rounded-lg border border-indigo-100 bg-white text-xs font-semibold text-indigo-600">
              Aa
            </span>
            <span className="space-y-0.5">
              <span className="block text-xs font-semibold text-slate-800">
                디자인 스타일
              </span>
              <span className="block text-[11px] text-slate-500">
                {style ? "현재 시안의 시각 규칙" : "아직 정의되지 않음"}
              </span>
            </span>
          </span>
          <span className="flex items-center gap-2 text-xs text-slate-500">
            <span
              className={`rounded-full px-2 py-0.5 font-semibold ${
                style ? "bg-indigo-100 text-indigo-700" : "bg-white text-slate-400"
              }`}
            >
              {style ? "설정됨" : "미정의"}
            </span>
            {open ? "접기" : "펼치기"}
          </span>
        </button>

        {open && (
          <div className="space-y-3 border-t border-indigo-100 px-4 py-3">
            {!style ? (
              <p className="text-xs text-slate-500">
                에이전트에게 이 시안의 디자인 스타일을 정의해달라고 요청하세요.
              </p>
            ) : (
              <div className="space-y-3">
                <div className="max-h-56 overflow-y-auto rounded-xl border border-indigo-100 bg-white px-4 py-3 text-xs text-slate-600">
                  <ReactMarkdown
                    components={{
                      h1: ({ children }) => (
                        <h1 className="mb-2 mt-3 text-sm font-bold text-slate-900 first:mt-0">
                          {children}
                        </h1>
                      ),
                      h2: ({ children }) => (
                        <h2 className="mb-1.5 mt-3 text-xs font-semibold uppercase text-slate-800 first:mt-0">
                          {children}
                        </h2>
                      ),
                      h3: ({ children }) => (
                        <h3 className="mb-1 mt-2 text-xs font-semibold text-slate-700">
                          {children}
                        </h3>
                      ),
                      p: ({ children }) => (
                        <p className="mb-1.5 leading-relaxed last:mb-0">
                          {withColorTokens(children)}
                        </p>
                      ),
                      ul: ({ children }) => (
                        <ul className="mb-1.5 ml-4 list-disc space-y-0.5">
                          {children}
                        </ul>
                      ),
                      ol: ({ children }) => (
                        <ol className="mb-1.5 ml-4 list-decimal space-y-0.5">
                          {children}
                        </ol>
                      ),
                      li: ({ children }) => (
                        <li className="leading-relaxed">
                          {withColorTokens(children)}
                        </li>
                      ),
                      strong: ({ children }) => (
                        <strong className="font-semibold text-slate-900">
                          {children}
                        </strong>
                      ),
                      em: ({ children }) => (
                        <em className="italic text-slate-600">{children}</em>
                      ),
                      code: ({ children }) => {
                        const text = String(children ?? "");
                        const trimmed = text.trim();
                        const isHex =
                          /^#([0-9A-Fa-f]{6}|[0-9A-Fa-f]{3})$/.test(trimmed);
                        return (
                          <span className="inline-flex items-center gap-1 align-middle">
                            {isHex && (
                              <span
                                className="inline-block h-3 w-3 shrink-0 rounded-sm border border-black/10"
                                style={{ backgroundColor: trimmed }}
                              />
                            )}
                            <code className="rounded bg-indigo-50 px-1.5 py-0.5 font-mono text-[10px] text-indigo-700">
                              {text}
                            </code>
                          </span>
                        );
                      },
                      blockquote: ({ children }) => (
                        <blockquote className="my-2 border-l-2 border-indigo-200 pl-3 italic text-slate-500">
                          {children}
                        </blockquote>
                      ),
                      hr: () => <hr className="my-2 border-indigo-100" />,
                      a: ({ href, children }) => (
                        <a
                          href={href}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-indigo-600 underline underline-offset-2 hover:text-indigo-800"
                        >
                          {children}
                        </a>
                      ),
                    }}
                  >
                    {style.content}
                  </ReactMarkdown>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
