"use client";

import { useState } from "react";
import {
  Check,
  ChevronDown,
  ImageOff,
  Maximize2,
  Monitor,
  Smartphone,
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

type MissionBriefDevice = "desktop" | "mobile";

type MissionBriefAssetImage = {
  url: string;
  path?: string;
  note?: string;
};

const ASSET_NOTE_PREVIEW_MAX = 48;

function truncateAssetNote(note: string) {
  const collapsed = note.replace(/\s+/g, " ").trim();
  return collapsed.length > ASSET_NOTE_PREVIEW_MAX
    ? `${collapsed.slice(0, ASSET_NOTE_PREVIEW_MAX).trimEnd()}...`
    : collapsed;
}

function retryImageUrl(url: string, retryCount: number) {
  if (!retryCount) return url;
  const separator = url.includes("?") ? "&" : "?";
  return `${url}${separator}vdaImageRetry=${retryCount}`;
}

export type MissionBriefOption = {
  title: string;
  description?: string;
  content?: string;
  assetImages?: MissionBriefAssetImage[];
};

type MissionBriefSectionProps = {
  title: string;
  brief: string;
  option: MissionBriefOption | null;
  device: MissionBriefDevice;
  optionExpanded: boolean;
  onToggleOption: () => void;
  selectedAssetImageIds?: Set<string>;
  getAssetImageId?: (image: MissionBriefAssetImage, index: number) => string;
  onToggleAssetImage?: (image: MissionBriefAssetImage, index: number) => void;
};

const markdownComponents = {
  h1: ({ children }: { children?: React.ReactNode }) => (
    <h1 className="mb-1 mt-3 text-base font-bold text-slate-900 first:mt-0">
      {children}
    </h1>
  ),
  h2: ({ children }: { children?: React.ReactNode }) => (
    <h2 className="mb-1 mt-3 text-sm font-semibold text-slate-900 first:mt-0">
      {children}
    </h2>
  ),
  h3: ({ children }: { children?: React.ReactNode }) => (
    <h3 className="mb-1 mt-2 text-sm font-medium text-slate-800">
      {children}
    </h3>
  ),
  p: ({ children }: { children?: React.ReactNode }) => (
    <p className="mb-2 leading-relaxed last:mb-0">{children}</p>
  ),
  ul: ({ children }: { children?: React.ReactNode }) => (
    <ul className="mb-2 ml-4 list-disc space-y-1">{children}</ul>
  ),
  ol: ({ children }: { children?: React.ReactNode }) => (
    <ol className="mb-2 ml-4 list-decimal space-y-1">{children}</ol>
  ),
  li: ({ children }: { children?: React.ReactNode }) => (
    <li className="leading-relaxed">{children}</li>
  ),
  strong: ({ children }: { children?: React.ReactNode }) => (
    <strong className="font-semibold text-slate-900">{children}</strong>
  ),
  code: ({ children }: { children?: React.ReactNode }) => (
    <code className="rounded bg-slate-200 px-1 py-0.5 font-mono text-xs text-slate-800">
      {children}
    </code>
  ),
  blockquote: ({ children }: { children?: React.ReactNode }) => (
    <blockquote className="my-2 border-l-2 border-slate-300 pl-3 italic text-slate-500">
      {children}
    </blockquote>
  ),
};

export function MissionBriefSection({
  title,
  brief,
  option,
  device,
  optionExpanded,
  onToggleOption,
  selectedAssetImageIds,
  getAssetImageId,
  onToggleAssetImage,
}: MissionBriefSectionProps) {
  const [previewImage, setPreviewImage] = useState<{
    image: MissionBriefAssetImage;
    index: number;
  } | null>(null);
  const [imageRetryById, setImageRetryById] = useState<Record<string, number>>(
    {},
  );
  const [failedImageIds, setFailedImageIds] = useState<Set<string>>(
    () => new Set(),
  );
  const canToggleAssetImage = Boolean(onToggleAssetImage);

  return (
    <div
      data-tour="mission-brief"
      className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"
    >
      <div className="flex items-center justify-between">
        <p className="text-xl font-semibold text-slate-900">Mission</p>
      </div>

      <div className="mt-4 space-y-4">
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
            <p className="min-w-0 flex-1 text-base font-semibold text-slate-900">
              {title || (
                <span className="font-normal text-slate-400">
                  미션 제목 없음
                </span>
              )}
            </p>
            <Badge variant="outline" className="text-slate-600">
              {device === "mobile" ? (
                <>
                  <Smartphone className="size-3" aria-hidden="true" />
                  모바일 기준
                </>
              ) : (
                <>
                  <Monitor className="size-3" aria-hidden="true" />
                  PC 기준
                </>
              )}
            </Badge>
          </div>

          {brief ? (
            <div className="space-y-2 rounded-2xl border border-slate-100 bg-slate-50 px-4 py-3 text-sm text-slate-700">
              <p className="mb-1 text-xs font-semibold text-slate-500">
                전체 미션 브리핑
              </p>
              <ReactMarkdown components={markdownComponents}>{brief}</ReactMarkdown>
            </div>
          ) : (
            <p className="rounded-2xl border border-slate-100 bg-slate-50 px-4 py-3 text-sm text-slate-400">
              전체 미션 브리핑 없음
            </p>
          )}
        </div>

        {option && (
          <div className="border-t border-slate-100 pt-4">
            <div className="overflow-hidden rounded-2xl border border-slate-100 bg-slate-50/70">
              <button
                type="button"
                onClick={onToggleOption}
                className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left transition hover:bg-slate-50"
              >
                <div className="min-w-0">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-400">
                    Selected Option
                  </p>
                  <p className="truncate text-sm font-semibold text-slate-800">
                    {option.title}
                  </p>
                </div>
                <span className="flex size-7 shrink-0 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-500">
                  <ChevronDown
                    size={14}
                    className={`transition-transform ${
                      optionExpanded ? "rotate-180" : ""
                    }`}
                    aria-hidden="true"
                  />
                </span>
              </button>

              {optionExpanded && (
                <div className="space-y-4 border-t border-slate-100 bg-white px-4 py-3">
                  {option.description && (
                    <p className="whitespace-pre-wrap text-sm leading-relaxed text-slate-600">
                      {option.description}
                    </p>
                  )}
                  {option.content && (
                    <div className="space-y-2 rounded-2xl border border-slate-100 bg-slate-50 px-4 py-3 text-sm text-slate-700">
                      <ReactMarkdown components={markdownComponents}>
                        {option.content}
                      </ReactMarkdown>
                    </div>
                  )}
                  {(option.assetImages?.length ?? 0) > 0 && (
                    <div className="space-y-2">
                      <p className="text-xs font-semibold text-slate-500">
                        콘텐츠 이미지
                      </p>
                      <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
                        {option.assetImages?.map((image, index) => {
                          const imageId =
                            getAssetImageId?.(image, index) ??
                            image.path ??
                            image.url ??
                            String(index);
                          const selected = selectedAssetImageIds?.has(imageId);
                          const retryCount = imageRetryById[imageId] ?? 0;
                          const failed = failedImageIds.has(imageId);
                          return (
                            <article
                              key={image.path || image.url || index}
                              className={`group overflow-hidden rounded-2xl border bg-slate-50 text-left transition ${
                                selected
                                  ? "border-slate-900 shadow-sm ring-2 ring-slate-900/10"
                                  : "border-slate-100 hover:border-slate-300 hover:shadow-md"
                              }`}
                              data-selected={selected ? "true" : "false"}
                            >
                              <button
                                type="button"
                                onClick={() => onToggleAssetImage?.(image, index)}
                                disabled={!canToggleAssetImage}
                                className={`relative block w-full text-left ${
                                  canToggleAssetImage ? "cursor-pointer" : "cursor-default"
                                }`}
                              >
                                {failed ? (
                                  <span className="flex aspect-square w-full flex-col items-center justify-center gap-2 bg-slate-100 px-3 text-center text-xs text-slate-400">
                                    <ImageOff className="size-5" aria-hidden="true" />
                                    이미지를 불러오지 못했습니다
                                  </span>
                                ) : (
                                  <>
                                    {/* eslint-disable-next-line @next/next/no-img-element */}
                                    <img
                                      src={retryImageUrl(image.url, retryCount)}
                                      alt={image.note?.trim() || `미션 콘텐츠 이미지 ${index + 1}`}
                                      className="aspect-square w-full object-cover transition-transform duration-200 group-hover:scale-105"
                                      onLoad={() => {
                                        setFailedImageIds((prev) => {
                                          if (!prev.has(imageId)) return prev;
                                          const next = new Set(prev);
                                          next.delete(imageId);
                                          return next;
                                        });
                                      }}
                                      onError={() => {
                                        if (retryCount >= 2) {
                                          setFailedImageIds((prev) => {
                                            const next = new Set(prev);
                                            next.add(imageId);
                                            return next;
                                          });
                                          return;
                                        }
                                        setImageRetryById((prev) => ({
                                          ...prev,
                                          [imageId]: (prev[imageId] ?? 0) + 1,
                                        }));
                                      }}
                                    />
                                  </>
                                )}
                                {selected && (
                                  <span className="absolute right-2 top-2 inline-flex items-center gap-1 rounded-full bg-slate-900 px-2 py-1 text-[11px] font-semibold text-white shadow-sm">
                                    <Check className="size-3" aria-hidden="true" />
                                    인용됨
                                  </span>
                                )}
                              </button>
                              <div className="border-t border-slate-100 px-3 py-2">
                                {image.note?.trim() && (
                                  <p className="mb-2 text-xs text-slate-500">
                                    {truncateAssetNote(image.note)}
                                  </p>
                                )}
                                <button
                                  type="button"
                                  onClick={() => setPreviewImage({ image, index })}
                                  className="inline-flex h-7 items-center gap-1.5 rounded-md border border-slate-200 bg-white px-2 text-[11px] font-semibold text-slate-500 transition hover:bg-slate-50 hover:text-slate-700"
                                  aria-label={`콘텐츠 이미지 ${index + 1} 확대보기`}
                                  title="확대보기"
                                >
                                  <Maximize2 className="size-3" aria-hidden="true" />
                                  확대보기
                                </button>
                              </div>
                            </article>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      <Dialog
        open={Boolean(previewImage)}
        onOpenChange={(open) => {
          if (!open) setPreviewImage(null);
        }}
      >
        <DialogContent
          aria-describedby="mission-brief-asset-image-description"
          className="max-w-3xl overflow-hidden p-0"
        >
          {previewImage && (
            <>
              <DialogHeader className="border-b border-slate-100 px-5 py-4 pr-12">
                <DialogTitle className="leading-snug">
                  콘텐츠 이미지 {previewImage.index + 1}
                </DialogTitle>
                <DialogDescription id="mission-brief-asset-image-description">
                  미션 콘텐츠 이미지 원본 미리보기
                </DialogDescription>
              </DialogHeader>
              <div className="flex max-h-[calc(100vh-8rem)] flex-col gap-4 overflow-y-auto p-5">
                <div className="flex items-center justify-center rounded-xl bg-slate-100 p-3">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={previewImage.image.url}
                    alt={
                      previewImage.image.note?.trim() ||
                      `콘텐츠 이미지 ${previewImage.index + 1}`
                    }
                    className="max-h-[60vh] max-w-full rounded-lg object-contain"
                  />
                </div>
                {previewImage.image.note?.trim() && (
                  <p className="whitespace-pre-wrap text-sm leading-relaxed text-slate-600">
                    {previewImage.image.note.trim()}
                  </p>
                )}
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
