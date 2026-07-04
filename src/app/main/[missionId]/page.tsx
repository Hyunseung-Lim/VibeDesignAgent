"use client";

import dynamic from "next/dynamic";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import remarkGfm from "remark-gfm";
import { firebaseAuth, db } from "@/lib/firebase";
import { getIdToken, onAuthStateChanged } from "firebase/auth";
import {
  collection,
  doc,
  getDoc,
  setDoc,
  onSnapshot,
} from "firebase/firestore";
import {
  ArrowLeftIcon,
  ArrowDownIcon,
  Minimize2Icon,
  BrainIcon,
  EyeIcon,
  DownloadIcon,
  XIcon,
  HelpCircleIcon,
} from "lucide-react";
import { toast } from "sonner";
import { isAdminEmail } from "@/lib/admin";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ChatBubble } from "@/components/session/chat-bubble";
import { ChatCapabilityCatalog } from "@/components/session/chat-capability-catalog";
import { ChatInput, type ChatInputHandle } from "@/components/session/chat-input";
import { Spinner } from "@/components/ui/spinner";
import { Button } from "@/components/ui/button";
import { ChatPanel } from "@/components/session/chat-panel";
import { DesignStyleSection } from "@/components/session/design-style-section";
import { FinalDesignSelector } from "@/components/session/final-design-selector";
import { IdeaNoteSection } from "@/components/session/idea-note-section";
import {
  TimelineActivityEventCard,
  TimelineMemoryEventCard,
} from "@/components/session/timeline-event-card";
import { MockupSection } from "@/components/session/mockup-section";
import { ReferenceSection } from "@/components/session/reference-section";
import { IdeaWorkspace } from "@/components/session/idea-workspace";
import { MissionBriefSection } from "@/components/session/mission-brief-section";
import { MissionOptionSelection } from "@/components/session/mission-option-selection";
import {
  ProfileInputCard,
  SetupMissionSummaryCard,
} from "@/components/session/session-setup-cards";
import { SessionProductTour } from "@/components/session/session-product-tour";
import { MemoryCard } from "@/components/memory/memory-card";
import { SessionMemoryDiff } from "@/components/memory/session-memory-diff";
import { PromptViewer } from "@/components/admin/prompt-viewer";
import { MemoryClusterList } from "@/components/memory/memory-cluster-list";
import { MemoryClusterSidePanel } from "@/components/memory/memory-cluster-side-panel";
import {
  MemoryReviewPanel,
  type MemoryReviewAnswers,
  type MemoryReviewMentionTarget,
} from "@/components/memory/memory-review-panel";
import {
  cleanMessageContentForModel,
  extractChatPhases,
  normalizeActionBlockAliases,
  processMessageContent,
  splitPendingMockupCompletionText,
} from "@/lib/session/chat-content";
import {
  injectHeightReporter,
  injectNoNavigation,
  injectSelectionScript,
} from "@/lib/session/mockup-html";
import {
  buildMockupPrompt,
  CURRENT_MOCKUP_REFINEMENT_PROMPT,
  defaultMockupPromptForIdea,
  FORKED_STYLE_MOCKUP_PROMPT,
} from "@/lib/prompts";
import type {
  MemoryDraftSources,
  MemorySourceLink,
} from "@/lib/memory-sources";
import type { FinalDesignEnrichmentPayload } from "@/lib/memory-final-design";
import {
  CHAT_COMPOSER_COMMANDS,
  type ChatComposerCommand,
  type ChatComposerCommandId,
  type ChatComposerMention,
} from "@/lib/session/chat-composer";

const ONBOARDING_MISSION_ID = "onboarding";

// Resizable chat panel bounds (px). Default mirrors the previous fixed width
// (max-w-md / md:right-112 = 28rem) so the mockup overlay stays aligned.
const CHAT_MIN_WIDTH = 360;
const CHAT_MAX_WIDTH = 720;
const CHAT_DEFAULT_WIDTH = 448;

// A memory belongs to the cumulative set for the selected mission when it is the
// onboarding base, or was created in a mission at/before the selected one in the
// user's per-user mission order. Mission order is randomized per user, so we
// compare positions in that order (not mission-id time order). When the order is
// unavailable (not loaded, or selected mission not in it — e.g. onboarding), we
// fall back to onboarding + the same mission only.
function isWithinCumulative(
  memoryMissionId: string | null | undefined,
  selectedMissionId: string,
  missionOrder: string[],
) {
  if (memoryMissionId === ONBOARDING_MISSION_ID) return true;
  if (!memoryMissionId) return false;
  const selIdx = missionOrder.indexOf(selectedMissionId);
  if (selIdx === -1) return memoryMissionId === selectedMissionId;
  const memIdx = missionOrder.indexOf(memoryMissionId);
  if (memIdx === -1) return false;
  return memIdx <= selIdx;
}

const MemoryClusterGraph = dynamic(() => import("@/components/memory/memory-cluster-graph"), {
  ssr: false,
  loading: () => (
    <div className="flex h-full min-h-96 items-center justify-center bg-white text-sm text-slate-400">
      Graph view loading...
    </div>
  ),
});

type Message = {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt?: number;
  citedElement?: {
    selector: string;
    artboardId: string;
    outerHTML?: string;
    textContent?: string;
    xpath?: string;
    boundingRect?: SelectedElementBounds;
    viewport?: SelectedElementViewport;
  } | null;
  citedReferences?: { id: string; title: string; imageUrl?: string }[] | null;
  citedTexts?: string[] | null;
  styleImage?: { dataUrl: string; name?: string } | null;
  composerCommand?: ChatComposerCommand | null;
  composerMention?: ChatComposerMention | null;
  reviewTurnId?: string | null;
  chatPhases?: string[];
  // Explicit, prominent error surfaced in the chat bubble (red callout),
  // independent of the collapsible phase toggle. See QA: 목업/요청 에러 명시.
  error?: string;
};

type ChatResponseProvider = "openai" | "anthropic";

type ReviewTurnMemory = {
  memoryId: string;
  type?: string;
  action?: string;
  keyword?: string[];
  episodic?: string;
  semantic?: string | null;
  input?: string;
  output?: string;
  link?: string | null;
  embeddingSource?: string | null;
  schemaVersion?: string | null;
  weight?: number | null;
  weightDelta?: number | null;
  similarity?: number | null;
  source?: {
    missionId?: string;
    draftId?: string;
  } | null;
};

type ReviewTurnPromptPlan = {
  intent?: string;
  confidence?: number;
  needs?: Record<string, unknown>;
  reason?: string;
};

type ReviewTurn = {
  userMessageId?: string;
  createdAt?: number;
  query?: string;
  retrieved?: ReviewTurnMemory[];
  promptPlan?: ReviewTurnPromptPlan;
  promptPlanFallback?: boolean;
  selectedContextKeys?: string[];
  promptCompact?: {
    promptPlan?: ReviewTurnPromptPlan;
    promptPlanFallback?: boolean;
    selectedContextKeys?: string[];
    missionBrief?: string;
    activeIdea?: {
      title?: string;
      description?: string;
    } | null;
    citedTexts?: string[];
    citedReferences?: unknown[];
  };
  rawPrompt?: unknown;
  rawPromptSanitization?: unknown;
  rawResponseMeta?: unknown;
};

type ReviewMemoryArchiveStatus = {
  memoryId: string;
  archivedAt: number | null;
  archiveReason: string | null;
  duplicateOf: string | null;
  duplicate?: {
    memoryId?: string;
    semanticItemId?: string | null;
    semantic?: string | null;
    episodic?: string;
    similarity?: number;
  } | null;
};

type SessionMemoryItem = {
  id: string;
  episodic?: string | null;
  semantic?: string | null;
  input?: string | null;
  output?: string | null;
  originalInteractionContent?: string | null;
  agentActionCategory?: string | null;
  keyword?: string[];
  keywords?: string[];
  status?: string | null;
  promotedAt?: number | null;
  timestamp?: number | null;
  weight?: number | null;
  embedding?: number[];
  archivedAt?: number | null;
  archiveReason?: string | null;
  duplicateOf?: string | null;
  sourceType?: string | null;
  duplicate?: {
    memoryId?: string;
    semantic?: string | null;
    similarity?: number;
  } | null;
  source?: { missionId?: string; draftId?: string } | null;
};

type ReviewTimelineItem =
  | { type: "message"; message: Message }
  | { type: "memory-event"; memory: SessionMemoryItem }
  | { type: "activity-event"; event: ActivityLogEvent };

type ReferencedSessionMemoryItem = SessionMemoryItem & {
  memoryId: string;
  semanticItemId?: string | null;
  referenceCount?: number;
  firstReferencedAt?: number | null;
  lastReferencedAt?: number | null;
  similarity?: number | null;
  weightBefore?: number | null;
  weightAfter?: number | null;
  weightDelta?: number | null;
};

type IdleDecaySummary = {
  memoryCount: number;
  totalDelta: number;
};

type SessionGraphCluster = {
  id: string;
  label: string;
  summary: string;
  count: number;
  relatedActions: string[];
  itemIds: string[];
  representativeItems: string[];
};

type SessionGraphEdge = {
  sourceId: string;
  targetId: string;
  weight: number;
};

// Fixed clustering input used by the review graph and /agent.
const REVIEW_CLUSTER_VARIANTS = [
  { value: "keyword-episodic-semantic-link" },
] as const;
type ReviewClusterVariant = (typeof REVIEW_CLUSTER_VARIANTS)[number]["value"];

type ReviewClusterBundle = {
  graphClusters: SessionGraphCluster[];
  graphEdges: SessionGraphEdge[];
};

type SessionMemorySummary = {
  drafts: SessionMemoryItem[];
  promoted: SessionMemoryItem[];
  referenced: ReferencedSessionMemoryItem[];
  idleDecaySummary: IdleDecaySummary;
  graphMemories: SessionMemoryItem[];
  graphClusters: SessionGraphCluster[];
  graphEdges: SessionGraphEdge[];
  clustersByVariant: Record<ReviewClusterVariant, ReviewClusterBundle>;
  // The target user's per-user mission order, used to compute the cumulative set.
  missionOrder: string[];
};

type MemoryGraphFilter = "changed" | "all" | "referenced" | "promoted" | "archived";

const EMPTY_CLUSTERS_BY_VARIANT: Record<ReviewClusterVariant, ReviewClusterBundle> =
  {
    "keyword-episodic-semantic-link": { graphClusters: [], graphEdges: [] },
  };

const EMPTY_SESSION_MEMORY_SUMMARY: SessionMemorySummary = {
  drafts: [],
  promoted: [],
  referenced: [],
  idleDecaySummary: { memoryCount: 0, totalDelta: 0 },
  graphMemories: [],
  graphClusters: [],
  graphEdges: [],
  clustersByVariant: EMPTY_CLUSTERS_BY_VARIANT,
  missionOrder: [],
};

type ActivityLogEvent = {
  id: string;
  createdAt: number;
  section: "reference" | "note" | "mockup";
  action: "add" | "delete" | "create" | "update" | "stitch_prompt";
  input?: string;
  output?: string;
  outputTitle?: string;
  link?: string;
  imageUrl?: string;
  html?: string;
  stitchPrompt?: string;
};

type MemoryRecord = {
  id: string;
  action?: string;
  keyword?: string[];
  category?: string[];
  subcategory?: string[];
  keywords?: string[];
  episodic?: string;
  episode?: string;
  semantic?: string | null;
  input?: string;
  output?: string;
  originalInteractionContent?: string;
  link?: string | null;
  weight?: number;
  retentionScore?: number;
  similarity?: number;
  retrievedCount?: number;
  timestamp?: number;
  createdAt?: number;
  clusterId?: string | null;
  clusterLabel?: string | null;
  clusterSummary?: string | null;
};

type MemoryRetrievalResponse = {
  retrieved?: MemoryRecord[];
};

const CHAT_REMARK_PLUGINS = [remarkGfm];

// 한 줄 진행 문구. 타이머가 아니라 completeSession 의 실제 await 경계마다 바뀐다.
// 0: 메모리 저장(complete-session), 1: 클러스터 분석(clusters), 2: 리뷰 요약 준비(summary).
const SESSION_PROGRESS_MESSAGES = [
  "이번 세션의 기억을 저장하고 있어요",
  "기억 묶음을 분석하고 있어요",
  "리뷰 화면을 준비하고 있어요",
] as const;

function sessionMemorySummaryKey(targetUid: string, missionId: string) {
  return `${targetUid}:${missionId}`;
}

async function fetchSessionMemorySummary(
  token: string,
  targetUid: string,
  missionId: string,
): Promise<SessionMemorySummary> {
  const res = await fetch("/api/memory/session-summary", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      targetUid,
      missionId,
    }),
  });
  if (!res.ok) throw new Error(`Session memory summary failed: ${res.status}`);
  const data = await res.json().catch(() => null);
  return {
    drafts: Array.isArray(data?.drafts) ? data.drafts : [],
    promoted: Array.isArray(data?.promoted) ? data.promoted : [],
    referenced: Array.isArray(data?.referenced) ? data.referenced : [],
    idleDecaySummary:
      data?.idleDecaySummary &&
      typeof data.idleDecaySummary.memoryCount === "number"
        ? {
            memoryCount: data.idleDecaySummary.memoryCount,
            totalDelta:
              typeof data.idleDecaySummary.totalDelta === "number"
                ? data.idleDecaySummary.totalDelta
                : 0,
          }
        : { memoryCount: 0, totalDelta: 0 },
    graphMemories: Array.isArray(data?.graphMemories)
      ? data.graphMemories
      : [],
    graphClusters: Array.isArray(data?.graphClusters)
      ? data.graphClusters
      : [],
    graphEdges: Array.isArray(data?.graphEdges) ? data.graphEdges : [],
    clustersByVariant: parseClustersByVariant(data?.clustersByVariant),
    missionOrder: Array.isArray(data?.missionOrder) ? data.missionOrder : [],
  };
}

function parseClustersByVariant(
  value: unknown,
): Record<ReviewClusterVariant, ReviewClusterBundle> {
  const source = (value ?? {}) as Record<string, unknown>;
  return REVIEW_CLUSTER_VARIANTS.reduce(
    (acc, { value: variant }) => {
      const bundle = source[variant] as Partial<ReviewClusterBundle> | undefined;
      acc[variant] = {
        graphClusters: Array.isArray(bundle?.graphClusters)
          ? bundle.graphClusters
          : [],
        graphEdges: Array.isArray(bundle?.graphEdges) ? bundle.graphEdges : [],
      };
      return acc;
    },
    {} as Record<ReviewClusterVariant, ReviewClusterBundle>,
  );
}

const CHAT_MARKDOWN_COMPONENTS = {
  p: ({ children }: { children?: React.ReactNode }) => (
    <p className="mb-2 last:mb-0">{children}</p>
  ),
  ul: ({ children }: { children?: React.ReactNode }) => (
    <ul className="mb-2 ml-4 list-disc space-y-1">{children}</ul>
  ),
  ol: ({ children }: { children?: React.ReactNode }) => (
    <ol className="mb-2 ml-4 list-decimal space-y-1">{children}</ol>
  ),
  li: ({ children }: { children?: React.ReactNode }) => <li>{children}</li>,
  strong: ({ children }: { children?: React.ReactNode }) => (
    <strong className="font-semibold">{children}</strong>
  ),
  code: ({ children }: { children?: React.ReactNode }) => (
    <code className="rounded bg-slate-200 px-1 py-0.5 font-mono text-xs text-slate-800">
      {children}
    </code>
  ),
  pre: ({ children }: { children?: React.ReactNode }) => (
    <pre className="mt-1 max-h-36 overflow-y-auto rounded-xl bg-slate-800 p-3 text-xs text-slate-100">
      {children}
    </pre>
  ),
  h1: ({ children }: { children?: React.ReactNode }) => (
    <h1 className="mb-1 text-base font-semibold">{children}</h1>
  ),
  h2: ({ children }: { children?: React.ReactNode }) => (
    <h2 className="mb-1 text-sm font-semibold">{children}</h2>
  ),
  h3: ({ children }: { children?: React.ReactNode }) => (
    <h3 className="mb-1 text-sm font-medium">{children}</h3>
  ),
  a: ({ href, children }: { href?: string; children?: React.ReactNode }) => (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="text-indigo-500 underline underline-offset-2 hover:text-indigo-700"
    >
      {children}
    </a>
  ),
  table: ({ children }: { children?: React.ReactNode }) => (
    <div className="my-3 block max-w-full overflow-x-auto overscroll-x-contain rounded-xl border border-slate-200">
      <table className="w-max min-w-full table-auto border-collapse text-left text-xs">
        {children}
      </table>
    </div>
  ),
  thead: ({ children }: { children?: React.ReactNode }) => (
    <thead className="bg-slate-50 text-slate-600">{children}</thead>
  ),
  th: ({ children }: { children?: React.ReactNode }) => (
    <th className="whitespace-nowrap border-b border-slate-200 px-3 py-2 font-semibold">
      {children}
    </th>
  ),
  td: ({ children }: { children?: React.ReactNode }) => (
    <td className="whitespace-nowrap border-t border-slate-100 px-3 py-2 align-top text-slate-700">
      {children}
    </td>
  ),
};

type Reference = {
  id: string;
  title: string;
  description: string;
  rationale?: string;
  tag: string;
  url?: string;
  imageUrl?: string;
  referenceMode?: "style" | "product";
  searchProvider?: "openai-web";
  referencePurpose?: "visual_style" | "page_structure" | "content_components";
  referencePurposeLabel?: string;
};

function missionAssetImageReferenceId(
  optionId: string | null | undefined,
  image: AssetImage,
  index: number,
) {
  return [
    "mission-asset",
    optionId || "mission",
    image.path || image.url || String(index),
  ].join(":");
}

function missionAssetImageReference(
  optionId: string | null | undefined,
  image: AssetImage,
  index: number,
  missionTitle: string,
): Reference {
  const note = image.note?.trim();
  const title = `미션 이미지 ${index + 1}`;
  return {
    id: missionAssetImageReferenceId(optionId, image, index),
    title,
    description: note || `${missionTitle || "현재 미션"}에 포함된 이미지`,
    rationale: "사용자가 미션 브리프 이미지에서 인용함",
    tag: "미션 이미지",
    url: image.url,
    imageUrl: image.url,
    referencePurposeLabel: "미션 이미지",
  };
}

function memorySourceLinkFromReference(
  reference: Reference,
): MemorySourceLink {
  return {
    title: reference.title,
    url: reference.url,
    description: reference.description,
    rationale: reference.rationale,
    imageUrl: reference.imageUrl,
    referenceMode: reference.referenceMode,
    searchProvider: reference.searchProvider,
    referencePurpose: reference.referencePurpose,
    referencePurposeLabel: reference.referencePurposeLabel,
  };
}

type ReferencePreferenceContext = {
  scope: "mission";
  missionId: string;
  kept: Array<{
    title: string;
    description?: string;
    rationale?: string;
    tag?: string;
    url?: string;
    referenceMode?: Reference["referenceMode"];
    searchProvider?: Reference["searchProvider"];
    referencePurpose?: Reference["referencePurpose"];
    referencePurposeLabel?: string;
    signal: "weak_kept";
  }>;
  cited: Array<{
    title: string;
    description?: string;
    rationale?: string;
    tag?: string;
    url?: string;
    referenceMode?: Reference["referenceMode"];
    searchProvider?: Reference["searchProvider"];
    referencePurpose?: Reference["referencePurpose"];
    referencePurposeLabel?: string;
    signal: "strong_cited";
  }>;
  deleted: Array<{
    title?: string;
    description?: string;
    rationale?: string;
    tag?: string;
    url?: string;
    signal: "negative_deleted";
  }>;
};

type ReferenceFetchResult = {
  references: Reference[];
  message?: string;
};

type DesignStyle = {
  id: string;
  title: string;
  content: string;
  createdAt?: number;
};

type Idea = {
  id: string;
  title: string;
  description: string;
  designStyle?: DesignStyle;
  createdAt?: number;
  updatedAt?: number;
};

type Device = "desktop" | "mobile";

type AssetImage = {
  url: string;
  path?: string;
  note?: string;
};

type MissionOption = {
  id: string;
  title: string;
  description: string;
  content: string;
  device?: Device;
  assetImages?: AssetImage[];
};

type Artboard = {
  id: string;
  html: string;
  label: string;
  createdAt?: number;
  htmlUpdatedAt?: number;
  x: number;
  y: number;
  device: Device;
  stitchScreenId?: string;
  ideaId: string;
  htmlStatus?: "pending" | "failed";
};

type DestructiveSessionAction =
  | { type: "idea"; idea: Idea }
  | { type: "design"; artboard: Artboard; ideaTitle: string }
  | { type: "reference"; reference: Reference };

const DEVICE_SIZE: Record<Device, { width: number; height: number }> = {
  desktop: { width: 1280, height: 900 },
  mobile: { width: 390, height: 844 },
};

type SelectedElement = {
  artboardId: string;
  selector: string;
  outerHTML: string;
  textContent?: string;
  xpath?: string;
  boundingRect?: SelectedElementBounds;
  viewport?: SelectedElementViewport;
};

type SelectedElementBounds = {
  x: number;
  y: number;
  width: number;
  height: number;
  top?: number;
  right?: number;
  bottom?: number;
  left?: number;
};

type SelectedElementViewport = {
  width: number;
  height: number;
};

function selectedElementTargetPrompt(element: SelectedElement) {
  const rect = element.boundingRect;
  const viewport = element.viewport;
  return [
    "Selected element target:",
    "Apply the requested edit to this selected element/region first. Do not change similar elements elsewhere unless explicitly requested.",
    `Selector: ${element.selector}`,
    element.xpath ? `XPath: ${element.xpath}` : "",
    rect
      ? `Bounding rect in mockup viewport: x=${rect.x}, y=${rect.y}, width=${rect.width}, height=${rect.height}`
      : "",
    viewport
      ? `Mockup viewport: width=${viewport.width}, height=${viewport.height}`
      : "",
    element.textContent ? `Visible text: ${element.textContent.slice(0, 1000)}` : "",
    `Selected HTML:\n${element.outerHTML.slice(0, 3000)}`,
  ]
    .filter(Boolean)
    .join("\n");
}

function quickHash(value: string) {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) | 0;
  }
  return hash.toString(16);
}

type CreateNoteData = {
  title?: string;
  description?: string;
};

type UpdateNoteData = {
  title?: string;
  description?: string;
};


function canonicalReferenceUrl(value?: string) {
  if (!value) return "";
  try {
    const url = new URL(value);
    url.hash = "";
    Array.from(url.searchParams.keys()).forEach((key) => {
      if (/^(utm_|fbclid|gclid|igshid|mc_cid|mc_eid)/i.test(key)) {
        url.searchParams.delete(key);
      }
    });
    url.searchParams.sort();
    const pathname =
      url.pathname !== "/" ? url.pathname.replace(/\/+$/, "") : "";
    return `${url.hostname.replace(/^www\./, "").toLowerCase()}${pathname}${url.search}`;
  } catch {
    return value.trim().replace(/\/+$/, "").toLowerCase();
  }
}

function referenceMatches(a: Reference, b: Reference) {
  const aUrl = canonicalReferenceUrl(a.url);
  const bUrl = canonicalReferenceUrl(b.url);
  const aImage = canonicalReferenceUrl(a.imageUrl);
  const bImage = canonicalReferenceUrl(b.imageUrl);
  return Boolean((aUrl && aUrl === bUrl) || (aImage && aImage === bImage));
}

function missionAssetProxyUrl(path?: string) {
  const objectName = String(path ?? "").trim();
  if (!objectName.startsWith("mission-assets/")) return "";
  const base =
    typeof window === "undefined" ? "http://localhost" : window.location.origin;
  const url = new URL("/api/mission-assets", base);
  url.searchParams.set("path", objectName);
  return url.toString();
}

function normalizeAssetImage(image: AssetImage) {
  const path = typeof image?.path === "string" ? image.path : "";
  const proxyUrl = missionAssetProxyUrl(path);
  return {
    url: proxyUrl || (typeof image?.url === "string" ? image.url : ""),
    path,
    note: typeof image?.note === "string" ? image.note : "",
  };
}

function buildReferencePreferenceContext(
  missionId: string,
  references: Reference[],
  activityLog: ActivityLogEvent[],
  messages: Message[],
  currentRequest?: string,
): ReferencePreferenceContext | null {
  const request = currentRequest?.trim() ?? "";
  const shouldSuppressWeakKept =
    /\b(real|actual|official|live|store|shop|selling|ecommerce|product)\b/i.test(
      request,
    ) ||
    /실제|공식|판매|파는|스토어|상점|쇼핑몰|웹사이트|사이트|없나|찾아|검색|다시/.test(
      request,
    );
  const citedIds = new Set(
    messages.flatMap((message) =>
      (message.citedReferences ?? []).map((reference) => reference.id),
    ),
  );
  const citedTitles = new Set(
    messages.flatMap((message) =>
      (message.citedReferences ?? []).map((reference) =>
        reference.title.trim().toLowerCase(),
      ),
    ),
  );
  const cited = references
    .filter(
      (reference) =>
        citedIds.has(reference.id) ||
        citedTitles.has(reference.title.trim().toLowerCase()),
    )
    .slice(-6)
    .map((reference) => ({
      title: reference.title,
      description: reference.description,
      rationale: reference.rationale,
      tag: reference.tag,
      url: reference.url,
      referenceMode: reference.referenceMode,
      searchProvider: reference.searchProvider,
      referencePurpose: reference.referencePurpose,
      referencePurposeLabel: reference.referencePurposeLabel,
      signal: "strong_cited" as const,
    }));
  const citedUrls = new Set(cited.map((reference) => reference.url).filter(Boolean));
  const kept = shouldSuppressWeakKept
    ? []
    : references
        .filter((reference) => !citedUrls.has(reference.url))
        .slice(-8)
        .map((reference) => ({
          title: reference.title,
          description: reference.description,
          rationale: reference.rationale,
          tag: reference.tag,
          url: reference.url,
          referenceMode: reference.referenceMode,
          searchProvider: reference.searchProvider,
          referencePurpose: reference.referencePurpose,
          referencePurposeLabel: reference.referencePurposeLabel,
          signal: "weak_kept" as const,
        }));
  const deleted = activityLog
    .filter((event) => event.section === "reference" && event.action === "delete")
    .slice(-6)
    .map((event) => ({
      title: event.outputTitle,
      description: event.output,
      url: event.link,
      signal: "negative_deleted" as const,
    }));
  if (kept.length === 0 && cited.length === 0 && deleted.length === 0) {
    return null;
  }
  return {
    scope: "mission",
    missionId,
    kept,
    cited,
    deleted,
  };
}

function normalizeMissionOptions(
  mission: {
    title?: string;
    description?: string;
    options?: MissionOption[];
  } | null,
): MissionOption[] {
  const options = (mission?.options ?? [])
    .filter((option) => option?.title?.trim())
    .map((option) => ({
      id: option.id || crypto.randomUUID(),
      title: option.title ?? "",
      description: option.description ?? "",
      device: option.device,
      content: option.content ?? "",
      assetImages: Array.isArray(option.assetImages)
        ? option.assetImages
            .map((image) => normalizeAssetImage(image))
            .filter((image) => /^https?:\/\//i.test(image.url))
        : [],
    }));
  if (options.length > 0) return options;
  if (mission?.title || mission?.description) {
    return [
      {
        id: "fallback-option",
        title: mission.title || "미션 옵션",
        description: mission.description || "",
        content: mission.description || "",
      },
    ];
  }
  return [];
}

function optionBrief(option: MissionOption | null) {
  if (!option) return "";
  return [
    option.description,
    option.content ? `웹/앱에 들어가야 하는 콘텐츠:\n${option.content}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");
}

function createDefaultOnboardingMissionData() {
  return {
    title: "온보딩 미션",
    description:
      "자유주제로 PC 또는 모바일 화면을 선택해 Design Brief, 목업, 프레젠테이션 생성 흐름을 연습합니다.",
    durationMinutes: 20,
    options: [
      {
        id: "onboarding-desktop",
        title: "PC 자유주제",
        description: "PC 화면 기준으로 자유롭게 웹/앱 아이디어를 진행합니다.",
        device: "desktop" as Device,
        content:
          "자유주제로 랜딩 페이지, 서비스 화면, 포트폴리오, 커머스 등 원하는 웹/앱 화면을 만들어보세요.",
      },
      {
        id: "onboarding-mobile",
        title: "모바일 자유주제",
        description:
          "모바일 화면 기준으로 자유롭게 앱/웹 아이디어를 진행합니다.",
        device: "mobile" as Device,
        content:
          "자유주제로 온보딩, 홈 화면, 상세 화면, 예약/구독/커머스 등 원하는 모바일 화면을 만들어보세요.",
      },
    ],
  };
}

async function fetchOnboardingMissionData() {
  const fallback = createDefaultOnboardingMissionData();
  try {
    const res = await fetch("/api/onboarding");
    if (!res.ok) return fallback;
    const settings = (await res.json()) as {
      durationMinutes?: number;
    };
    return {
      ...fallback,
      durationMinutes: Number(settings.durationMinutes) || 20,
    };
  } catch {
    return fallback;
  }
}

function extractJsonActionPayload(
  text: string,
  tag: "CREATE_NOTE" | "UPDATE_NOTE" | "CREATE_DESIGN_SPEC",
) {
  const start = text.indexOf(`[${tag}:`);
  if (start === -1) return null;

  const payloadStart = text.indexOf("{", start);
  if (payloadStart === -1) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = payloadStart; i < text.length; i += 1) {
    const char = text[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === "\\") {
      escaped = true;
      continue;
    }
    if (char === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (char === "{") depth += 1;
    if (char === "}") {
      depth -= 1;
      if (depth === 0) return text.slice(payloadStart, i + 1);
    }
  }

  return null;
}

function extractPlainNoteContent(
  text: string,
  tag: "CREATE_NOTE" | "UPDATE_NOTE" | "CREATE_DESIGN_SPEC",
): string | null {
  const marker = `[${tag}:`;
  const start = text.indexOf(marker);
  if (start === -1) return null;
  let depth = 1;
  let i = start + marker.length;
  const contentStart = i;
  while (i < text.length && depth > 0) {
    if (text[i] === "[") depth++;
    else if (text[i] === "]") depth--;
    i++;
  }
  if (depth !== 0) return null;
  return text.slice(contentStart, i - 1).trim();
}

function parsePlainNotePayload(payload: string): {
  title?: string;
  description: string;
} {
  const trimmed = payload.trim();
  const keyValue = trimmed.match(
    /^(?:제목|title)\s*[:=]\s*([^;\n]+)\s*[;\n]\s*(?:내용|본문|description|content|body|note)\s*[:=]\s*([\s\S]+)$/i,
  );
  if (keyValue) {
    return {
      title: keyValue[1]?.trim() || undefined,
      description: keyValue[2]?.trim() ?? "",
    };
  }

  const contentOnly = trimmed.match(
    /^(?:내용|본문|description|content|body|note)\s*[:=]\s*([\s\S]+)$/i,
  );
  if (contentOnly) {
    return { description: contentOnly[1]?.trim() ?? "" };
  }

  return { description: trimmed };
}

// Models sometimes emit the note body under a non-standard key. Accept the
// common aliases so a populated note doesn't get dropped as "empty".
const NOTE_CONTENT_KEYS = [
  "description",
  "content",
  "body",
  "text",
  "note",
  "markdown",
];

function pickNoteContent(obj: Record<string, unknown>): string {
  for (const key of NOTE_CONTENT_KEYS) {
    const value = obj[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

// Best-effort recovery of a string field from a malformed JSON payload — most
// commonly the model emits unescaped newlines inside the value, which makes
// JSON.parse throw even though the content is intact.
function extractStringFieldLoose(payload: string, keys: string[]): string {
  for (const key of keys) {
    const match = payload.match(
      new RegExp(`"${key}"\\s*:\\s*"((?:[^"\\\\]|\\\\.)*)"`, "i"),
    );
    if (!match) continue;
    try {
      const decoded = JSON.parse(`"${match[1]}"`) as string;
      if (decoded.trim()) return decoded.trim();
    } catch {
      if (match[1].trim()) return match[1].trim();
    }
  }
  return "";
}

// Shared parser for [CREATE_NOTE:] / [UPDATE_NOTE:]. Always returns an object
// when the tag is present (description may be "") so the caller can log and
// guard the empty case instead of silently dropping the turn.
function parseNoteBlock(
  text: string,
  tag: "CREATE_NOTE" | "UPDATE_NOTE",
): { title?: string; description: string } | null {
  if (!text.includes(`[${tag}:`)) return null;

  const jsonPayload = extractJsonActionPayload(text, tag);
  if (jsonPayload) {
    try {
      const parsed = JSON.parse(jsonPayload) as Record<string, unknown>;
      const title =
        typeof parsed.title === "string" ? parsed.title.trim() : undefined;
      return { title, description: pickNoteContent(parsed) };
    } catch {
      const title = extractStringFieldLoose(jsonPayload, ["title"]);
      return {
        title: title || undefined,
        description: extractStringFieldLoose(jsonPayload, NOTE_CONTENT_KEYS),
      };
    }
  }

  const plain = extractPlainNoteContent(text, tag);
  return plain && !plain.startsWith("{")
    ? parsePlainNotePayload(plain)
    : { description: "" };
}

function parseCreateNoteBlock(text: string): CreateNoteData | null {
  return parseNoteBlock(text, "CREATE_NOTE");
}

const NOTE_ACTION_TAGS = [
  "CREATE_NOTE",
  "UPDATE_NOTE",
  "CREATE_DESIGN_SPEC",
] as const;

function actionBlockEnd(text: string, start: number, tag: string) {
  const marker = `[${tag}:`;
  const payloadStart = start + marker.length;
  const jsonStart = text.indexOf("{", payloadStart);
  const bracketEnd = (() => {
    let depth = 1;
    for (let i = payloadStart; i < text.length; i += 1) {
      if (text[i] === "[") depth += 1;
      else if (text[i] === "]") {
        depth -= 1;
        if (depth === 0) return i + 1;
      }
    }
    return -1;
  })();

  if (jsonStart !== -1 && (bracketEnd === -1 || jsonStart < bracketEnd)) {
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let i = jsonStart; i < text.length; i += 1) {
      const char = text[i];
      if (escaped) {
        escaped = false;
        continue;
      }
      if (char === "\\") {
        escaped = true;
        continue;
      }
      if (char === '"') {
        inString = !inString;
        continue;
      }
      if (inString) continue;
      if (char === "{") depth += 1;
      if (char === "}") {
        depth -= 1;
        if (depth === 0) {
          let end = i + 1;
          while (/\s/.test(text[end] ?? "")) end += 1;
          if (text[end] === "]") end += 1;
          return end;
        }
      }
    }
  }

  return bracketEnd === -1 ? text.length : bracketEnd;
}

function stripNoteActionBlocks(text: string) {
  let result = text;
  for (;;) {
    const starts = NOTE_ACTION_TAGS.map((tag) => ({
      tag,
      index: result.indexOf(`[${tag}:`),
    })).filter((entry) => entry.index !== -1);
    const next = starts.sort((a, b) => a.index - b.index)[0];
    if (!next) break;
    const end = actionBlockEnd(result, next.index, next.tag);
    result = `${result.slice(0, next.index)}${result.slice(end)}`;
  }
  return result
    .replace(/\n{3,}/g, "\n\n")
    .replace(/^\s*(?:좋아요\.?|알겠습니다\.?)\s*/i, "")
    .trim();
}

function isSubstantiveDesignBrief(description: string) {
  const normalized = description.replace(/\s+/g, " ").trim();
  const substantiveUnits = description
    .split(/(?:\n+|[.!?。]\s*)/)
    .map((line) => line.replace(/^\s*(?:[-*]|\d+[.)])\s*/, "").trim())
    .filter((line) => line.length >= 24);
  const looksLikeTaskStatement =
    normalized.length < 180 &&
    /(?:시안|브리프|노트).{0,24}(?:작성|정리|생성|제안|설계)|(?:작성|정리|생성|제안|설계).{0,24}(?:시안|브리프|노트)/i.test(
      normalized,
    );
  return (
    !looksLikeTaskStatement &&
    (substantiveUnits.length >= 3 ||
      (normalized.length >= 180 && substantiveUnits.length >= 2))
  );
}

function recoverThinDesignBrief(
  description: string,
  userRequest: string,
  missionContext?: string,
) {
  if (isSubstantiveDesignBrief(description)) return description.trim();

  const direction = description.trim().slice(0, 1500);
  const request = userRequest.trim().slice(0, 1000);
  const mission = missionContext?.trim().slice(0, 5000);
  return [
    "## 목표와 맥락",
    direction || request || "미션 요구사항을 충족하는 구체적인 디자인 시안을 만든다.",
    mission ? `## 필수 요구사항\n${mission}` : "",
    request && request !== direction ? `## 사용자 요청\n${request}` : "",
    "## 핵심 경험과 화면 구성",
    "미션의 필수 콘텐츠와 요구사항이 화면의 정보 구조, 주요 섹션, 사용자 행동 흐름에 빠짐없이 드러나도록 구성한다.",
    "## 완료 기준",
    "디자이너가 이 문서만 보고 대상 사용자, 화면 목적, 필수 콘텐츠와 주요 인터랙션을 판단해 목업을 시작할 수 있어야 한다.",
  ]
    .filter(Boolean)
    .join("\n\n")
    .slice(0, 8000);
}

function resolveDesignBriefPayload(
  description: string,
  assistantText: string,
  userRequest: string,
  missionContext: string | undefined,
  options?: { allowMissionRecovery?: boolean },
) {
  const trimmed = description.trim();
  if (isSubstantiveDesignBrief(trimmed)) {
    return { description: trimmed, source: "payload" as const };
  }

  const assistantBrief = stripNoteActionBlocks(assistantText);
  if (isSubstantiveDesignBrief(assistantBrief)) {
    return {
      description: assistantBrief.slice(0, 8000),
      source: "assistant_text" as const,
    };
  }

  if (options?.allowMissionRecovery) {
    return {
      description: recoverThinDesignBrief(
        trimmed,
        userRequest,
        missionContext,
      ),
      source: "mission_recovery" as const,
    };
  }

  return { description: trimmed, source: "payload" as const };
}

function shouldRecoverThinUpdateNote(
  userRequest: string,
  commandId?: ChatComposerCommandId,
  activeIdea?: Idea | null,
) {
  if (commandId === "create_idea") return true;
  if (activeIdea && !activeIdea.description.trim()) return true;
  return /(?:디자인\s*)?브리프|design\s*brief|시안/i.test(userRequest) &&
    /(?:만들|생성|작성|정리|써줘|만들어|create|generate|write)/i.test(
      userRequest,
    );
}

function parseUpdateNoteBlock(text: string): UpdateNoteData | null {
  return parseNoteBlock(text, "UPDATE_NOTE");
}

function parseCreateDesignSpecBlock(
  text: string,
): { title: string; content: string } | null {
  if (!text.includes("[CREATE_DESIGN_SPEC:")) return null;

  const jsonPayload = extractJsonActionPayload(text, "CREATE_DESIGN_SPEC");
  if (jsonPayload) {
    try {
      const parsed = JSON.parse(jsonPayload) as Record<string, unknown>;
      const content = pickNoteContent(parsed);
      const title =
        typeof parsed.title === "string" && parsed.title.trim()
          ? parsed.title.trim()
          : "디자인 스타일";
      return { title, content };
    } catch {
      return {
        title:
          extractStringFieldLoose(jsonPayload, ["title"]) || "디자인 스타일",
        content: extractStringFieldLoose(jsonPayload, NOTE_CONTENT_KEYS),
      };
    }
  }

  const plain = extractPlainNoteContent(text, "CREATE_DESIGN_SPEC");
  if (!plain) return null;
  const parsed = parsePlainNotePayload(plain);
  return {
    title: parsed.title?.trim() || "디자인 스타일",
    content: parsed.description.trim(),
  };
}

function stripDesignSpecActionBlocks(content: string) {
  return content
    .replace(/\[CREATE_DESIGN_SPEC:[\s\S]*?(?:\](?=\s|$)|$)/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function isSameDesignStyle(a?: string | null, b?: string | null) {
  const normalize = (value?: string | null) =>
    (value ?? "").replace(/\s+/g, " ").trim().toLowerCase();
  const left = normalize(a);
  const right = normalize(b);
  return Boolean(left && right && left === right);
}

function normalizeMockupActionPrompt(rawPrompt: string) {
  const prompt = rawPrompt.trim();
  if (!prompt.startsWith("{") || !prompt.endsWith("}")) return prompt;

  try {
    const parsed = JSON.parse(prompt) as { prompt?: unknown };
    if (typeof parsed.prompt === "string" && parsed.prompt.trim()) {
      return parsed.prompt.trim();
    }
  } catch {
    return prompt;
  }

  return prompt;
}

function csvCell(value: unknown) {
  const text = String(value ?? "");
  return `"${text.replace(/"/g, '""')}"`;
}

function safeFilenamePart(value: string) {
  return value
    .trim()
    .replace(/[^a-zA-Z0-9가-힣_-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function parseManualReferencePrompt(text: string): Reference | null {
  if (!/레퍼런스(?:로|에)?\s*(?:넣|추가|등록)/i.test(text)) return null;

  const match = text.match(
    /(?:https?:\/\/|www\.)[^\s"'<>]+|[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}(?:\/[^\s"'<>]*)?/,
  );
  if (!match) return null;

  const rawUrl = match[0].replace(/[),.，。]+$/g, "");
  const url = /^https?:\/\//i.test(rawUrl) ? rawUrl : `https://${rawUrl}`;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }

  const hostname = parsed.hostname.replace(/^www\./, "");
  const isImageUrl = /\.(?:avif|gif|jpe?g|png|svg|webp)$/i.test(
    parsed.pathname,
  );

  return {
    id: `manual-ref-${Date.now()}`,
    title: hostname,
    description: "사용자가 직접 추가한 레퍼런스",
    tag: hostname,
    url: parsed.toString(),
    imageUrl: isImageUrl ? parsed.toString() : undefined,
  };
}

async function hydrateManualReference(
  reference: Reference,
): Promise<Reference> {
  if (reference.imageUrl) return reference;

  try {
    const res = await fetch(
      `/api/reference-metadata?url=${encodeURIComponent(reference.url ?? "")}`,
    );
    if (!res.ok) return reference;
    const data = (await res.json()) as {
      title?: string | null;
      imageUrl?: string | null;
    };
    return {
      ...reference,
      title: data.title?.trim() || reference.title,
      imageUrl: data.imageUrl || reference.imageUrl,
    };
  } catch {
    return reference;
  }
}

function extractFirstUrl(text: string): string | null {
  const match = text.match(/https?:\/\/[^\s)]+/i);
  return match ? match[0].replace(/[.,]+$/, "") : null;
}

const ARTBOARD_GAP = 120;
const MIN_CANVAS_SCALE = 0.1;
const MAX_CANVAS_SCALE = 4;

type WebKitGestureEvent = Event & {
  scale?: number;
  clientX?: number;
  clientY?: number;
};

function activeDesignStyle(idea?: Idea | null) {
  return idea?.designStyle ?? null;
}

function nextDraftTitle(ideas: Idea[]) {
  const usedNumbers = ideas
    .map((idea) => idea.title.match(/^시안\s*(\d+)$/)?.[1])
    .filter(Boolean)
    .map(Number);
  const maxNumber =
    usedNumbers.length > 0 ? Math.max(...usedNumbers) : ideas.length;
  return `시안 ${maxNumber + 1}`;
}

function isExplicitNewMockupRequest(text: string) {
  return /아예\s*(새|새로운|다른)|새(로운|로)?\s*(목업|디자인|버전|시안|화면|캔버스|레이아웃|구조|컨셉|콘셉트)|새\s*레이아웃|다른\s*(목업|디자인|버전|시안|화면|캔버스|레이아웃|구조|컨셉|콘셉트)|처음부터|다시\s*(만들|생성)|완전(히)?\s*(새|다른)|another\s+(mockup|version|design|layout|concept)|new\s+(mockup|version|design|layout|concept)|fresh\s+(mockup|canvas|design|layout|concept)/i.test(
    text,
  );
}

function shouldForkIdeaForStyleReference(
  text: string,
  activeIdea?: Idea | null,
  citedReferenceCount = 0,
) {
  if (!activeIdea?.designStyle?.content?.trim()) return false;
  const normalized = text.trim().toLowerCase();
  const remakeIntent =
    isExplicitNewMockupRequest(normalized) ||
    /(다시|새로|새롭게|재생성|재구성|리메이크|갈아엎|바꿔서|바꾸고|만들어줘|생성해줘|제작해줘|버전|version|remake|recreate|regenerate|redo|from scratch)/i.test(
      normalized,
    );
  const styleShift =
    /(다른\s*(스타일|느낌|무드|톤|방향|레퍼런스)|새로운\s*(스타일|느낌|무드|톤|방향)|아예\s*다른|완전(히)?\s*다른|레퍼런스\s*(처럼|느낌|기반|따라|맞춰)|참고\s*(해서|해서는|느낌|기반)|스타일\s*(바꿔|변경|전환)|무드\s*(바꿔|변경|전환)|톤\s*(바꿔|변경|전환)|different\s+(style|mood|direction|reference)|new\s+(style|mood|direction)|like\s+(this|the)\s+reference|based\s+on\s+(this|the)\s+reference)/i.test(
      normalized,
    );
  const citedStyleRemake =
    citedReferenceCount > 0 &&
    remakeIntent &&
    /(레퍼런스|참고|reference|스타일|느낌|무드|톤|방향|처럼|기반|따라|맞춰)/i.test(
      normalized,
    );
  return (remakeIntent && styleShift) || citedStyleRemake;
}

function fallbackDesignStyleFromStyleReference(
  references: Reference[],
  styleSourceUrl: string | null,
  hasStyleImage: boolean,
) {
  const lines = [
    "Use the newly cited reference direction as this 시안's visual source of truth.",
  ];
  if (references.length > 0) {
    lines.push(
      `Cited references: ${references
        .slice(0, 3)
        .map((reference) =>
          [reference.title, reference.url].filter(Boolean).join(" - "),
        )
        .join("; ")}`,
    );
  } else if (styleSourceUrl) {
    lines.push(`Reference URL: ${styleSourceUrl}`);
  } else if (hasStyleImage) {
    lines.push("Reference image attached in the chat turn.");
  }
  lines.push(
    "Translate the reference into concrete palette, typography, density, component styling, and visual hierarchy for this 시안.",
  );
  return lines.join("\n");
}

function productBriefForStyleFork(description: string) {
  const lines = description
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter(
      (line) =>
        !/(비주얼|스타일|디자인\s*스타일|무드|톤|톤앤매너|컬러|색상|색감|팔레트|타이포|폰트|서체|간격|여백|밀도|다크|라이트|어둡|밝|레트로|스트릿|힙합|Represent|BBC|WTAPS|레이아웃|그리드|2열|1열|카드\s*구분|이미지\s*중심|절제|강한\s*이미지)/i.test(
          line,
        ),
    );

  const cleaned = lines.join("\n").trim();
  return (
    cleaned ||
    "제품 리스트 페이지. 기존 시안의 제품/UX 요구사항, 상품 카드 필수 정보, 필터/정렬 기능, 카테고리 맥락은 유지하되 시각 스타일과 레이아웃은 새 레퍼런스를 따른다."
  );
}

function isMockupReadinessQuestion(text: string) {
  const normalized = text.trim().toLowerCase();
  const mentionsMockup =
    /(목업|시안|화면|디자인|mockup|screen|design)/i.test(normalized);
  if (!mentionsMockup) return false;

  const asksReadiness =
    /(충분|준비|가능|할\s*수\s*있|만들\s*수\s*있|제작할\s*수\s*있|생성할\s*수\s*있|필요한\s*정보|정보가\s*있|더\s*필요|뭐가\s*필요|될까|되니|되나요|있니|있나요|can\s+you|enough|ready|possible|need\s+anything)/i.test(
      normalized,
    );
  if (!asksReadiness) return false;

  const explicitGenerate =
    /(만들어줘|생성해줘|제작해줘|진행해줘|시작해줘|그려줘|만들자|생성하자|진행하자|바로\s*(만들|생성|제작|진행)|please\s+(make|generate|create|proceed)|go\s+ahead|start\s+generating)/i.test(
      normalized,
    );
  return !explicitGenerate;
}

function stripMockupActionBlocks(content: string) {
  return content
    .replace(/\[(?:GENERATE|EDIT)_MOCKUP(?::[\s\S]*?)?\]/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function isReferenceSearchRequest(text: string) {
  const explicitReference =
    /(레퍼런스|참고\s*(자료|이미지|사이트|앱|화면)?|벤치마크|inspiration|reference)s?\s*(찾|검색|추천|보여|골라|추가|줘)|(?:찾|검색|추천|보여|골라|추가).{0,12}(레퍼런스|참고\s*(자료|이미지|사이트|앱|화면)?|벤치마크|inspiration|reference)s?/i.test(
      text,
    );
  // "레퍼런스(섹션/패널/목록)에/로 추가/넣" — "add to references" phrasing where a
  // word sits between 레퍼런스 and the verb, which the adjacency pattern misses.
  const addToReferences =
    /(레퍼런스|참고\s*(?:자료|이미지|사이트|앱|화면)?|벤치마크|reference)s?(?:\s*(?:섹션|패널|목록|리스트))?\s*[에로]?\s*(?:추가|넣)/i.test(
      text,
    );
  if (explicitReference || addToReferences) return true;

  const asksForExamples =
    /(추천|찾|검색|보여|골라|알려|제안|뽑아|추려|recommend|suggest|find|show)/i.test(
      text,
    );
  const externalDesignTarget =
    /(사이트|웹\s*사이트|웹사이트|website|web\s*site|개인\s*웹|포트폴리오|portfolio|랜딩\s*페이지|landing\s*page|앱|app|서비스|service|프로덕트|product|브랜드|brand|ui|화면|screen|interface)/i.test(
      text,
    );
  const inspirationQualifier =
    /(영감|inspiration|inspo|잘\s*만들|좋은|멋진|괜찮은|유명한|사례|case|example|best|great|good|nice)/i.test(
      text,
    );

  return asksForExamples && externalDesignTarget && inspirationQualifier;
}

// Corrective / pivot turn: the user is redirecting the reference search away
// from the current direction (e.g. "브랜드 말고 개인 포트폴리오", "그게 아니라",
// "instead"). On these turns the latest intent should lead the query so the
// unchanged persona/mission boilerplate doesn't dilute the correction.
function isCorrectiveReferenceTurn(text: string) {
  return /(말고|아니라|아니야|아냐|대신에?|그게\s*아니|그건\s*아니|그거\s*말고|that['’]?s not|not that|instead|rather than)/i.test(
    text,
  );
}

// Explicit reference count the user asked for (e.g. "3개", "두 개", "5 references").
// Returns null when unspecified; the server clamps and defaults.
function parseRequestedReferenceCount(text: string): number | null {
  const digit = text.match(
    /(\d+)\s*(?:개|장|곳|군데|references?|refs?|examples?|apps?|sites?)/i,
  );
  if (digit) {
    const n = parseInt(digit[1], 10);
    if (Number.isFinite(n) && n > 0) return n;
  }
  const KO: Record<string, number> = {
    한: 1, 하나: 1, 두: 2, 둘: 2, 세: 3, 셋: 3, 네: 4, 넷: 4,
    다섯: 5, 여섯: 6, 일곱: 7, 여덟: 8, 아홉: 9, 열: 10,
  };
  const ko = text.match(
    /(하나|한|둘|두|셋|세|넷|네|다섯|여섯|일곱|여덟|아홉|열)\s*(?:개|장|곳|군데)/,
  );
  if (ko) return KO[ko[1]] ?? null;
  return null;
}

function isReferenceMemory(record: MemoryRecord) {
  const action = String(record.action ?? "");
  if (/reference|references|FETCH_REFERENCES/i.test(action)) return true;
  const text = [
    ...(record.keyword ?? []),
    ...(record.keywords ?? []),
    record.episodic,
    record.episode,
    record.semantic,
    record.input,
    record.output,
    record.link,
  ]
    .filter(Boolean)
    .join(" ");
  return /reference|references|레퍼런스|참고\s*(자료|이미지|사이트|앱|화면)?|벤치마크/i.test(
    text,
  );
}

function filterMemoryForReferenceSearch(records: MemoryRecord[] | null) {
  if (!records) return null;
  const filtered = records.filter(
    (record) => isReferenceMemory(record) && (record.similarity ?? 0) >= 0.42,
  );
  return filtered.length > 0 ? filtered.slice(0, 3) : null;
}

function cleanSearchText(text: string) {
  return text
    .replace(/[^\p{L}\p{N}\s.-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function buildReferenceSearchQuery(
  baseQuery: string | null | undefined,
  missionTitle: string | undefined,
  activeOption: MissionOption | null,
  targetDevice: Device,
  corrective = false,
) {
  const deviceLabel =
    targetDevice === "mobile" ? "mobile app UI" : "desktop website UI";
  // Pivot turn: lead with the new intent and drop the long persona description/
  // content so the corrected direction isn't buried under unchanged boilerplate.
  // Keep only the short option title for minimal grounding.
  if (corrective) {
    return [baseQuery, cleanSearchText(activeOption?.title ?? ""), deviceLabel]
      .filter(Boolean)
      .join(" ")
      .slice(0, 500);
  }
  const optionContext = activeOption
    ? [
        cleanSearchText(activeOption.title),
        activeOption.description,
        activeOption.content?.slice(0, 240),
      ]
        .filter(Boolean)
        .join(" ")
    : "";
  return [missionTitle, optionContext, deviceLabel, baseQuery]
    .filter(Boolean)
    .join(" ")
    .slice(0, 500);
}

function buildReferenceReasonSummary(references: Reference[]) {
  if (references.length === 0) return "";
  const lines = references.slice(0, 5).map((reference) => {
    const description = referenceRationale(reference);
    const title = reference.title?.trim() || reference.url || "레퍼런스";
    const link = reference.url ? ` ([link](${reference.url}))` : "";
    return `- **${title}**${link}: ${description}`;
  });
  return ["", "### 레퍼런스 선택 이유", ...lines].join("\n");
}

function referenceRationale(reference: Reference) {
  if (reference.rationale?.trim()) return reference.rationale.trim();
  if (reference.description?.trim()) return reference.description.trim();
  return "현재 미션과 관련된 UI/UX 패턴을 확인하기 위해 선택했습니다.";
}

function referenceMemoryField(label: string, value: string | null | undefined) {
  const text = value?.trim();
  return text ? `  ${label}: ${text}` : "";
}

function formatReferenceMemoryDetail(reference: Reference, index?: number) {
  const title = reference.title?.trim() || "Untitled reference";
  const header = `${index ? `${index}. ` : ""}${title}`;
  return [
    header,
    referenceMemoryField("tag", reference.tag),
    referenceMemoryField("url", reference.url),
    referenceMemoryField("imageUrl", reference.imageUrl),
    referenceMemoryField("mode", reference.referenceMode),
    referenceMemoryField("provider", reference.searchProvider),
    referenceMemoryField(
      "purpose",
      reference.referencePurpose
        ? (reference.referencePurposeLabel ?? reference.referencePurpose)
        : "",
    ),
    referenceMemoryField("card description", reference.description),
    referenceMemoryField("rationale", reference.rationale),
    referenceMemoryField("agent rationale", referenceRationale(reference)),
  ]
    .filter(Boolean)
    .join("\n");
}

function formatReferenceMemoryDetails(references: Reference[]) {
  return references
    .slice(0, 8)
    .map((reference, index) => formatReferenceMemoryDetail(reference, index + 1))
    .join("\n\n");
}

function normalizeArtboardPositionsByIdea(boards: Artboard[]) {
  const counts = new Map<string, number>();
  return boards.map((board) => {
    const ideaId = board.ideaId ?? "";
    const index = counts.get(ideaId) ?? 0;
    counts.set(ideaId, index + 1);
    return {
      ...board,
      x: index * (DEVICE_SIZE[board.device ?? "desktop"].width + ARTBOARD_GAP),
      y: 0,
    };
  });
}

function formatReviewScore(value: number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value)
    ? value.toFixed(3)
    : "-";
}

function formatReviewDelta(value: number | null | undefined) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "-";
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(3)}`;
}

// Human-readable memory strength for participants — raw 0..1 weight is jargon.
function formatWeightStrength(value: number | null | undefined) {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  if (value >= 0.75) return "강함";
  if (value >= 0.5) return "보통";
  if (value >= 0.25) return "약함";
  return "희미함";
}

function formatReviewDate(value: number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value)
    ? new Date(value).toLocaleString("ko-KR")
    : "-";
}

function reviewReferenceLabel(reference: unknown) {
  if (!reference || typeof reference !== "object") return String(reference);
  const data = reference as Record<string, unknown>;
  const title = typeof data.title === "string" ? data.title : "";
  const url = typeof data.url === "string" ? data.url : "";
  const id = typeof data.id === "string" ? data.id : "";
  return title || url || id || "레퍼런스";
}

function cleanForFirestore<T>(value: T): T {
  return JSON.parse(
    JSON.stringify(value, (_, val) => (val === undefined ? null : val)),
  );
}

function memoryActionCategory(item: SessionMemoryItem) {
  const id = item.source?.draftId ?? item.id;
  if (id.startsWith("delete-reference-")) return "reference_delete";
  if (id.startsWith("cite-reference-")) return "reference_cite";
  if (id.startsWith("fetch-reference-")) return "references_fetch";
  if (id.startsWith("delete-idea-")) return "note_delete";
  if (id.startsWith("delete-design-")) return "mockup_delete";
  if (id.startsWith("final-design-")) return "final_design_select";
  if (item.agentActionCategory) return item.agentActionCategory;
  return "memory_event";
}

function compactEventTarget(item: SessionMemoryItem | ReviewTurnMemory) {
  const output = "output" in item ? item.output?.trim() : "";
  const input = "input" in item ? item.input?.trim() : "";
  const episodic = item.episodic?.trim();
  const semantic = item.semantic?.trim();
  const id = "id" in item ? item.id : item.memoryId;
  return output || input || episodic || semantic || id;
}

function finalDesignEventSummary(item: SessionMemoryItem | ReviewTurnMemory) {
  const input = "input" in item ? item.input?.trim() : "";
  const firstLine = input?.split(/\r?\n/).map((line) => line.trim()).find(Boolean);
  if (firstLine) {
    const normalized = firstLine
      .replace(/^최종\s+디자인\s+확정\s*:/, "최종디자인 시안 확정:")
      .replace(/\s+[·•]\s+/g, " * ");
    return normalized;
  }
  return "최종디자인 시안 확정";
}

function memoryEventLabel(item: SessionMemoryItem) {
  switch (memoryActionCategory(item)) {
    case "reference_delete":
      return "레퍼런스 삭제";
    case "reference_cite":
      return "레퍼런스 인용";
    case "references_fetch":
      return "레퍼런스 검색";
    case "note_delete":
      return "시안 삭제";
    case "mockup_delete":
      return "목업 삭제";
    default:
      return "세션 이벤트";
  }
}

function memoryEventDetail(item: SessionMemoryItem) {
  const target = compactEventTarget(item);
  switch (memoryActionCategory(item)) {
    case "reference_delete":
      return `삭제한 레퍼런스: ${target}`;
    case "reference_cite":
      return `인용한 레퍼런스: ${target}`;
    case "references_fetch":
      return `검색한 레퍼런스 맥락: ${target}`;
    case "note_delete":
      return `삭제한 시안: ${target}`;
    case "mockup_delete":
      return `삭제한 목업: ${target}`;
    case "final_design_select":
      return finalDesignEventSummary(item);
    default:
      return target || "내용 없는 메모리";
  }
}

function memorySummaryText(item: SessionMemoryItem | ReviewTurnMemory) {
  if ("agentActionCategory" in item) {
    const action = memoryActionCategory(item);
    if (
      action === "reference_delete" ||
      action === "reference_cite" ||
      action === "references_fetch" ||
      action === "note_delete" ||
      action === "mockup_delete" ||
      action === "final_design_select"
    ) {
      return memoryEventDetail(item);
    }
  }
  return (
    item.semantic ||
    item.episodic ||
    ("input" in item ? item.input : "") ||
    ("output" in item ? item.output : "") ||
    "내용 없는 메모리"
  );
}

function memoryEventKey(item: SessionMemoryItem) {
  return item.source?.draftId ?? item.id;
}

function isMemoryLinkedToMessage(
  item: SessionMemoryItem,
  messageIds: Set<string>,
) {
  const keys = [item.id, item.source?.draftId].filter(Boolean).map(String);
  return keys.some((key) => messageIds.has(key));
}

function shouldShowMemoryEventCard(item: SessionMemoryItem) {
  const category = memoryActionCategory(item);
  return [
    "reference_delete",
    "note_delete",
    "mockup_delete",
    "final_design_select",
  ].includes(category);
}

function activityEventCategory(event: ActivityLogEvent) {
  if (event.section === "reference" && event.action === "delete")
    return "reference_delete";
  if (event.section === "note" && event.action === "delete") return "note_delete";
  if (event.section === "mockup" && event.action === "delete")
    return "mockup_delete";
  return "activity_event";
}

function shouldShowActivityEventCard(event: ActivityLogEvent) {
  return ["reference_delete", "note_delete", "mockup_delete"].includes(
    activityEventCategory(event),
  );
}

function activityEventLabel(event: ActivityLogEvent) {
  switch (activityEventCategory(event)) {
    case "reference_delete":
      return "레퍼런스 삭제";
    case "note_delete":
      return "시안 삭제";
    case "mockup_delete":
      return "목업 삭제";
    default:
      return "세션 이벤트";
  }
}

function activityEventDetail(event: ActivityLogEvent) {
  return event.outputTitle || event.output || event.input || event.link || event.id;
}

function compareTimelineItems(a: ReviewTimelineItem, b: ReviewTimelineItem) {
  const aTime =
    a.type === "message"
      ? Number(a.message.createdAt ?? 0)
      : a.type === "memory-event"
        ? Number(a.memory.timestamp ?? a.memory.promotedAt ?? 0)
        : Number(a.event.createdAt ?? 0);
  const bTime =
    b.type === "message"
      ? Number(b.message.createdAt ?? 0)
      : b.type === "memory-event"
        ? Number(b.memory.timestamp ?? b.memory.promotedAt ?? 0)
        : Number(b.event.createdAt ?? 0);
  if (aTime !== bTime) return aTime - bTime;
  if (a.type === b.type) return 0;
  return a.type === "message" ? -1 : 1;
}


async function stitchResponseError(response: Response) {
  const data = await response.clone().json().catch(() => null);
  if (data?.code === "stitch-auth") {
    return "Stitch 인증 정보가 만료되었거나 유효하지 않습니다. 관리자에게 STITCH_API_KEY 갱신을 요청해주세요.";
  }
  if (typeof data?.error === "string") return data.error;
  const text = await response.text().catch(() => "");
  return text || `HTTP ${response.status}`;
}

async function fetchStitchScreenHtml(
  projectId: string,
  screenId: string,
  attempts = 10,
) {
  let lastError = "Stitch 화면 HTML이 아직 준비되지 않았습니다.";
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const response = await fetch(
      `/api/stitch/html?projectId=${encodeURIComponent(projectId)}&screenId=${encodeURIComponent(screenId)}`,
    );
    const data = await response.json().catch(() => null);
    if (response.ok && typeof data?.html === "string" && data.html.trim()) {
      return data.html as string;
    }
    if (!response.ok && !data?.htmlPending) {
      throw new Error(
        typeof data?.error === "string"
          ? data.error
          : `Stitch 화면을 불러오지 못했습니다. HTTP ${response.status}`,
      );
    }
    if (typeof data?.error === "string") lastError = data.error;
    if (attempt < attempts - 1) {
      await new Promise((resolve) => window.setTimeout(resolve, 5000));
    }
  }
  throw new Error(lastError);
}

function isAbortLikeError(err: unknown) {
  if (typeof err === "string") {
    return (
      err === "timeout" ||
      err === "stitch-timeout" ||
      err.toLowerCase().includes("signal is aborted")
    );
  }
  if (err instanceof DOMException && err.name === "AbortError") return true;
  if (err instanceof Error) {
    return (
      err.name === "AbortError" ||
      err.message === "timeout" ||
      err.message.toLowerCase().includes("signal is aborted")
    );
  }
  return false;
}

function stitchGenerationErrorMessage(err: unknown, wasCanceled: boolean) {
  if (wasCanceled) return "목업 작업을 취소했습니다.";
  if (isAbortLikeError(err)) {
    return "Stitch 응답 처리 시간이 초과되었습니다. 화면이 생성됐을 수 있으니 잠시 후 다시 확인해주세요.";
  }
  if (typeof err === "string" && err.trim()) return err;
  return err instanceof Error ? err.message : "Stitch 생성 실패";
}

export default function MainScreenPage() {
  const { missionId } = useParams<{ missionId: string }>();
  const router = useRouter();
  const searchParams = useSearchParams();
  const viewAs = searchParams.get("viewAs"); // admin: view another user's session
  const isReviewMode = searchParams.get("review") === "1";
  const isOnboardingMission = missionId === ONBOARDING_MISSION_ID;

  const [messages, setMessages] = useState<Message[]>([]);
  const [inputText, setInputText] = useState("");
  const [composerCommand, setComposerCommand] =
    useState<ChatComposerCommand | null>(null);
  const [composerMention, setComposerMention] =
    useState<ChatComposerMention | null>(null);
  const [attachedStyleImage, setAttachedStyleImage] = useState<{
    dataUrl: string;
    name?: string;
  } | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [artboards, setArtboards] = useState<Artboard[]>([]);
  const [activeArtboardId, setActiveArtboardId] = useState<string | null>(null);
  const [references, setReferences] = useState<Reference[]>([]);
  const [activityLog, setActivityLog] = useState<ActivityLogEvent[]>([]);
  const [ideas, setIdeas] = useState<Idea[]>([]);
  const [isDesignSpecOpen, setIsDesignSpecOpen] = useState(false);
  const [selectedElement, setSelectedElement] =
    useState<SelectedElement | null>(null);
  const [selectedReferences, setSelectedReferences] = useState<Reference[]>([]);
  const [citedTexts, setCitedTexts] = useState<string[]>([]);
  const mockupFrameRefs = useRef(new Map<string, HTMLIFrameElement>());
  const missionPanelRef = useRef<HTMLElement>(null);
  const citeMenuRef = useRef<HTMLDivElement>(null);
  const pendingCiteTextRef = useRef<string>("");
  const sessionRefFor = useCallback(
    (uid: string) => doc(db, "sessions", uid, "missions", missionId),
    [missionId],
  );
  const [isCompletingSession, setIsCompletingSession] = useState(false);
  const [sessionCompletionReady, setSessionCompletionReady] = useState(false);
  const [sessionCompletionStep, setSessionCompletionStep] = useState(0);
  const [sessionCompleted, setSessionCompleted] = useState(false);
  const [showLobbyWarning, setShowLobbyWarning] = useState(false);
  const [showFinalDesignWarning, setShowFinalDesignWarning] = useState(false);
  const [destructiveAction, setDestructiveAction] =
    useState<DestructiveSessionAction | null>(null);
  const [editMode, setEditMode] = useState(false);
  const [device, setDevice] = useState<Device>("desktop");
  const [missionTitle, setMissionTitle] = useState("");
  const [missionBrief, setMissionBrief] = useState("");
  const [isMissionContextReady, setIsMissionContextReady] = useState(false);
  const [sessionLoaded, setSessionLoaded] = useState(false);
  const [profileModalConfirmed, setProfileModalConfirmed] = useState(false);
  const [profileRawMarkdown, setProfileRawMarkdown] = useState("");
  const [profileSaving, setProfileSaving] = useState(false);
  const [isProductTourOpen, setIsProductTourOpen] = useState(false);
  const [productTourAutoChecked, setProductTourAutoChecked] = useState(false);
  const [parentMissionTitle, setParentMissionTitle] = useState("");
  const [parentMissionBrief, setParentMissionBrief] = useState("");
  const [missionOptions, setMissionOptions] = useState<MissionOption[]>([]);
  const [selectedOptionId, setSelectedOptionId] = useState<string | null>(null);
  const [missionDurationMinutes, setMissionDurationMinutes] = useState<
    number | null
  >(null);
  const [activeOptionPreviewId, setActiveOptionPreviewId] = useState<
    string | null
  >(null);
  const [timerStartedAt, setTimerStartedAt] = useState<number | null>(null);
  const [timerEndedAt, setTimerEndedAt] = useState<number | null>(null);
  const [timerDisplay, setTimerDisplay] = useState<string>("");
  const [activeLeftPanelSection, setActiveLeftPanelSection] = useState<
    "mission" | "reference" | "workspace" | "final"
  >("mission");
  const [activeIdeaTab, setActiveIdeaTab] = useState("idea");
  const [activeIdeaId, setActiveIdeaId] = useState<string | null>(null);
  const [isIdeaExpanded, setIsIdeaExpanded] = useState(true);
  const [isOptionExpanded, setIsOptionExpanded] = useState(true);
  const [userId, setUserId] = useState<string | null>(null);
  const [isFetchingRefs, setIsFetchingRefs] = useState(false);
  const [referenceLoadingMessageId, setReferenceLoadingMessageId] = useState<
    string | null
  >(null);
  const [referenceSearchError, setReferenceSearchError] = useState("");
  const [isAdmin, setIsAdmin] = useState(false);
  const [chatResponseProvider, setChatResponseProvider] =
    useState<ChatResponseProvider>("openai");
  const [viewAsName, setViewAsName] = useState<string | null>(null);
  const [stitchProjectId, setStitchProjectId] = useState<string>("");
  // Stitch project-level design system synced from the active 시안's design
  // style. We track the applied style hash so /api/stitch only re-applies the
  // design system when the style content actually changes.
  const [stitchDesignSystemId, setStitchDesignSystemId] = useState<string | null>(
    null,
  );
  const [appliedDesignStyleHash, setAppliedDesignStyleHash] = useState<
    string | null
  >(null);
  const [finalArtboardId, setFinalArtboardId] = useState<string | null>(null);
  const [isGeneratingMockup, setIsGeneratingMockup] = useState(false);
  const [mockupOperation, setMockupOperation] = useState<
    "generate" | "edit" | null
  >(null);
  const [generatingMockupIdeaId, setGeneratingMockupIdeaId] = useState<
    string | null
  >(null);
  const [isMockupExpanded, setIsMockupExpanded] = useState(false);
  // Resizable chat panel width (drag handle between content and chat).
  const [chatWidth, setChatWidth] = useState<number>(() => {
    if (typeof window === "undefined") return CHAT_DEFAULT_WIDTH;
    const saved = Number(window.localStorage.getItem("vda-chat-width"));
    return saved >= CHAT_MIN_WIDTH && saved <= CHAT_MAX_WIDTH
      ? saved
      : CHAT_DEFAULT_WIDTH;
  });
  const isResizingChatRef = useRef(false);
  useEffect(() => {
    document.documentElement.style.setProperty("--chat-w", `${chatWidth}px`);
    window.localStorage.setItem("vda-chat-width", String(chatWidth));
  }, [chatWidth]);
  const startChatResize = useCallback((event: React.PointerEvent) => {
    event.preventDefault();
    isResizingChatRef.current = true;
    const onMove = (ev: PointerEvent) => {
      if (!isResizingChatRef.current) return;
      const next = Math.min(
        CHAT_MAX_WIDTH,
        Math.max(CHAT_MIN_WIDTH, window.innerWidth - ev.clientX),
      );
      setChatWidth(next);
    };
    const onUp = () => {
      isResizingChatRef.current = false;
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      document.body.style.userSelect = "";
      document.body.style.cursor = "";
    };
    document.body.style.userSelect = "none";
    document.body.style.cursor = "col-resize";
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }, []);
  const [designContextMenu, setDesignContextMenu] = useState<{
    artboardId: string;
    x: number;
    y: number;
  } | null>(null);
  const [pendingArtboardSkeleton, setPendingArtboardSkeleton] = useState<{
    ideaId: string;
    label: string;
    x: number;
    y: number;
    device: Device;
  } | null>(null);
  const [mockupProgress, setMockupProgress] = useState<{
    percent: number;
    label: string;
  } | null>(null);
  const [reviewTurnsById, setReviewTurnsById] = useState<
    Record<string, ReviewTurn>
  >({});
  const [chatPhasesByMessageId, setChatPhasesByMessageId] = useState<
    Record<string, string[]>
  >({});
  const [expandedChatPhaseIds, setExpandedChatPhaseIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [collapsedChatPhaseIds, setCollapsedChatPhaseIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [rawPromptModal, setRawPromptModal] = useState<{
    turnId: string;
    rawPrompt: unknown;
    rawPromptSanitization?: unknown;
    rawResponseMeta?: unknown;
  } | null>(null);
  const [reviewDetailModal, setReviewDetailModal] = useState<{
    mode: "memory" | "turn-memory";
    turnId: string;
    reviewTurn: ReviewTurn;
    memories: ReviewTurnMemory[];
    turnDraft?: SessionMemoryItem | null;
  } | null>(null);
  const [reviewMemoryArchiveById, setReviewMemoryArchiveById] = useState<
    Record<string, ReviewMemoryArchiveStatus>
  >({});
  const [sessionMemorySummary, setSessionMemorySummary] =
    useState<SessionMemorySummary>(EMPTY_SESSION_MEMORY_SUMMARY);
  const [rightPanelTab, setRightPanelTab] = useState<"before" | "chat">(
    isReviewMode ? "before" : "chat",
  );
  const [memoryGraphPhase, setMemoryGraphPhase] = useState<"before" | "after">(
    "before",
  );
  const [memoryGraphFilter, setMemoryGraphFilter] =
    useState<MemoryGraphFilter>("all");
  const [isMemoryDiffOpen, setIsMemoryDiffOpen] = useState(false);
  const [selectedGraphMemoryId, setSelectedGraphMemoryId] = useState<
    string | null
  >(null);
  const [selectedSessionGraphClusterId, setSelectedSessionGraphClusterId] =
    useState<string | null>(null);
  const [selectedReferencedMemoryId, setSelectedReferencedMemoryId] = useState<
    string | null
  >(null);
  const [memoryReviewMentionMode, setMemoryReviewMentionMode] = useState(false);
  const [memoryReviewMentionTarget, setMemoryReviewMentionTarget] =
    useState<MemoryReviewMentionTarget | null>(null);
  const memoryReviewMentionEventIdRef = useRef(0);
  const [memoryReviewAnswers, setMemoryReviewAnswers] =
    useState<MemoryReviewAnswers | null>(null);
  const [memoryReviewSaveStatus, setMemoryReviewSaveStatus] = useState<
    "idle" | "saving" | "saved" | "error"
  >("idle");
  const [memoryReviewSubmittedAt, setMemoryReviewSubmittedAt] = useState<
    number | null
  >(null);
  const memoryReviewAnswersRef = useRef<MemoryReviewAnswers>({});
  const memoryReviewDirtyRef = useRef(false);
  const memoryReviewSaveKeyRef = useRef("");
  // Most recently obtained ID token, kept so the unload flush can fire a
  // keepalive request synchronously without awaiting getIdToken.
  const memoryReviewTokenRef = useRef<string | null>(null);
  const sessionMemorySummaryKeyRef = useRef<string | null>(null);
  const [reviewProfileItems, setReviewProfileItems] = useState<
    { id: string; input: string }[]
  >([]);

  const isViewingAsAdmin = !!(viewAs && isAdmin);
  const isReadOnly = isReviewMode || isViewingAsAdmin;
  const showReviewAnnotations = isReviewMode || isViewingAsAdmin;
  const hasSessionStarted = Boolean(
    timerStartedAt ||
      messages.length > 0 ||
      ideas.length > 0 ||
      artboards.length > 0 ||
      references.length > 0 ||
      activityLog.length > 0,
  );
  const canShowProductTour =
    !isReadOnly && Boolean(selectedOptionId) && profileModalConfirmed;

  const handleProductTourOpenChange = useCallback(
    (open: boolean) => {
      setIsProductTourOpen(open);
    },
    [],
  );

  useEffect(() => {
    const panel = missionPanelRef.current;
    if (!panel) return;

    const sections: Array<{
      id: "mission" | "reference" | "workspace" | "final";
      ref: React.RefObject<HTMLDivElement | null>;
    }> = [
      { id: "mission", ref: missionSectionRef },
      { id: "reference", ref: referenceSectionRef },
      { id: "workspace", ref: workspaceSectionRef },
      { id: "final", ref: finalSectionRef },
    ];

    const updateActiveSection = () => {
      if (Date.now() < leftPanelSectionLockUntilRef.current) return;
      const panelTop = panel.getBoundingClientRect().top;
      const threshold = panelTop + 120;
      let next: "mission" | "reference" | "workspace" | "final" = "mission";
      for (const section of sections) {
        const element = section.ref.current;
        if (!element) continue;
        if (element.getBoundingClientRect().top <= threshold) {
          next = section.id;
        }
      }
      setActiveLeftPanelSection((prev) => (prev === next ? prev : next));
    };

    updateActiveSection();
    panel.addEventListener("scroll", updateActiveSection, { passive: true });
    window.addEventListener("resize", updateActiveSection);
    return () => {
      panel.removeEventListener("scroll", updateActiveSection);
      window.removeEventListener("resize", updateActiveSection);
    };
  }, [
    ideas.length,
    references.length,
    artboards.length,
    activeIdeaId,
    isDesignSpecOpen,
    isIdeaExpanded,
    isOptionExpanded,
  ]);

  useEffect(() => {
    if (
      productTourAutoChecked ||
      !isOnboardingMission ||
      !canShowProductTour ||
      !isMissionContextReady ||
      !sessionLoaded
    ) {
      return;
    }
    setProductTourAutoChecked(true);
    setIsProductTourOpen(true);
  }, [
    canShowProductTour,
    isOnboardingMission,
    isMissionContextReady,
    productTourAutoChecked,
    sessionLoaded,
  ]);

  const targetSessionUserId = isViewingAsAdmin ? viewAs : userId;
  const reviewMemoryIds = useMemo(
    () =>
      Array.from(
        new Set(
          Object.values(reviewTurnsById)
            .flatMap((turn) => turn.retrieved ?? [])
            .map((memory) => memory.memoryId)
            .filter(Boolean),
        ),
      ),
    [reviewTurnsById],
  );
  const reviewMemoryIdsKey = reviewMemoryIds.join("|");
  const reviewTimelineItems = useMemo<ReviewTimelineItem[]>(() => {
    if (!showReviewAnnotations) {
      return [
        ...messages.map((message) => ({ type: "message" as const, message })),
        ...activityLog
          .filter(shouldShowActivityEventCard)
          .map((event) => ({ type: "activity-event" as const, event })),
      ].sort(compareTimelineItems);
    }
    const messageIds = new Set<string>();
    for (const message of messages) {
      messageIds.add(message.id);
      if (message.reviewTurnId) messageIds.add(message.reviewTurnId);
    }
    const seen = new Set<string>();
    const memoryEvents = [
      ...sessionMemorySummary.drafts,
      ...sessionMemorySummary.promoted,
    ].filter((item) => {
      const key = memoryEventKey(item);
      if (
        !key ||
        seen.has(key) ||
        isMemoryLinkedToMessage(item, messageIds) ||
        !shouldShowMemoryEventCard(item)
      ) {
        return false;
      }
      seen.add(key);
      return Boolean(item.episodic || item.semantic || item.input || item.output);
    });
    return [
      ...messages.map((message) => ({ type: "message" as const, message })),
      ...memoryEvents.map((memory) => ({
        type: "memory-event" as const,
        memory,
      })),
    ].sort(compareTimelineItems);
  }, [activityLog, messages, sessionMemorySummary, showReviewAnnotations]);
  // Cumulative memory set for this mission: onboarding base + every mission up to
  // and including the current one. Later missions' memories are excluded so a
  // mission's review reflects what the agent knew through that mission.
  const cumulativeGraphMemories = useMemo(
    () =>
      sessionMemorySummary.graphMemories.filter((memory) =>
        isWithinCumulative(
          memory.source?.missionId,
          missionId,
          sessionMemorySummary.missionOrder,
        ),
      ),
    [sessionMemorySummary.graphMemories, sessionMemorySummary.missionOrder, missionId],
  );
  const sessionArchivedMemories = useMemo(() => {
    const referencedIds = new Set(
      sessionMemorySummary.referenced.map((item) => item.memoryId),
    );
    const promotedIds = new Set(
      sessionMemorySummary.promoted.map((item) => item.id),
    );
    return cumulativeGraphMemories.filter((item) => {
      if (!item.archivedAt) return false;
      if (referencedIds.has(item.id) || promotedIds.has(item.id)) return true;
      const duplicateOf = item.duplicateOf ?? item.duplicate?.memoryId ?? null;
      return Boolean(
        duplicateOf &&
          (referencedIds.has(duplicateOf) || promotedIds.has(duplicateOf)),
      );
    });
  }, [sessionMemorySummary, cumulativeGraphMemories]);
  const beforeSessionMemoryImpact = useMemo(() => {
    const referencedByMemoryId = new Map(
      sessionMemorySummary.referenced.map((item) => [item.memoryId, item] as const),
    );
    const promotedById = new Map(
      sessionMemorySummary.promoted.map((item) => [item.id, item] as const),
    );
    const beforeSessionMemories = cumulativeGraphMemories
      // Cumulative before-session context: onboarding base + prior missions +
      // this mission's own before_session memories. cumulativeGraphMemories
      // already excludes later missions, so origin stays correct.
      .filter((item) => item.sourceType === "before_session")
      .map((memory) => ({
        memory,
        referenced: referencedByMemoryId.get(memory.id) ?? null,
        promoted: promotedById.get(memory.id) ?? null,
      }))
      .sort((a, b) => {
        return Number(b.memory.weight ?? 0) - Number(a.memory.weight ?? 0);
      });

    return {
      items: beforeSessionMemories,
      availableCount: beforeSessionMemories.length,
    };
  }, [sessionMemorySummary, cumulativeGraphMemories]);
  const chooseMemoryReviewMention = useCallback(
    (target: Omit<MemoryReviewMentionTarget, "eventId">) => {
      memoryReviewMentionEventIdRef.current += 1;
      setMemoryReviewMentionTarget({
        ...target,
        eventId: memoryReviewMentionEventIdRef.current,
      });
      setMemoryReviewMentionMode(false);
    },
    [],
  );
  const saveMemoryReviewFeedback = useCallback(
    async (submitted: boolean, nextAnswers?: MemoryReviewAnswers) => {
      if (!missionId || isViewingAsAdmin) return false;
      const currentUser = firebaseAuth.currentUser;
      if (!currentUser) return false;

      const answers = nextAnswers ?? memoryReviewAnswersRef.current;
      if (nextAnswers) {
        memoryReviewAnswersRef.current = nextAnswers;
        setMemoryReviewAnswers(nextAnswers);
      }
      const payloadKey = JSON.stringify({ answers, submitted });
      if (!submitted && payloadKey === memoryReviewSaveKeyRef.current) {
        return true;
      }

      setMemoryReviewSaveStatus("saving");
      try {
        const token = await getIdToken(currentUser);
        memoryReviewTokenRef.current = token;
        const response = await fetch("/api/memory/review-feedback", {
          method: "POST",
          keepalive: submitted,
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            missionId,
            answers,
            submitted,
          }),
        });
        if (!response.ok) throw new Error("save_failed");
        const data = (await response.json()) as {
          feedback?: { submittedAt?: number | null };
        };
        memoryReviewSaveKeyRef.current = payloadKey;
        memoryReviewDirtyRef.current = false;
        setMemoryReviewSubmittedAt(data.feedback?.submittedAt ?? null);
        setMemoryReviewSaveStatus("saved");
        return true;
      } catch {
        setMemoryReviewSaveStatus("error");
        return false;
      }
    },
    [isViewingAsAdmin, missionId],
  );
  // Best-effort synchronous save for page unload / tab hide, when the 300ms
  // debounce has not yet fired. Uses keepalive so the request survives the
  // document being torn down, and a cached token because getIdToken is async.
  const flushMemoryReviewFeedback = useCallback(() => {
    if (!missionId || isViewingAsAdmin) return;
    if (!memoryReviewDirtyRef.current) return;
    const token = memoryReviewTokenRef.current;
    if (!token) return;
    const answers = memoryReviewAnswersRef.current;
    const payloadKey = JSON.stringify({ answers, submitted: false });
    if (payloadKey === memoryReviewSaveKeyRef.current) return;
    try {
      void fetch("/api/memory/review-feedback", {
        method: "POST",
        keepalive: true,
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ missionId, answers, submitted: false }),
      });
      memoryReviewSaveKeyRef.current = payloadKey;
      memoryReviewDirtyRef.current = false;
    } catch {
      // Unload path: nothing actionable if the keepalive request cannot start.
    }
  }, [isViewingAsAdmin, missionId]);
  const handleMemoryReviewAnswersChange = useCallback(
    (answers: MemoryReviewAnswers) => {
      memoryReviewAnswersRef.current = answers;
      memoryReviewDirtyRef.current = true;
      setMemoryReviewAnswers(answers);
      if (memoryReviewSaveStatus !== "saving") {
        setMemoryReviewSaveStatus("idle");
      }
    },
    [memoryReviewSaveStatus],
  );
  const activeOption =
    missionOptions.find((option) => option.id === selectedOptionId) ??
    (missionOptions.length === 1 ? missionOptions[0] : null);
  const appendActivityLog = useCallback(
    (event: Omit<ActivityLogEvent, "id" | "createdAt">) => {
      setActivityLog((prev) =>
        [
          ...prev,
          { id: crypto.randomUUID(), createdAt: Date.now(), ...event },
        ].slice(-500),
      );
    },
    [],
  );

  const encodeMemoryDraft = useCallback(
    async (
      interactionId: string,
      input: string,
      output: string,
      timestamp: number,
      sources?: MemoryDraftSources,
      finalDesign?: FinalDesignEnrichmentPayload,
    ) => {
      if (isReadOnly || !missionId || !input.trim() || !output.trim())
        return false;
      const currentUser = firebaseAuth.currentUser;
      if (!currentUser) return false;
      try {
        const token = await getIdToken(currentUser);
        const response = await fetch("/api/memory/drafts", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            missionId,
            interactionId,
            input,
            output,
            timestamp,
            sources,
            finalDesign,
          }),
        });
        if (!response.ok) {
          throw new Error(`Memory draft failed: ${response.status}`);
        }
        return true;
      } catch (error) {
        console.warn("Unable to encode memory draft", error);
        return false;
      }
    },
    [isReadOnly, missionId],
  );
  const retrieveMemoryForQuery = useCallback(
    async (query: string) => {
      if (isReadOnly || !missionId || !query.trim()) return null;
      const currentUser = firebaseAuth.currentUser;
      if (!currentUser) return null;
      try {
        const token = await getIdToken(currentUser);
        const res = await fetch("/api/memory/retrieve", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            query,
            missionId,
            limit: 5,
          }),
        });
        if (!res.ok) return null;
        const data = (await res.json()) as MemoryRetrievalResponse;
        const retrieved = Array.isArray(data.retrieved) ? data.retrieved : [];
        if (retrieved.length === 0) return null;
        return retrieved;
      } catch (error) {
        console.warn("Unable to retrieve memory", error);
        return null;
      }
    },
    [isReadOnly, missionId],
  );

  const chatInputRef = useRef<ChatInputHandle>(null);
  const chatScrollRef = useRef<HTMLDivElement>(null);
  const [showScrollToBottom, setShowScrollToBottom] = useState(false);

  const leftPanelSectionLockUntilRef = useRef(0);
  const missionSectionRef = useRef<HTMLDivElement>(null);
  const referenceSectionRef = useRef<HTMLDivElement>(null);
  const workspaceSectionRef = useRef<HTMLDivElement>(null);
  const finalSectionRef = useRef<HTMLDivElement>(null);
  const ideaSectionRef = useRef<HTMLElement>(null);
  const styleSectionRef = useRef<HTMLElement>(null);
  const mockupSectionRef = useRef<HTMLElement>(null);
  const finalDesignSectionRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const canvasWorldRef = useRef<HTMLDivElement>(null);
  const canvasViewCommitTimerRef = useRef<number | null>(null);
  const dragStartRef = useRef<{
    mouseX: number;
    mouseY: number;
    offsetX: number;
    offsetY: number;
  } | null>(null);
  const canvasOffsetRef = useRef({ x: 40, y: 40 });
  const canvasScaleRef = useRef(0.5);
  const gestureStartScaleRef = useRef(0.5);
  const artboardHeightsRef = useRef<Record<string, number>>({});
  const artboardsRef = useRef<Artboard[]>([]);
  const activeIdeaIdRef = useRef<string | null>(null);
  const selectedOptionIdRef = useRef<string | null>(null);
  const missionOptionsRef = useRef<MissionOption[]>([]);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const stitchAbortControllerRef = useRef<AbortController | null>(null);
  const stitchCancelRequestedRef = useRef(false);

  const [canvasOffset, setCanvasOffset] = useState({ x: 40, y: 40 });
  const [canvasScale, setCanvasScale] = useState(0.5);
  const [artboardHeights, setArtboardHeights] = useState<
    Record<string, number>
  >({});
  const [isDragging, setIsDragging] = useState(false);
  const [expandedChips, setExpandedChips] = useState<Set<string>>(new Set());

  // Keep refs in sync
  useEffect(() => {
    canvasOffsetRef.current = canvasOffset;
  }, [canvasOffset]);
  useEffect(() => {
    canvasScaleRef.current = canvasScale;
  }, [canvasScale]);
  useEffect(() => {
    artboardHeightsRef.current = artboardHeights;
  }, [artboardHeights]);
  useEffect(() => {
    artboardsRef.current = artboards;
  }, [artboards]);
  // When a board's HTML is regenerated its iframe remounts and re-measures from
  // the device height. Drop the stale (grown) height so the fresh iframe mounts
  // at the device height and its image-box pinning captures correct sizes.
  const lastHtmlUpdatedAtRef = useRef<Record<string, number>>({});
  useEffect(() => {
    const changed: string[] = [];
    for (const board of artboards) {
      const stamp = board.htmlUpdatedAt ?? 0;
      if (lastHtmlUpdatedAtRef.current[board.id] !== stamp) {
        if (lastHtmlUpdatedAtRef.current[board.id] !== undefined) {
          changed.push(board.id);
        }
        lastHtmlUpdatedAtRef.current[board.id] = stamp;
      }
    }
    if (changed.length === 0) return;
    setArtboardHeights((prev) => {
      const next = { ...prev };
      for (const id of changed) delete next[id];
      return next;
    });
  }, [artboards]);
  useEffect(() => {
    activeIdeaIdRef.current = activeIdeaId;
  }, [activeIdeaId]);
  useEffect(() => {
    selectedOptionIdRef.current = selectedOptionId;
  }, [selectedOptionId]);
  useEffect(() => {
    missionOptionsRef.current = missionOptions;
  }, [missionOptions]);

  useEffect(() => {
    if (!designContextMenu) return;
    const closeMenu = () => setDesignContextMenu(null);
    window.addEventListener("click", closeMenu);
    window.addEventListener("keydown", closeMenu);
    window.addEventListener("scroll", closeMenu, true);
    return () => {
      window.removeEventListener("click", closeMenu);
      window.removeEventListener("keydown", closeMenu);
      window.removeEventListener("scroll", closeMenu, true);
    };
  }, [designContextMenu]);

  useEffect(() => {
    const showCiteMenu = (x: number, y: number, text: string) => {
      const el = citeMenuRef.current;
      if (!el) return;
      pendingCiteTextRef.current = text;
      el.style.left = `${x}px`;
      el.style.top = `${y}px`;
      el.style.display = "block";
    };

    const hideCiteMenu = () => {
      const el = citeMenuRef.current;
      if (el) el.style.display = "none";
      pendingCiteTextRef.current = "";
    };

    const handleMouseUp = (e: MouseEvent) => {
      const panel = missionPanelRef.current;
      if ((e.target as HTMLElement).closest("[data-cite-menu]")) return;
      if (!panel) return;
      if (!panel.contains(e.target as Node)) {
        hideCiteMenu();
        return;
      }
      requestAnimationFrame(() => {
        const selection = window.getSelection();
        const text = selection?.toString().trim();
        if (!text || text.length < 2) {
          hideCiteMenu();
          return;
        }
        const range = selection!.getRangeAt(0);
        const rect = range.getBoundingClientRect();
        if (!rect.width && !rect.height) return;
        showCiteMenu(rect.left + rect.width / 2, rect.top, text);
      });
    };

    const handleSelectionChange = () => {
      const text = window.getSelection()?.toString().trim();
      if (!text) hideCiteMenu();
    };

    document.addEventListener("mouseup", handleMouseUp);
    document.addEventListener("selectionchange", handleSelectionChange);
    return () => {
      document.removeEventListener("mouseup", handleMouseUp);
      document.removeEventListener("selectionchange", handleSelectionChange);
    };
  }, []);

  const applyCanvasViewDirectly = useCallback(
    (scale: number, offset: { x: number; y: number }) => {
      canvasScaleRef.current = scale;
      canvasOffsetRef.current = offset;
      if (canvasRef.current) {
        const gridSize = 20 * scale;
        canvasRef.current.style.backgroundSize = `${gridSize}px ${gridSize}px`;
        canvasRef.current.style.backgroundPosition = `${offset.x}px ${offset.y}px`;
      }
      if (canvasWorldRef.current) {
        canvasWorldRef.current.style.transform = `translate3d(${offset.x}px, ${offset.y}px, 0) scale(${scale})`;
      }
    },
    [],
  );

  const commitCanvasViewSoon = useCallback(
    (scale: number, offset: { x: number; y: number }) => {
      if (canvasViewCommitTimerRef.current !== null) {
        window.clearTimeout(canvasViewCommitTimerRef.current);
      }
      canvasViewCommitTimerRef.current = window.setTimeout(() => {
        canvasViewCommitTimerRef.current = null;
        setCanvasScale(scale);
        setCanvasOffset(offset);
      }, 120);
    },
    [],
  );

  useEffect(
    () => () => {
      if (canvasViewCommitTimerRef.current !== null) {
        window.clearTimeout(canvasViewCommitTimerRef.current);
      }
    },
    [],
  );

  useEffect(() => {
    const stored = window.localStorage.getItem("vda:chat-response-provider");
    if (stored === "anthropic" || stored === "openai") {
      setChatResponseProvider(stored);
    }
  }, []);

  useEffect(() => {
    window.localStorage.setItem(
      "vda:chat-response-provider",
      chatResponseProvider,
    );
  }, [chatResponseProvider]);

  // Auth state
  useEffect(() => {
    return onAuthStateChanged(firebaseAuth, (user) => {
      setUserId(user?.uid ?? null);
      setIsAdmin(isAdminEmail(user?.email));
      if (!user) return;
      getIdToken(user)
        .then((token) =>
          fetch("/api/users/me", {
            headers: { Authorization: `Bearer ${token}` },
          }),
        )
        .then((res) => (res.ok ? res.json() : null))
        .then((profile) => {
          if (isOnboardingMission) return;
          if (profile?.onboardingCompleted === true) {
            window.localStorage.setItem(
              `vda:onboarding-completed:${user.uid}`,
              "true",
            );
            window.localStorage.removeItem(
              `vda:onboarding-required:${user.uid}`,
            );
            return;
          }
          window.localStorage.removeItem(
            `vda:onboarding-completed:${user.uid}`,
          );
          router.replace(`/main/${ONBOARDING_MISSION_ID}`);
        })
        .catch(() => {
          const localOnboardingCompleted =
            window.localStorage.getItem(
              `vda:onboarding-completed:${user.uid}`,
            ) === "true";
          if (!localOnboardingCompleted) {
            router.replace(`/main/${ONBOARDING_MISSION_ID}`);
          }
        });
    });
  }, [isOnboardingMission, router]);

  // Load session from Firestore + fallback to global mission data
  useEffect(() => {
    if (!userId || !missionId) return;

    const targetUserId = viewAs && isAdmin ? viewAs : userId;
    const sessionRef = sessionRefFor(targetUserId);
    const missionRef = doc(db, "missions", missionId);
    setIsMissionContextReady(false);
    setSessionLoaded(false);

    // Register current user as participant (skip if viewing as someone else)
    if (!viewAs && !isOnboardingMission) {
      const user = firebaseAuth.currentUser;
      setDoc(
        doc(db, "missions", missionId, "participants", userId),
        {
          displayName: user?.displayName ?? null,
          email: user?.email ?? null,
          photoURL: user?.photoURL ?? null,
          updatedAt: Date.now(),
        },
        { merge: true },
      );
    }

    // If viewAs, fetch participant display name
    if (viewAs && isAdmin && !isOnboardingMission) {
      getDoc(doc(db, "missions", missionId, "participants", viewAs))
        .then((snap) => {
          if (snap.exists())
            setViewAsName(
              snap.data().displayName ?? snap.data().email ?? viewAs,
            );
          else setViewAsName(viewAs);
        })
        .catch(() => setViewAsName(viewAs));
    }

    // Session: load once; Mission: real-time listener
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let sessionData: Record<string, any> | null = null;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const applyMission = (missionData: Record<string, any> | null) => {
      const session = sessionData;
      const normalizedOptions = normalizeMissionOptions(
        missionData as {
          title?: string;
          description?: string;
          options?: MissionOption[];
        } | null,
      );

      const pTitle = missionData?.title || "";
      const pBrief = missionData?.description || "";
      setParentMissionTitle(pTitle);
      setParentMissionBrief(pBrief);

      // Use ref so re-selection by user is never overwritten
      const currentOptionId =
        selectedOptionIdRef.current ??
        (session?.selectedOptionId as string | undefined);
      const selectedOption =
        normalizedOptions.find((o) => o.id === currentOptionId) ??
        (normalizedOptions.length === 1 ? normalizedOptions[0] : null);
      setMissionOptions(normalizedOptions);

      setMissionTitle(session?.missionTitle || selectedOption?.title || pTitle);
      setMissionBrief(
        session?.missionBrief ||
          (selectedOption ? optionBrief(selectedOption) : pBrief),
      );
      const sessionDevice = session?.selectedDevice as Device | undefined;
      const optionDevice = selectedOption?.device;
      if (sessionDevice) setDevice(sessionDevice);
      else if (optionDevice) setDevice(optionDevice);
      else if (missionData?.device) setDevice(missionData.device as Device);
      if (missionData?.durationMinutes)
        setMissionDurationMinutes(Number(missionData.durationMinutes));
      setIsMissionContextReady(true);
    };

    getDoc(sessionRef).then((sessionSnap) => {
      const session = sessionSnap.exists() ? sessionSnap.data() : null;
      sessionData = session ?? null;
      setSessionLoaded(true);
      const completed = session?.status === "completed";
      setSessionCompleted(completed);
      // A session that was ever started must skip the pre-session setup page on
      // resume. The timer/status are the authoritative "already started" signals;
      // content checks are kept as a fallback for older snapshots.
      const sessionAlreadyStarted =
        completed ||
        session?.status === "active" ||
        Number(session?.timerStartedAt ?? session?.startedAt ?? 0) > 0 ||
        (session?.messages?.length ?? 0) > 0 ||
        (session?.ideas?.length ?? 0) > 0 ||
        (session?.artboards?.length ?? 0) > 0;
      if (sessionAlreadyStarted) setProfileModalConfirmed(true);
      setTimerEndedAt(
        session?.endedAt && completed
          ? Number(session.endedAt)
          : null,
      );

      if (session?.messages) setMessages(session.messages);
      // Load ideas first so we can reference their IDs
      const storedDesignStyles = Array.isArray(session?.designSpecs)
        ? (session.designSpecs as DesignStyle[])
        : [];
      const loadedIdeas: Idea[] = (session?.ideas ?? []).map(
        (idea: Idea, index: number) => {
          const ideaWithStoredDesignStyles = idea as Idea & {
            designStyles?: DesignStyle[];
          };
          const migratedStyle =
            idea.designStyle ??
            ideaWithStoredDesignStyles.designStyles?.[0] ??
            (index === 0 ? storedDesignStyles[0] : undefined);
          return {
            ...idea,
            designStyle: migratedStyle,
          };
        },
      );
      const firstIdeaId = loadedIdeas[0]?.id ?? "";

      if (session?.artboards && session.artboards.length > 0) {
        // Backward compat: old artboards without ideaId → assign to first idea
        const loaded: Artboard[] = session.artboards.map((a: Artboard) => ({
          ...a,
          ideaId: a.ideaId ?? firstIdeaId,
          htmlStatus:
            !a.html && a.stitchScreenId ? "pending" : a.htmlStatus,
        }));
        const normalizedLoaded = normalizeArtboardPositionsByIdea(loaded);
        setArtboards(normalizedLoaded);
        const firstIdeaBoards = normalizedLoaded.filter(
          (a) => a.ideaId === firstIdeaId,
        );
        setActiveArtboardId(
          (
            firstIdeaBoards.at(-1) ??
            normalizedLoaded[normalizedLoaded.length - 1]
          )?.id ?? null,
        );
        setActiveIdeaTab("mockup");
        const pid = session.stitchProjectId;
        if (pid) {
          normalizedLoaded.forEach((a: Artboard) => {
            if (!a.stitchScreenId || a.html) return;
            fetchStitchScreenHtml(pid, a.stitchScreenId)
              .then((html) =>
                setArtboards((prev) =>
                  prev.map((p) =>
                    p.id === a.id
                      ? {
                          ...p,
                          html,
                          htmlStatus: undefined,
                          htmlUpdatedAt: Date.now(),
                        }
                      : p,
                  ),
                ),
              )
              .catch(() =>
                setArtboards((prev) =>
                  prev.map((p) =>
                    p.id === a.id ? { ...p, htmlStatus: "failed" } : p,
                  ),
                ),
              );
          });
        }
      } else if (session?.mockupHtml) {
        const board: Artboard = {
          id: crypto.randomUUID(),
          html: session.mockupHtml,
          label: "Design 1",
          createdAt: Date.now(),
          x: 0,
          y: 0,
          device: "desktop",
          ideaId: firstIdeaId,
        };
        setArtboards([board]);
        setActiveArtboardId(board.id);
        setActiveIdeaTab("mockup");
      }

      if (loadedIdeas.length > 0) {
        setIdeas(loadedIdeas);
        setActiveIdeaId(loadedIdeas[0].id);
      } else if (!isReadOnly && !completed) {
        // Seed a default 시안 1 so the workspace, tabs, and Brief/Style/Mockup
        // structure are visible from the start (teachable in the tutorial) and
        // ideas do not appear out of nowhere mid-session. The first generated
        // brief fills this empty shell instead of appending a 시안 2.
        const defaultIdea: Idea = {
          id: crypto.randomUUID(),
          title: "시안 1",
          description: "",
          createdAt: Date.now(),
        };
        setIdeas([defaultIdea]);
        setActiveIdeaId(defaultIdea.id);
      }
      if (session?.references) setReferences(session.references);
      if (session?.activityLog) setActivityLog(session.activityLog);
      if (session?.stitchProjectId) setStitchProjectId(session.stitchProjectId);
      if (session?.finalArtboardId) setFinalArtboardId(session.finalArtboardId);

      const loadedTimerStartedAt = Number(
        session?.timerStartedAt ?? session?.startedAt ?? 0,
      );
      if (loadedTimerStartedAt) setTimerStartedAt(loadedTimerStartedAt);
      // Set selectedOptionId from session — only once at load
      if (session?.selectedOptionId) {
        setSelectedOptionId(session.selectedOptionId as string);
        selectedOptionIdRef.current = session.selectedOptionId as string;
      }
      if (isOnboardingMission) {
        fetchOnboardingMissionData()
          .then(applyMission)
          .catch(() => applyMission(null));
      }
    });

    if (isOnboardingMission) {
      return;
    }

    // Real-time mission listener — picks up admin edits immediately
    const unsubMission = onSnapshot(missionRef, (snap) => {
      applyMission(snap.exists() ? snap.data() : null);
    });

    return () => unsubMission();
  }, [userId, missionId, viewAs, isAdmin, isOnboardingMission]); // eslint-disable-line react-hooks/exhaustive-deps

  // Single-option missions have no selection screen (the option mechanic was
  // removed). Auto-select the only option once so the session records which
  // persona/brand was worked on and the content plumbing has an active option.
  const autoSelectedOptionRef = useRef(false);
  useEffect(() => {
    if (isReadOnly || !isMissionContextReady || !sessionLoaded || sessionCompleted)
      return;
    if (autoSelectedOptionRef.current) return;
    if (missionOptions.length === 1 && !selectedOptionId) {
      autoSelectedOptionRef.current = true;
      void chooseMissionOption(missionOptions[0]);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    isReadOnly,
    isMissionContextReady,
    sessionLoaded,
    sessionCompleted,
    missionOptions,
    selectedOptionId,
  ]);

  useEffect(() => {
    if (!targetSessionUserId || !missionId) {
      setReviewTurnsById({});
      return;
    }

    return onSnapshot(
      collection(
        db,
        "sessions",
        targetSessionUserId,
        "missions",
        missionId,
        "reviewTurns",
      ),
      (snap) => {
        setReviewTurnsById(
          Object.fromEntries(
            snap.docs.map((reviewTurnDoc) => [
              reviewTurnDoc.id,
              reviewTurnDoc.data() as ReviewTurn,
            ]),
          ),
        );
      },
      () => setReviewTurnsById({}),
    );
  }, [targetSessionUserId, missionId]);

  useEffect(() => {
    if (
      !showReviewAnnotations ||
      !targetSessionUserId ||
      reviewMemoryIds.length === 0
    ) {
      setReviewMemoryArchiveById({});
      return;
    }
    const currentUser = firebaseAuth.currentUser;
    if (!currentUser) {
      setReviewMemoryArchiveById({});
      return;
    }
    let cancelled = false;
    getIdToken(currentUser)
      .then((token) =>
        fetch("/api/memory/archive-status", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            targetUid: targetSessionUserId,
            memoryIds: reviewMemoryIds,
          }),
        }),
      )
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (cancelled) return;
        const statuses =
          data?.statuses && typeof data.statuses === "object"
            ? (data.statuses as Record<string, ReviewMemoryArchiveStatus>)
            : {};
        setReviewMemoryArchiveById(statuses);
      })
      .catch(() => {
        if (!cancelled) setReviewMemoryArchiveById({});
      });
    return () => {
      cancelled = true;
    };
  }, [
    showReviewAnnotations,
    targetSessionUserId,
    reviewMemoryIdsKey,
    reviewMemoryIds,
  ]);

  useEffect(() => {
    if (!showReviewAnnotations || !targetSessionUserId || !missionId) {
      setSessionMemorySummary(EMPTY_SESSION_MEMORY_SUMMARY);
      sessionMemorySummaryKeyRef.current = null;
      return;
    }
    const currentUser = firebaseAuth.currentUser;
    if (!currentUser) {
      setSessionMemorySummary(EMPTY_SESSION_MEMORY_SUMMARY);
      sessionMemorySummaryKeyRef.current = null;
      return;
    }
    const summaryKey = sessionMemorySummaryKey(targetSessionUserId, missionId);
    if (sessionMemorySummaryKeyRef.current === summaryKey) return;
    // Clear stale data immediately so the previous session's events don't bleed
    // into the new session's timeline while the fetch is in-flight.
    setSessionMemorySummary(EMPTY_SESSION_MEMORY_SUMMARY);
    sessionMemorySummaryKeyRef.current = summaryKey;
    let cancelled = false;
    getIdToken(currentUser)
      .then((token) =>
        fetchSessionMemorySummary(token, targetSessionUserId, missionId),
      )
      .then((summary) => {
        if (cancelled) return;
        setSessionMemorySummary(summary);
      })
      .catch(() => {
        if (!cancelled) setSessionMemorySummary(EMPTY_SESSION_MEMORY_SUMMARY);
      });
    return () => {
      cancelled = true;
    };
  }, [showReviewAnnotations, targetSessionUserId, missionId]);

  useEffect(() => {
    // Admins viewing as a user (viewAs) load that user's feedback read-only;
    // reviewers load their own. Other modes have no feedback to show.
    if ((!isReviewMode && !isViewingAsAdmin) || !missionId) {
      memoryReviewAnswersRef.current = {};
      memoryReviewDirtyRef.current = false;
      memoryReviewSaveKeyRef.current = "";
      setMemoryReviewAnswers(null);
      setMemoryReviewSubmittedAt(null);
      setMemoryReviewSaveStatus("idle");
      return;
    }
    // On refresh the Firebase session restores asynchronously, so currentUser
    // is often null on the first run. Bail and let the effect re-run once
    // onAuthStateChanged sets userId (a dependency below).
    const currentUser = firebaseAuth.currentUser;
    if (!currentUser) return;
    if (isViewingAsAdmin && !targetSessionUserId) return;

    let cancelled = false;
    const load = async () => {
      const maxAttempts = 3;
      for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
        try {
          const token = await getIdToken(currentUser);
          if (cancelled) return;
          memoryReviewTokenRef.current = token;
          const targetQuery =
            isViewingAsAdmin && targetSessionUserId
              ? `&targetUid=${encodeURIComponent(targetSessionUserId)}`
              : "";
          const response = await fetch(
            `/api/memory/review-feedback?missionId=${encodeURIComponent(missionId)}${targetQuery}`,
            {
              cache: "no-store",
              headers: { Authorization: `Bearer ${token}` },
            },
          );
          if (cancelled) return;
          if (!response.ok) throw new Error(`load_failed_${response.status}`);
          const data = await response.json();
          if (cancelled) return;
          const feedback =
            data?.feedback && typeof data.feedback === "object"
              ? (data.feedback as {
                  answers?: MemoryReviewAnswers;
                  submittedAt?: number | null;
                })
              : null;
          const answers = feedback?.answers ?? {};
          memoryReviewAnswersRef.current = answers;
          memoryReviewDirtyRef.current = false;
          memoryReviewSaveKeyRef.current = JSON.stringify({
            answers,
            submitted: false,
          });
          setMemoryReviewAnswers(answers);
          setMemoryReviewSubmittedAt(feedback?.submittedAt ?? null);
          setMemoryReviewSaveStatus(feedback ? "saved" : "idle");
          return;
        } catch {
          if (cancelled) return;
          if (attempt === maxAttempts - 1) {
            setMemoryReviewSaveStatus("error");
            return;
          }
          await new Promise((resolve) =>
            window.setTimeout(resolve, 500 * 2 ** attempt),
          );
        }
      }
    };
    void load();

    return () => {
      cancelled = true;
    };
  }, [
    isReviewMode,
    isViewingAsAdmin,
    missionId,
    userId,
    targetSessionUserId,
  ]);

  useEffect(() => {
    if (!isReviewMode || isViewingAsAdmin || !memoryReviewDirtyRef.current) {
      return;
    }
    const timeoutId = window.setTimeout(() => {
      void saveMemoryReviewFeedback(false);
    }, 300);
    return () => window.clearTimeout(timeoutId);
  }, [
    isReviewMode,
    isViewingAsAdmin,
    memoryReviewAnswers,
    saveMemoryReviewFeedback,
  ]);

  // Flush pending edits before the page is torn down or backgrounded, so the
  // 300ms autosave debounce does not lose the last keystrokes on refresh.
  useEffect(() => {
    if (!isReviewMode || isViewingAsAdmin) return;
    const handleHide = () => {
      if (document.visibilityState === "hidden") flushMemoryReviewFeedback();
    };
    window.addEventListener("pagehide", flushMemoryReviewFeedback);
    document.addEventListener("visibilitychange", handleHide);
    return () => {
      window.removeEventListener("pagehide", flushMemoryReviewFeedback);
      document.removeEventListener("visibilitychange", handleHide);
    };
  }, [isReviewMode, isViewingAsAdmin, flushMemoryReviewFeedback]);

  // When the memory diff overlay opens, default to "after" if this session created
  // any new memories, so they are visible (highlighted) right away. With the
  // cumulative model the "before" set is rarely empty (onboarding + prior
  // missions), so gating on an empty before-set would hide the new memories.
  // Users can still toggle to "before" to see the prior-only state.
  useEffect(() => {
    if (!isMemoryDiffOpen) return;
    if (memoryGraphPhase !== "before") return;
    if (sessionMemorySummary.promoted.length > 0) {
      setMemoryGraphPhase("after");
    }
  }, [isMemoryDiffOpen]); // eslint-disable-line react-hooks/exhaustive-deps

  // Load profile memories for review panel (review mode)
  useEffect(() => {
    if (!showReviewAnnotations || !targetSessionUserId || !missionId) {
      setReviewProfileItems([]);
      return;
    }
    const currentUser = firebaseAuth.currentUser;
    if (!currentUser) return;
    let cancelled = false;
    getIdToken(currentUser)
      .then((token) => {
        const params = new URLSearchParams({ missionId });
        if (targetSessionUserId !== currentUser.uid)
          params.set("targetUid", targetSessionUserId);
        return fetch(`/api/memory/profile?${params}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
      })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (cancelled) return;
        setReviewProfileItems(Array.isArray(data?.items) ? data.items : []);
      })
      .catch(() => {
        if (!cancelled) setReviewProfileItems([]);
      });
    return () => { cancelled = true; };
  }, [showReviewAnnotations, targetSessionUserId, missionId]);

  // Load profile memories when mission context is ready (non-read-only only)
  useEffect(() => {
    if (!isMissionContextReady || isReadOnly || !missionId) return;
    const currentUser = firebaseAuth.currentUser;
    if (!currentUser) return;
    let cancelled = false;
    getIdToken(currentUser)
      .then((token) =>
        fetch(
          `/api/memory/profile?missionId=${encodeURIComponent(missionId)}`,
          { headers: { Authorization: `Bearer ${token}` } },
        ),
      )
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (cancelled) return;
        setProfileRawMarkdown(typeof data?.rawMarkdown === "string" ? data.rawMarkdown : "");
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [isMissionContextReady, isReadOnly, missionId]);

  const persistSessionSnapshot = useCallback(
    async (startedAtOverride?: number | null) => {
      if (isReadOnly || !userId || !missionId) return;
      const effectiveTimerStartedAt =
        startedAtOverride === undefined ? timerStartedAt : startedAtOverride;
      const hasSnapshotContent =
        messages.length > 0 ||
        artboards.length > 0 ||
        references.length > 0 ||
        ideas.length > 0 ||
        activityLog.length > 0 ||
        Boolean(missionTitle) ||
        Boolean(missionBrief) ||
        Boolean(selectedOptionId) ||
        Boolean(effectiveTimerStartedAt);
      if (!hasSnapshotContent) return;
      const artboardsToSave = artboards.map((a) =>
        a.stitchScreenId ? { ...a, html: "" } : a,
      );
      await setDoc(
        sessionRefFor(userId),
        cleanForFirestore({
          messages,
          missionId,
          artboards: artboardsToSave,
          references,
          activityLog: activityLog.slice(-500),
          ideas,
          missionTitle,
          missionBrief,
          selectedOptionId,
          selectedDevice: device,
          stitchProjectId: stitchProjectId || null,
          finalArtboardId: finalArtboardId ?? null,
          startedAt: effectiveTimerStartedAt ?? null,
          timerStartedAt: effectiveTimerStartedAt ?? null,
          status: sessionCompleted
            ? "completed"
            : effectiveTimerStartedAt
              ? "active"
              : "draft",
          updatedAt: Date.now(),
        }),
        { merge: true },
      );
    },
    [
      isReadOnly,
      userId,
      missionId,
      timerStartedAt,
      messages,
      artboards,
      references,
      ideas,
      activityLog,
      missionTitle,
      missionBrief,
      selectedOptionId,
      device,
      stitchProjectId,
      finalArtboardId,
      sessionCompleted,
      sessionRefFor,
    ],
  );

  // Save session to Firestore (debounced to avoid write storms during streaming)
  useEffect(() => {
    if (isReadOnly) return;
    if (
      !userId ||
      !missionId ||
      (messages.length === 0 &&
        artboards.length === 0 &&
        references.length === 0 &&
        ideas.length === 0 &&
        activityLog.length === 0 &&
        !missionTitle &&
        !missionBrief &&
        !selectedOptionId &&
        !timerStartedAt)
    )
      return;
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      void persistSessionSnapshot();
    }, 1500);
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, [isReadOnly, userId, missionId, persistSessionSnapshot]);

  useEffect(() => {
    if (isReadOnly) return;
    const flushSessionIfHidden = () => {
      if (document.visibilityState === "hidden") {
        void persistSessionSnapshot();
      }
    };
    document.addEventListener("visibilitychange", flushSessionIfHidden);
    return () =>
      document.removeEventListener("visibilitychange", flushSessionIfHidden);
  }, [isReadOnly, persistSessionSnapshot]);

  // Countdown / count-up timer
  useEffect(() => {
    if (!timerStartedAt) {
      setTimerDisplay("");
      return;
    }
    const displayForTime = (currentTime: number) => {
      const elapsed = Math.max(0, currentTime - timerStartedAt);
      if (missionDurationMinutes && missionDurationMinutes > 0) {
        const remaining = missionDurationMinutes * 60 * 1000 - elapsed;
        if (remaining <= 0) return "시간 종료";
        const m = Math.floor(remaining / 60000);
        const s = Math.floor((remaining % 60000) / 1000);
        return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
      }
      const m = Math.floor(elapsed / 60000);
      const s = Math.floor((elapsed % 60000) / 1000);
      return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
    };
    if (sessionCompleted && timerEndedAt) {
      setTimerDisplay(displayForTime(timerEndedAt));
      return;
    }
    const update = () => {
      setTimerDisplay(displayForTime(Date.now()));
    };
    update();
    const id = setInterval(update, 1000);
    return () => clearInterval(id);
  }, [timerStartedAt, timerEndedAt, sessionCompleted, missionDurationMinutes]);

  useEffect(() => {
    const el = chatScrollRef.current;
    if (!el) return;
    const handleScroll = () => {
      setShowScrollToBottom(
        el.scrollHeight - el.scrollTop - el.clientHeight > 100,
      );
    };
    el.addEventListener("scroll", handleScroll, { passive: true });
    return () => el.removeEventListener("scroll", handleScroll);
  }, []);

  // Listen for element selection from iframe
  const editModeRef = useRef(false);
  useEffect(() => {
    editModeRef.current = editMode;
  }, [editMode]);

  useEffect(() => {
    const handler = (e: MessageEvent) => {
      if (e.data?.type === "vda-element-selected" && editModeRef.current) {
        setSelectedElement({
          artboardId: e.data.artboardId,
          selector: e.data.selector,
          outerHTML: e.data.outerHTML,
          textContent:
            typeof e.data.textContent === "string"
              ? e.data.textContent
              : undefined,
          xpath: typeof e.data.xpath === "string" ? e.data.xpath : undefined,
          boundingRect:
            e.data.boundingRect && typeof e.data.boundingRect === "object"
              ? (e.data.boundingRect as SelectedElementBounds)
              : undefined,
          viewport:
            e.data.viewport && typeof e.data.viewport === "object"
              ? (e.data.viewport as SelectedElementViewport)
              : undefined,
        });
        setActiveArtboardId(e.data.artboardId);
      }
      if (e.data?.type === "vda-artboard-height") {
        const artboardId = String(e.data.artboardId ?? "");
        const height = Number(e.data.height);
        if (!artboardId || !Number.isFinite(height)) return;
        setArtboardHeights((prev) => {
          const nextHeight = Math.max(Math.ceil(height), 1);
          if (Math.abs((prev[artboardId] ?? 0) - nextHeight) < 2) return prev;
          return { ...prev, [artboardId]: nextHeight };
        });
      }
      if (e.data?.type === "vda-canvas-gesture-start") {
        gestureStartScaleRef.current = canvasScaleRef.current;
      }
      if (e.data?.type === "vda-artboard-context-menu") {
        if (isReadOnly) return;
        const canvas = canvasRef.current;
        if (!canvas) return;
        const artboard = artboardsRef.current.find(
          (a) => a.id === e.data.artboardId,
        );
        if (!artboard) return;

        const rect = canvas.getBoundingClientRect();
        const scale = canvasScaleRef.current;
        const x =
          rect.left +
          canvasOffsetRef.current.x +
          (artboard.x + (e.data.clientX ?? 0)) * scale;
        const y =
          rect.top +
          canvasOffsetRef.current.y +
          (artboard.y + (e.data.clientY ?? 0)) * scale;
        setActiveArtboardId(artboard.id);
        setDesignContextMenu({ artboardId: artboard.id, x, y });
      }
      if (
        e.data?.type === "vda-canvas-wheel" ||
        e.data?.type === "vda-canvas-gesture-change"
      ) {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const artboard = artboardsRef.current.find(
          (a) => a.id === e.data.artboardId,
        );
        if (!artboard) return;

        const rect = canvas.getBoundingClientRect();
        const scale = canvasScaleRef.current;
        const clientX =
          rect.left +
          canvasOffsetRef.current.x +
          (artboard.x + (e.data.clientX ?? 0)) * scale;
        const clientY =
          rect.top +
          canvasOffsetRef.current.y +
          (artboard.y + (e.data.clientY ?? 0)) * scale;
        const mouseX = clientX - rect.left;
        const mouseY = clientY - rect.top;
        const prevScale = canvasScaleRef.current;
        const nextScale =
          e.data.type === "vda-canvas-gesture-change"
            ? gestureStartScaleRef.current * (e.data.scale ?? 1)
            : prevScale *
              Math.exp(
                -(e.data.deltaY ?? 0) * (e.data.ctrlKey ? 0.006 : 0.0025),
              );
        const clampedScale = Math.min(
          Math.max(nextScale, MIN_CANVAS_SCALE),
          MAX_CANVAS_SCALE,
        );
        if (Math.abs(clampedScale - prevScale) < 0.001) return;

        const prevOffset = canvasOffsetRef.current;
        const nextOffset = {
          x: mouseX - (mouseX - prevOffset.x) * (clampedScale / prevScale),
          y: mouseY - (mouseY - prevOffset.y) * (clampedScale / prevScale),
        };
        applyCanvasViewDirectly(clampedScale, nextOffset);
        commitCanvasViewSoon(clampedScale, nextOffset);
      }
    };
    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  }, [applyCanvasViewDirectly, commitCanvasViewSoon, isReadOnly]);

  // Trackpad and mouse zoom toward cursor
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let animationFrame: number | null = null;
    let pendingScale = canvasScaleRef.current;
    let pendingOffset = canvasOffsetRef.current;

    const clampScale = (scale: number) =>
      Math.min(Math.max(scale, MIN_CANVAS_SCALE), MAX_CANVAS_SCALE);
    const scheduleCanvasView = (
      scale: number,
      offset: { x: number; y: number },
    ) => {
      pendingScale = scale;
      pendingOffset = offset;
      if (animationFrame !== null) return;

      animationFrame = requestAnimationFrame(() => {
        animationFrame = null;
        applyCanvasViewDirectly(pendingScale, pendingOffset);
        commitCanvasViewSoon(pendingScale, pendingOffset);
      });
    };

    const zoomAtPoint = (
      clientX: number,
      clientY: number,
      nextScale: number,
    ) => {
      const rect = canvas.getBoundingClientRect();
      const mouseX = clientX - rect.left;
      const mouseY = clientY - rect.top;
      const prevScale = canvasScaleRef.current;
      const clampedScale = clampScale(nextScale);
      if (Math.abs(clampedScale - prevScale) < 0.001) return;

      const prevOffset = canvasOffsetRef.current;
      scheduleCanvasView(clampedScale, {
        x: mouseX - (mouseX - prevOffset.x) * (clampedScale / prevScale),
        y: mouseY - (mouseY - prevOffset.y) * (clampedScale / prevScale),
      });
    };

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();

      const unit =
        e.deltaMode === WheelEvent.DOM_DELTA_LINE
          ? 16
          : e.deltaMode === WheelEvent.DOM_DELTA_PAGE
            ? canvas.clientHeight
            : 1;
      const normalizedDelta = e.deltaY * unit;
      const sensitivity = e.ctrlKey ? 0.006 : 0.0025;
      const factor = Math.exp(-normalizedDelta * sensitivity);
      zoomAtPoint(e.clientX, e.clientY, canvasScaleRef.current * factor);
    };

    const onGestureStart = (e: Event) => {
      e.preventDefault();
      gestureStartScaleRef.current = canvasScaleRef.current;
    };

    const onGestureChange = (e: Event) => {
      e.preventDefault();
      const gesture = e as WebKitGestureEvent;
      const rect = canvas.getBoundingClientRect();
      const clientX = gesture.clientX ?? rect.left + rect.width / 2;
      const clientY = gesture.clientY ?? rect.top + rect.height / 2;
      zoomAtPoint(
        clientX,
        clientY,
        gestureStartScaleRef.current * (gesture.scale ?? 1),
      );
    };

    canvas.addEventListener("wheel", onWheel, { passive: false });
    canvas.addEventListener("gesturestart", onGestureStart, { passive: false });
    canvas.addEventListener("gesturechange", onGestureChange, {
      passive: false,
    });
    return () => {
      if (animationFrame !== null) cancelAnimationFrame(animationFrame);
      canvas.removeEventListener("wheel", onWheel);
      canvas.removeEventListener("gesturestart", onGestureStart);
      canvas.removeEventListener("gesturechange", onGestureChange);
    };
  }, [
    artboards.length,
    activeIdeaId,
    isMockupExpanded,
    applyCanvasViewDirectly,
    commitCanvasViewSoon,
  ]);

  // Fit all artboards into canvas view
  const fitToCanvasForIdea = useCallback((ideaId: string | null) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const boards = artboardsRef.current.filter((a) => a.ideaId === ideaId);
    if (boards.length === 0) return;
    const { clientWidth, clientHeight } = canvas;
    const minX = Math.min(...boards.map((a) => a.x));
    const minY = Math.min(...boards.map((a) => a.y));
    const maxX = Math.max(
      ...boards.map((a) => a.x + DEVICE_SIZE[a.device ?? "desktop"].width),
    );
    const maxY = Math.max(
      ...boards.map(
        (a) =>
          a.y +
          (artboardHeightsRef.current[a.id] ??
            DEVICE_SIZE[a.device ?? "desktop"].height),
      ),
    );
    const totalW = maxX - minX;
    const totalH = maxY - minY;
    const scale = Math.min(
      (clientWidth - 80) / totalW,
      (clientHeight - 80) / totalH,
      1,
    );
    setCanvasScale(scale);
    setCanvasOffset({
      x: (clientWidth - totalW * scale) / 2 - minX * scale,
      y: (clientHeight - totalH * scale) / 2 - minY * scale,
    });
  }, []);

  const fitToCanvas = useCallback(() => {
    fitToCanvasForIdea(activeIdeaIdRef.current);
  }, [fitToCanvasForIdea]);

  // Auto-fit when first artboard is added
  useEffect(() => {
    if (artboards.length === 1) setTimeout(fitToCanvas, 0);
  }, [artboards.length, fitToCanvas]);

  const switchIdea = (ideaId: string, preserveComposerMention = false) => {
    if (!preserveComposerMention) setComposerMention(null);
    setActiveIdeaId(ideaId);
    setIsIdeaExpanded(false);
    setActiveIdeaTab("idea");
    const ideaBoards = artboardsRef.current.filter((a) => a.ideaId === ideaId);
    setActiveArtboardId(ideaBoards.at(-1)?.id ?? null);
    setTimeout(() => fitToCanvasForIdea(ideaId), 0);
  };

  const composerMentionOptions = useMemo<ChatComposerMention[]>(() => {
    const orderedIdeas = [
      ...ideas.filter((idea) => idea.id === activeIdeaId),
      ...ideas.filter((idea) => idea.id !== activeIdeaId),
    ];
    return orderedIdeas.flatMap((idea) => {
      const ideaNumber = ideas.findIndex((candidate) => candidate.id === idea.id) + 1;
      const ideaLabel = idea.title.trim() || `시안 ${Math.max(ideaNumber, 1)}`;
      const options: ChatComposerMention[] = [
        {
          kind: "idea",
          ideaId: idea.id,
          label: ideaLabel,
          searchText: `${ideaLabel} 시안`,
        },
      ];
      if (idea.description.trim()) {
        options.push({
          kind: "design_brief",
          ideaId: idea.id,
          artifactId: idea.id,
          label: `${ideaLabel} · 디자인 브리프`,
          searchText: `${ideaLabel} 디자인브리프 design brief 브리프`,
        });
      }
      if (idea.designStyle?.content?.trim()) {
        options.push({
          kind: "design_style",
          ideaId: idea.id,
          artifactId: idea.designStyle.id,
          label: `${ideaLabel} · 디자인 스타일`,
          searchText: `${ideaLabel} 디자인스타일 design style 스타일`,
        });
      }
      const ideaArtboard = artboards
        .filter((artboard) => artboard.ideaId === idea.id)
        .at(-1);
      if (ideaArtboard) {
        options.push({
          kind: "mockup",
          ideaId: idea.id,
          artifactId: ideaArtboard.id,
          label: `${ideaLabel} · 목업`,
          searchText: `${ideaLabel} 목업 mockup`,
        });
      }
      return options;
    });
  }, [activeIdeaId, artboards, ideas]);

  const composerCommandOptions = useMemo<ChatComposerCommand[]>(() => {
    const activeIdea = ideas.find((idea) => idea.id === activeIdeaId) ?? null;
    const hasMockup = artboards.some(
      (artboard) => artboard.ideaId === activeIdeaId,
    );
    const hasImageLedSource = Boolean(
      attachedStyleImage ||
        selectedReferences.some((reference) => reference.url) ||
        extractFirstUrl(inputText),
    );
    return CHAT_COMPOSER_COMMANDS.map((command) => {
      let disabledReason: string | undefined;
      if (command.id === "create_design_style") {
        if (activeIdea?.designStyle?.content?.trim()) {
          disabledReason = "현재 시안에 이미 Design Style이 있어요";
        }
      }
      if (command.id === "generate_mockup") {
        if (!activeIdea?.description.trim()) {
          disabledReason = "먼저 시안과 Design Brief가 필요해요";
        } else if (
          !activeIdea?.designStyle?.content?.trim() &&
          !hasImageLedSource
        ) {
          disabledReason = "먼저 Design Style이 필요해요";
        } else if (hasMockup) {
          disabledReason = "현재 시안에 이미 목업이 있어요";
        }
      }
      return { ...command, disabledReason };
    });
  }, [
    activeIdeaId,
    artboards,
    attachedStyleImage,
    ideas,
    inputText,
    selectedReferences,
  ]);

  useEffect(() => {
    if (!composerCommand) return;
    const currentOption = composerCommandOptions.find(
      (option) => option.id === composerCommand.id,
    );
    if (currentOption?.disabledReason) setComposerCommand(null);
  }, [composerCommand, composerCommandOptions]);

  useEffect(() => {
    if (
      composerMention &&
      !ideas.some((idea) => idea.id === composerMention.ideaId)
    ) {
      setComposerMention(null);
    }
  }, [composerMention, ideas]);

  const requestDeleteIdea = (ideaId: string) => {
    if (isReadOnly) return;
    const target = ideas.find((i) => i.id === ideaId);
    if (!target) return;
    setDestructiveAction({ type: "idea", idea: target });
  };

  const performDeleteIdea = (ideaId: string) => {
    const target = ideas.find((i) => i.id === ideaId);
    void encodeMemoryDraft(
      `delete-idea-${ideaId}`,
      `시안 삭제: ${target?.title ?? ideaId}`,
      `삭제된 시안 내용: ${target?.description?.slice(0, 500) ?? "(없음)"}`,
      Date.now(),
    );
    appendActivityLog({
      section: "note",
      action: "delete",
      output: target?.description?.slice(0, 500) ?? "",
      outputTitle: target?.title ?? ideaId,
    });
    setIdeas((prev) => {
      const remaining = prev.filter((i) => i.id !== ideaId);
      const wasActive = activeIdeaId === ideaId;
      if (wasActive) {
        const next = remaining[0] ?? null;
        setActiveIdeaId(next?.id ?? null);
        if (next) setTimeout(() => fitToCanvasForIdea(next.id), 0);
      }
      return remaining;
    });
    setArtboards((prev) => prev.filter((a) => a.ideaId !== ideaId));
  };

  const updateIdea = (id: string, changes: Partial<Omit<Idea, "id">>) => {
    setIdeas((prev) =>
      prev.map((i) => (i.id === id ? { ...i, ...changes } : i)),
    );
  };

  const handleCanvasMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(true);
    dragStartRef.current = {
      mouseX: e.clientX,
      mouseY: e.clientY,
      offsetX: canvasOffset.x,
      offsetY: canvasOffset.y,
    };
  };

  const handleCanvasMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!dragStartRef.current) return;
    setCanvasOffset({
      x:
        dragStartRef.current.offsetX +
        (e.clientX - dragStartRef.current.mouseX),
      y:
        dragStartRef.current.offsetY +
        (e.clientY - dragStartRef.current.mouseY),
    });
  };

  const handleCanvasMouseUp = () => {
    setIsDragging(false);
    dragStartRef.current = null;
  };

  const cancelMessage = useCallback(() => {
    abortControllerRef.current?.abort();
  }, []);

  const cancelMockupGeneration = useCallback(() => {
    stitchCancelRequestedRef.current = true;
    stitchAbortControllerRef.current?.abort();
  }, []);

  const clearIframeSelections = useCallback((artboardId?: string | null) => {
    mockupFrameRefs.current.forEach((frame, id) => {
      if (artboardId && id !== artboardId) return;
      frame.contentWindow?.postMessage(
        { type: "vda-clear-selection", artboardId: artboardId ?? id },
        "*",
      );
    });
  }, []);

  const clearSelectedElement = useCallback(() => {
    clearIframeSelections(selectedElement?.artboardId ?? null);
    setSelectedElement(null);
  }, [clearIframeSelections, selectedElement?.artboardId]);

  const handleAttachStyleImage = useCallback((file: File) => {
    if (!file.type.startsWith("image/")) return;
    if (file.size > 12 * 1024 * 1024) {
      alert("이미지가 너무 큽니다 (최대 12MB).");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result !== "string") return;
      const original = reader.result;
      // Downscale before keeping it: the same dataURL is sent to Stitch (which
      // re-caps at 1600px anyway), shown in the chat bubble, and persisted with
      // the session — so a full-res base64 would bloat the Firestore doc.
      const img = new Image();
      img.onload = () => {
        const maxDim = 1280;
        const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
        const w = Math.max(1, Math.round(img.width * scale));
        const h = Math.max(1, Math.round(img.height * scale));
        const canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          setAttachedStyleImage({ dataUrl: original, name: file.name });
          return;
        }
        ctx.drawImage(img, 0, 0, w, h);
        setAttachedStyleImage({
          dataUrl: canvas.toDataURL("image/jpeg", 0.85),
          name: file.name,
        });
      };
      img.onerror = () =>
        setAttachedStyleImage({ dataUrl: original, name: file.name });
      img.src = original;
    };
    reader.readAsDataURL(file);
  }, []);

  const sendMessage = useCallback(async () => {
    const commandForTurn = composerCommand;
    const mentionForTurn = composerMention;
    const typedText = inputText.trim();
    const text = typedText || commandForTurn?.defaultPrompt || "";
    if (!text || !isMissionContextReady || isLoading || isGeneratingMockup)
      return;
    // Snapshot the attached style image for this turn; the GENERATE_MOCKUP call
    // happens later in the streaming handler, after we clear the composer chip.
    const styleImageForTurn = attachedStyleImage?.dataUrl ?? null;
    // Phase 2: if no image is attached, a URL in the message or a cited
    // reference's URL drives appearance (server screenshots it). Attached image
    // wins. Snapshotted now because selectedReferences is cleared on send.
    const styleSourceUrlForTurn = styleImageForTurn
      ? null
      : extractFirstUrl(text) ??
        selectedReferences.find((reference) => reference.url)?.url ??
        null;
    const userMsg: Message = {
      id: crypto.randomUUID(),
      role: "user",
      content: text,
      createdAt: Date.now(),
      citedElement: selectedElement
        ? {
            selector: selectedElement.selector,
            artboardId: selectedElement.artboardId,
            outerHTML: selectedElement.outerHTML,
            textContent: selectedElement.textContent,
            xpath: selectedElement.xpath,
            boundingRect: selectedElement.boundingRect,
            viewport: selectedElement.viewport,
          }
        : null,
      citedReferences:
        selectedReferences.length > 0
          ? selectedReferences.map((r) => ({
              id: r.id,
              title: r.title,
              imageUrl: r.imageUrl,
            }))
          : null,
      citedTexts: citedTexts.length > 0 ? [...citedTexts] : null,
      styleImage: attachedStyleImage,
      composerCommand: commandForTurn,
      composerMention: mentionForTurn,
    };
    const assistantId = crypto.randomUUID();
    const assistantMsg: Message = {
      id: assistantId,
      role: "assistant",
      content: "",
      createdAt: Date.now(),
      reviewTurnId: assistantId,
    };
    setCollapsedChatPhaseIds((prev) => {
      if (!prev.has(assistantId)) return prev;
      const next = new Set(prev);
      next.delete(assistantId);
      return next;
    });
    setExpandedChatPhaseIds((prev) => {
      if (!prev.has(assistantId)) return prev;
      const next = new Set(prev);
      next.delete(assistantId);
      return next;
    });
    const manualReference = parseManualReferencePrompt(text);
    const memoryInput = text;
    const memorySources: MemoryDraftSources = {
      texts: [...citedTexts],
      links: selectedReferences.map(memorySourceLinkFromReference),
      image: attachedStyleImage,
      uiResult: selectedElement
        ? {
            artboardId: selectedElement.artboardId,
            selector: selectedElement.selector,
            html: selectedElement.outerHTML,
          }
        : null,
    };

    setMessages((prev) => [...prev, userMsg, assistantMsg]);
    setInputText("");
    setComposerCommand(null);
    setComposerMention(null);
    if (selectedElement) {
      clearIframeSelections(selectedElement.artboardId);
      setSelectedElement(null);
    }
    setSelectedReferences([]);
    setCitedTexts([]);
    setAttachedStyleImage(null);

    if (manualReference) {
      const alreadyExists = references.some((reference) =>
        referenceMatches(reference, manualReference),
      );
      const hydratedReference = alreadyExists
        ? manualReference
        : await hydrateManualReference(manualReference);
      setReferences((prev) => {
        const exists = prev.some((reference) =>
          referenceMatches(reference, hydratedReference),
        );
        if (exists) return prev;
        return [...prev, hydratedReference];
      });
      if (!alreadyExists) {
        appendActivityLog({
          section: "reference",
          action: "add",
          input: text,
          output: hydratedReference.title,
          outputTitle: hydratedReference.title,
          link: hydratedReference.url,
          imageUrl: hydratedReference.imageUrl,
        });
      }
      const manualReferenceReply = alreadyExists
        ? `이미 레퍼런스에 있는 링크입니다: ${manualReference.url}`
        : hydratedReference.imageUrl
          ? `레퍼런스에 썸네일과 함께 추가했습니다: ${hydratedReference.url}`
          : `레퍼런스에 추가했습니다. 썸네일은 찾지 못했습니다: ${hydratedReference.url}`;
      setMessages((prev) =>
        prev.map((message) =>
          message.id === assistantId
            ? {
                ...message,
                content: manualReferenceReply,
              }
            : message,
        ),
      );
      void encodeMemoryDraft(
        assistantId,
        memoryInput,
        manualReferenceReply,
        userMsg.createdAt ?? Date.now(),
        {
          ...memorySources,
          links: [
            ...(memorySources.links ?? []),
            memorySourceLinkFromReference(hydratedReference),
          ],
        },
      );
      setChatPhasesByMessageId((prev) => {
        const next = { ...prev };
        delete next[assistantId];
        return next;
      });
      return;
    }

    setIsLoading(true);

    const controller = new AbortController();
    abortControllerRef.current = controller;
    const timeoutId = setTimeout(() => controller.abort("timeout"), 90_000);

    const currentIdeaBoards = artboards.filter(
      (a) => a.ideaId === activeIdeaId,
    );
    const activeBoard =
      currentIdeaBoards.find((a) => a.id === activeArtboardId) ??
      currentIdeaBoards.at(-1) ??
      null;
    const effectiveMissionTitle =
      parentMissionTitle || activeOption?.title || missionTitle || undefined;
    const effectiveMissionBrief =
      [
        parentMissionBrief ? `[전체 미션 설명]\n${parentMissionBrief}` : "",
        activeOption
          ? `[선택된 옵션: ${activeOption.title}]\n${optionBrief(activeOption)}`
          : missionBrief,
      ]
        .filter(Boolean)
        .join("\n\n") || undefined;

    try {
      const retrievalMissionLabel =
        parentMissionTitle || activeOption?.title || missionTitle || "";
      const retrievalQuery = [
        text,
        retrievalMissionLabel ? `Mission: ${retrievalMissionLabel}` : "",
        activeIdeaId
          ? `Active idea: ${ideas.find((idea) => idea.id === activeIdeaId)?.description ?? ""}`
          : "",
      ]
        .filter(Boolean)
        .join("\n\n");
      const retrievedMemory = await retrieveMemoryForQuery(retrievalQuery);
      const isReferenceSearchTurn =
        commandForTurn?.id === "fetch_references" ||
        isReferenceSearchRequest(text);
      const promptMemory = isReferenceSearchTurn
        ? filterMemoryForReferenceSearch(retrievedMemory)
        : retrievedMemory;
      const turnMemoryContext =
        promptMemory && promptMemory.length > 0
          ? {
              episodic: [],
              semantic: promptMemory,
            }
          : { episodic: [], semantic: [] };
      const currentUser = firebaseAuth.currentUser;
      const chatToken = currentUser ? await getIdToken(currentUser) : null;
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(chatToken ? { Authorization: `Bearer ${chatToken}` } : {}),
        },
        signal: controller.signal,
        body: JSON.stringify({
          messages: [...messages, userMsg]
            .slice(-12)
            .map(({ role, content }) => ({
              role,
              content: cleanMessageContentForModel(content),
            }))
            .filter((message) => message.content),
          mockupHtml: activeBoard?.html || undefined,
          selectedElement: selectedElement || undefined,
          citedReferences:
            selectedReferences.length > 0 ? selectedReferences : undefined,
          missionTitle: effectiveMissionTitle,
          missionBrief: effectiveMissionBrief,
          device,
          responseProvider: isAdmin ? chatResponseProvider : undefined,
          activeIdea: ideas.find((i) => i.id === activeIdeaId) ?? undefined,
          memoryContext:
            turnMemoryContext.episodic.length > 0 ||
            turnMemoryContext.semantic.length > 0
              ? turnMemoryContext
              : undefined,
          citedTexts: citedTexts.length > 0 ? citedTexts : undefined,
          referencePreferenceContext: missionId
            ? buildReferencePreferenceContext(
                missionId,
                references,
                activityLog,
                messages,
                text,
              )
            : undefined,
          designSpec: (() => {
            const idea = ideas.find((i) => i.id === activeIdeaId);
            const appliedStyle = activeDesignStyle(idea);
            return appliedStyle
              ? `# ${appliedStyle.title}\n${appliedStyle.content}`
              : undefined;
          })(),
          requestedCommand: commandForTurn
            ? { id: commandForTurn.id, label: commandForTurn.label }
            : undefined,
          mentionedArtifact: mentionForTurn
            ? {
                kind: mentionForTurn.kind,
                ideaId: mentionForTurn.ideaId,
                artifactId: mentionForTurn.artifactId,
                label: mentionForTurn.label,
              }
            : undefined,
          review: {
            missionId,
            turnId: assistantId,
            userMessageId: userMsg.id,
            query: retrievalQuery,
          },
        }),
      });

      if (!res.ok) {
        const errorData = await res.json().catch(() => null);
        throw new Error(
          typeof errorData?.error === "string"
            ? errorData.error
            : "요청을 처리하지 못했습니다.",
        );
      }
      if (!res.body) throw new Error("응답 스트림을 열지 못했습니다.");

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let fullText = "";
      let deferredMockupCompletionText = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        fullText += chunk;
        const chatPhases = extractChatPhases(fullText);
        if (chatPhases.phases.length > 0) {
          setChatPhasesByMessageId((prev) => ({
            ...prev,
            [assistantId]: chatPhases.phases,
          }));
        }
        const normalizedText = normalizeActionBlockAliases(
          chatPhases.visibleText,
        );
        const displayText = splitPendingMockupCompletionText(normalizedText);
        deferredMockupCompletionText = displayText.completionText;
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantId
              ? {
                  ...m,
                  content: displayText.visibleText,
                  chatPhases: chatPhases.phases,
                }
              : m,
          ),
        );
      }

      const finalChatPhases = extractChatPhases(fullText).phases;
      fullText = normalizeActionBlockAliases(
        extractChatPhases(fullText).visibleText,
      );
      const activeIdeaAtTurnStart =
        ideas.find((idea) => idea.id === activeIdeaId) ?? null;
      const shouldForkStyleDirection =
        !commandForTurn &&
        shouldForkIdeaForStyleReference(
          text,
          activeIdeaAtTurnStart,
          selectedReferences.length,
        );

      // Convert web search citation domains (domain.com) to clickable markdown links
      fullText = fullText.replace(
        /\(([a-zA-Z0-9][a-zA-Z0-9-]*(?:\.[a-zA-Z0-9][a-zA-Z0-9-]*)+(?:\/[^\s)]*)?)\)/g,
        (match, domain) =>
          /\.[a-zA-Z]{2,}/.test(domain)
            ? `([${domain}](https://${domain}))`
            : match,
      );
      const finalDisplayText = splitPendingMockupCompletionText(fullText);
      deferredMockupCompletionText = finalDisplayText.completionText;
      setMessages((prev) =>
        prev.map((m) =>
          m.id === assistantId
            ? {
                ...m,
                content: finalDisplayText.visibleText,
                chatPhases: finalChatPhases,
              }
            : m,
        ),
      );
      void encodeMemoryDraft(
        assistantId,
        memoryInput,
        fullText,
        userMsg.createdAt ?? Date.now(),
        memorySources,
      );

      // Parse special blocks from completed response
      let createdNote: Idea | null = null;
      let turnIdeaOverride: Idea | null = null;
      const createNoteBlock = parseCreateNoteBlock(fullText);
      const parsedCreateNoteDescription =
        createNoteBlock?.description?.trim() ?? "";
      const createNotePayload = parsedCreateNoteDescription
        ? resolveDesignBriefPayload(
            parsedCreateNoteDescription,
            fullText,
            text,
            effectiveMissionBrief,
            { allowMissionRecovery: true },
          )
        : { description: "", source: "payload" as const };
      const createNoteDescription = createNotePayload.description;
      if (
        parsedCreateNoteDescription &&
        createNotePayload.source !== "payload"
      ) {
        console.warn(
          "[create_note] Thin or task-like Design Brief recovered before saving.",
          {
            originalLength: parsedCreateNoteDescription.length,
            recoveredLength: createNoteDescription.length,
            source: createNotePayload.source,
          },
        );
      }
      if (createNoteBlock && !createNoteDescription) {
        const blockStart = fullText.indexOf("[CREATE_NOTE:");
        console.warn(
          "[create_note] CREATE_NOTE block parsed but description was empty; skipping empty note creation.",
          {
            parsed: createNoteBlock,
            rawBlock:
              blockStart === -1
                ? null
                : fullText.slice(blockStart, blockStart + 800),
          },
        );
      }
      if (createNoteBlock && createNoteDescription) {
        const activeIdea = ideas.find((idea) => idea.id === activeIdeaId);
        const activeIdeaHasArtboards = artboards.some(
          (board) => board.ideaId === activeIdea?.id,
        );
        // The seeded default 시안 1 (or any idea still an empty shell) should be
        // filled by the first brief instead of appending a new 시안.
        const isEmptyIdeaShell = activeIdea
          ? !activeIdea.description.trim() &&
            !activeIdea.designStyle &&
            !activeIdeaHasArtboards
          : false;
        const shouldFillStyleShell =
          activeIdea &&
          activeIdea.designStyle &&
          !activeIdea.description.trim() &&
          commandForTurn?.id !== "create_idea";
        if (
          activeIdea &&
          ((shouldFillStyleShell && !shouldForkStyleDirection) ||
            isEmptyIdeaShell)
        ) {
          turnIdeaOverride = {
            ...activeIdea,
            description: createNoteDescription,
            updatedAt: Date.now(),
          };
          appendActivityLog({
            section: "note",
            action: "update",
            input: text,
            output: turnIdeaOverride.description,
            outputTitle: turnIdeaOverride.title,
          });
          setIdeas((prev) =>
            prev.map((idea) =>
              idea.id === turnIdeaOverride?.id ? turnIdeaOverride : idea,
            ),
          );
          setActiveIdeaId(turnIdeaOverride.id);
          setActiveIdeaTab("idea");
        } else {
          createdNote = {
            id: crypto.randomUUID(),
            title: nextDraftTitle(ideas),
            description: createNoteDescription,
            createdAt: Date.now(),
          };
          turnIdeaOverride = createdNote;
          appendActivityLog({
            section: "note",
            action: "create",
            input: text,
            output: createdNote.description,
            outputTitle: createdNote.title,
          });
          setIdeas((prev) => [...prev, createdNote as Idea]);
          setActiveIdeaId(createdNote.id);
          setActiveArtboardId(null);
          setIsIdeaExpanded(false);
          setActiveIdeaTab("idea");
        }
      }

      const updateNoteBlock = parseUpdateNoteBlock(fullText);
      if (updateNoteBlock) {
        const parsedUpdateNoteDescription =
          updateNoteBlock.description?.trim() ?? "";
        const targetNoteId = createdNote?.id ?? activeIdeaId;
        const updateNotePayload = parsedUpdateNoteDescription
          ? resolveDesignBriefPayload(
              parsedUpdateNoteDescription,
              fullText,
              text,
              effectiveMissionBrief,
              {
                allowMissionRecovery: shouldRecoverThinUpdateNote(
                  text,
                  commandForTurn?.id,
                  activeIdeaAtTurnStart,
                ),
              },
            )
          : { description: "", source: "payload" as const };
        const updateNoteDescription = updateNotePayload.description;
        if (
          parsedUpdateNoteDescription &&
          updateNotePayload.source !== "payload"
        ) {
          console.warn(
            "[update_note] Thin or task-like Design Brief recovered before saving.",
            {
              originalLength: parsedUpdateNoteDescription.length,
              recoveredLength: updateNoteDescription.length,
              source: updateNotePayload.source,
            },
          );
        }
        if (!updateNoteDescription) {
          const blockStart = fullText.indexOf("[UPDATE_NOTE:");
          console.warn(
            "[update_note] UPDATE_NOTE block parsed but description was empty; leaving note unchanged.",
            {
              parsed: updateNoteBlock,
              rawBlock:
                blockStart === -1
                  ? null
                  : fullText.slice(blockStart, blockStart + 800),
            },
          );
        } else if (!targetNoteId) {
          // Model emitted UPDATE_NOTE but there is no active note to update
          // (e.g. user asked for a new 시안). Materialize it as a new note
          // instead of silently dropping the content.
          console.warn(
            "[update_note] UPDATE_NOTE with no active note; creating a new note from the content instead.",
          );
          const recoveredNote: Idea = {
            id: crypto.randomUUID(),
            title: updateNoteBlock.title?.trim() || nextDraftTitle(ideas),
            description: updateNoteDescription,
            createdAt: Date.now(),
          };
          turnIdeaOverride = turnIdeaOverride ?? recoveredNote;
          appendActivityLog({
            section: "note",
            action: "create",
            input: text,
            output: updateNoteDescription,
            outputTitle: recoveredNote.title,
          });
          setIdeas((prev) => [...prev, recoveredNote]);
          setActiveIdeaId(recoveredNote.id);
          setActiveArtboardId(null);
          setIsIdeaExpanded(false);
          setActiveIdeaTab("idea");
        } else {
          setIdeas((prev) =>
            prev.map((idea) =>
              idea.id === targetNoteId
                ? {
                    ...idea,
                    description: updateNoteDescription,
                    updatedAt: Date.now(),
                  }
                : idea,
            ),
          );
          appendActivityLog({
            section: "note",
            action: "update",
            input: text,
            output: updateNoteDescription,
            outputTitle:
              (createdNote ?? ideas.find((idea) => idea.id === targetNoteId))
                ?.title ?? "",
          });
        }
      }

      const designSpecBlock = parseCreateDesignSpecBlock(fullText);
      if (
        fullText.includes("[CREATE_DESIGN_SPEC:") &&
        !designSpecBlock?.content?.trim()
      ) {
        setMessages((prev) =>
          prev.map((message) =>
            message.id === assistantId &&
            !message.content.includes("디자인 스타일을 저장하지 못했습니다.")
              ? {
                  ...message,
                  content: `${message.content}\n\n⚠️ 디자인 스타일을 저장하지 못했습니다. 다시 요청해 주세요.`,
                }
              : message,
          ),
        );
      }
      if (
        shouldForkStyleDirection &&
        !turnIdeaOverride &&
        activeIdeaAtTurnStart
      ) {
        const forkedIdea: Idea = {
          id: crypto.randomUUID(),
          title: nextDraftTitle(ideas),
          description: productBriefForStyleFork(activeIdeaAtTurnStart.description),
          createdAt: Date.now(),
        };
        turnIdeaOverride = forkedIdea;
        appendActivityLog({
          section: "note",
          action: "create",
          input: text,
          output: forkedIdea.description,
          outputTitle: forkedIdea.title,
        });
        setIdeas((prev) => [...prev, forkedIdea]);
        setActiveIdeaId(forkedIdea.id);
        setActiveArtboardId(null);
        setIsIdeaExpanded(false);
        setActiveIdeaTab("idea");
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantId &&
            !m.content.includes("새 시안으로 분리")
              ? {
                  ...m,
                  content: [
                    m.content.trimEnd(),
                    "기존 디자인 스타일은 유지하고, 새 레퍼런스 방향은 새 시안으로 분리해 진행합니다.",
                  ]
                    .filter(Boolean)
                    .join("\n\n"),
                }
              : m,
          ),
        );
      }
      if (designSpecBlock?.content) {
        let targetIdeaId = turnIdeaOverride?.id ?? activeIdeaId;
        let targetIdea =
          turnIdeaOverride ??
          ideas.find((idea) => idea.id === targetIdeaId) ??
          null;
        let autoCreatedStyleIdea: Idea | null = null;
        if (!targetIdeaId) {
          targetIdea = {
            id: crypto.randomUUID(),
            title: nextDraftTitle(ideas),
            description: "",
            createdAt: Date.now(),
          };
          autoCreatedStyleIdea = targetIdea;
          targetIdeaId = targetIdea.id;
          appendActivityLog({
            section: "note",
            action: "create",
            input: text,
            output: "",
            outputTitle: targetIdea.title,
          });
          setActiveIdeaId(targetIdea.id);
          setActiveArtboardId(null);
          setIsIdeaExpanded(false);
          setActiveIdeaTab("style");
        }
        const designSpecContent =
          shouldForkStyleDirection &&
          isSameDesignStyle(
            designSpecBlock.content,
            activeIdeaAtTurnStart?.designStyle?.content,
          )
            ? fallbackDesignStyleFromStyleReference(
                selectedReferences,
                styleSourceUrlForTurn,
                Boolean(styleImageForTurn),
              )
            : designSpecBlock.content;
        const newSpec: DesignStyle = {
          id: targetIdea?.designStyle?.id ?? crypto.randomUUID(),
          title: "디자인 스타일",
          content: designSpecContent,
          createdAt: targetIdea?.designStyle?.createdAt ?? Date.now(),
        };
        if (targetIdeaId) {
          setIdeas((prev) =>
            [
              ...prev,
              ...(autoCreatedStyleIdea ? [autoCreatedStyleIdea] : []),
            ].map((idea) =>
              idea.id === targetIdeaId
                ? {
                    ...idea,
                    designStyle: newSpec,
                  }
                : idea,
            ),
          );
          turnIdeaOverride = {
            ...(targetIdea as Idea),
            designStyle: newSpec,
          };
        }
        setIsDesignSpecOpen(true);
      }
      if (
        shouldForkStyleDirection &&
        turnIdeaOverride &&
        !turnIdeaOverride.designStyle?.content?.trim() &&
        !designSpecBlock?.content
      ) {
        const fallbackSpec: DesignStyle = {
          id: crypto.randomUUID(),
          title: "디자인 스타일",
          content: fallbackDesignStyleFromStyleReference(
            selectedReferences,
            styleSourceUrlForTurn,
            Boolean(styleImageForTurn),
          ),
          createdAt: Date.now(),
        };
        turnIdeaOverride = {
          ...turnIdeaOverride,
          designStyle: fallbackSpec,
        };
        setIdeas((prev) =>
          prev.map((idea) =>
            idea.id === turnIdeaOverride?.id
              ? { ...idea, designStyle: fallbackSpec }
              : idea,
          ),
        );
        setIsDesignSpecOpen(true);
      }

      const fetchRefMatch = fullText.match(
        /\[FETCH_REFERENCES(?::\s*(.*?))?\]/i,
      );
      const appendReferenceResult = (result: ReferenceFetchResult) => {
        const summary = buildReferenceReasonSummary(result.references);
        const statusMessage = result.message?.trim();
        if (!summary && !statusMessage) return;
        setMessages((prev) =>
          prev.map((chatMessage) =>
            chatMessage.id === assistantId &&
            !chatMessage.content.includes("### 레퍼런스 선택 이유") &&
            !chatMessage.content.includes("### 레퍼런스 검색 결과")
              ? {
                  ...chatMessage,
                  content: [
                    chatMessage.content.trimEnd(),
                    summary,
                    statusMessage
                      ? `\n### 레퍼런스 검색 결과\n${statusMessage}`
                      : "",
                  ]
                    .filter(Boolean)
                    .join("\n")
                    .trim(),
                }
              : chatMessage,
          ),
        );
        if (!result.references.length) return;
        void encodeMemoryDraft(
          assistantId,
          memoryInput,
          [
            fullText,
            "reference search context:",
            formatReferenceMemoryDetails(result.references),
          ]
            .filter(Boolean)
            .join("\n\n"),
          userMsg.createdAt ?? Date.now(),
          {
            ...memorySources,
            links: [
              ...(memorySources.links ?? []),
              ...result.references.map(memorySourceLinkFromReference),
            ],
          },
        );
      };
      if (fetchRefMatch) {
        const corrective = isCorrectiveReferenceTurn(text);
        const customQuery = buildReferenceSearchQuery(
          fetchRefMatch[1]?.trim() || text,
          effectiveMissionTitle,
          activeOption,
          device,
          corrective,
        );
        setReferenceLoadingMessageId(assistantId);
        void fetchReferences(
          effectiveMissionTitle ?? "",
          effectiveMissionBrief ?? "",
          customQuery,
          parseRequestedReferenceCount(text),
          text,
        )
          .then((result) => appendReferenceResult(result))
          .finally(() =>
            setReferenceLoadingMessageId((current) =>
              current === assistantId ? null : current,
            ),
          );
      } else if (isReferenceSearchRequest(text)) {
        const corrective = isCorrectiveReferenceTurn(text);
        const fallbackReferenceQuery = buildReferenceSearchQuery(
          text,
          effectiveMissionTitle,
          activeOption,
          device,
          corrective,
        );
        setReferenceLoadingMessageId(assistantId);
        void fetchReferences(
          effectiveMissionTitle ?? "",
          effectiveMissionBrief ?? "",
          fallbackReferenceQuery || text,
          parseRequestedReferenceCount(text),
          text,
        )
          .then((result) => appendReferenceResult(result))
          .finally(() =>
            setReferenceLoadingMessageId((current) =>
              current === assistantId ? null : current,
            ),
          );
      }

      const generateMatch = fullText.match(
        /\[GENERATE_MOCKUP(?::\s*([\s\S]*?))?\]/,
      );
      const editMatch = !generateMatch
        ? fullText.match(/\[EDIT_MOCKUP(?::\s*([\s\S]*?))?\]/)
        : null;
      const shouldAutoGenerateForkedStyleMockup =
        shouldForkStyleDirection &&
        !generateMatch &&
        !editMatch &&
        isExplicitNewMockupRequest(text);

      if (shouldAutoGenerateForkedStyleMockup) {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantId
              ? {
                  ...m,
                  content: [
                    stripDesignSpecActionBlocks(m.content),
                    `[GENERATE_MOCKUP: ${FORKED_STYLE_MOCKUP_PROMPT}]`,
                  ]
                    .filter(Boolean)
                    .join("\n\n"),
                }
              : m,
          ),
        );
      } else if (shouldForkStyleDirection && !designSpecBlock?.content) {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantId
              ? {
                  ...m,
                  content: stripDesignSpecActionBlocks(m.content),
                }
              : m,
          ),
        );
      }

      const shouldSuppressMockupAction =
        (generateMatch || editMatch || shouldAutoGenerateForkedStyleMockup) &&
        isMockupReadinessQuestion(text);
      if (shouldSuppressMockupAction) {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantId
              ? {
                  ...m,
                  content: [
                    stripMockupActionBlocks(m.content),
                    "목업은 아직 생성하지 않았습니다. 원하시면 `목업 만들어줘`처럼 명확히 요청해 주세요.",
                  ]
                    .filter(Boolean)
                    .join("\n\n"),
                }
              : m,
          ),
        );
      } else if (generateMatch || editMatch || shouldAutoGenerateForkedStyleMockup) {
        const effectiveIdeas = turnIdeaOverride
          ? ideas.some((idea) => idea.id === turnIdeaOverride?.id)
            ? ideas.map((idea) =>
                idea.id === turnIdeaOverride?.id ? turnIdeaOverride : idea,
              )
            : [...ideas, turnIdeaOverride]
          : ideas;
        const effectiveActiveIdeaId = turnIdeaOverride?.id ?? activeIdeaId;
        const activeIdea =
          turnIdeaOverride ??
          ideas.find((i) => i.id === effectiveActiveIdeaId) ??
          null;
        const parsedPrompt = normalizeMockupActionPrompt(
            (generateMatch ?? editMatch)?.[1] ??
            (shouldAutoGenerateForkedStyleMockup
              ? FORKED_STYLE_MOCKUP_PROMPT
              : ""),
        );
        const prompt =
          parsedPrompt ||
          (generateMatch
            ? defaultMockupPromptForIdea(activeIdea, device)
            : CURRENT_MOCKUP_REFINEMENT_PROMPT);
        const mockupIdeaId = effectiveActiveIdeaId;
        const isNew = Boolean(generateMatch || shouldAutoGenerateForkedStyleMockup);
        let stitchPrompt = buildMockupPrompt(
          prompt,
          activeIdea,
          // Only inject mission brief for new mockups — edits don't need the full product context
          isNew ? missionBrief : undefined,
        );
        if (!isNew && selectedElement) {
          stitchPrompt = [
            stitchPrompt,
            selectedElementTargetPrompt(selectedElement),
          ].join("\n\n");
        }
        appendActivityLog({
          section: "mockup",
          action: "stitch_prompt",
          input: text,
          output: stitchPrompt,
          outputTitle: isNew ? "새 목업 생성 프롬프트" : "목업 수정 프롬프트",
          stitchPrompt,
        });

        if (isNew && effectiveIdeas.length === 0) {
          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantId
                ? {
                    ...m,
                    content:
                      m.content +
                      "\n\n⚠️ Design Brief를 먼저 저장해야 목업을 생성할 수 있습니다. Design Brief를 정리한 후 다시 시도해 주세요.",
                  }
                : m,
            ),
          );
          return;
        }

        if (
          isNew &&
          !activeIdea?.designStyle?.content?.trim() &&
          !styleImageForTurn &&
          !styleSourceUrlForTurn
        ) {
          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantId
                ? {
                    ...m,
                    content:
                      m.content +
                      "\n\n⚠️ 디자인 스타일이 없어 목업을 생성할 수 없습니다. 디자인 스타일을 먼저 만든 후 다시 시도해 주세요.",
                  }
                : m,
            ),
          );
          return;
        }

        setIsGeneratingMockup(true);
        setMockupOperation(isNew ? "generate" : "edit");
        setGeneratingMockupIdeaId(mockupIdeaId);
        setActiveIdeaTab("mockup");
        setMockupProgress({
          percent: 8,
          label: "새 아트보드 자리 잡는 중",
        });
        {
          const ideaBoards = artboards.filter(
            (a) => a.ideaId === (effectiveActiveIdeaId ?? ""),
          );
          const last = ideaBoards[ideaBoards.length - 1];
          setPendingArtboardSkeleton({
            ideaId: effectiveActiveIdeaId ?? "",
            label: `Design ${ideaBoards.length + 1}`,
            x: last
              ? last.x +
                DEVICE_SIZE[last.device ?? "desktop"].width +
                ARTBOARD_GAP
              : 0,
            y: 0,
            device,
          });
        }
        try {
          const stitchController = new AbortController();
          stitchAbortControllerRef.current = stitchController;
          stitchCancelRequestedRef.current = false;
          const progressStartedAt = Date.now();
          const progressTimer = window.setInterval(() => {
            const elapsed = Date.now() - progressStartedAt;
            const estimated = Math.min(
              88,
              18 + Math.floor((elapsed / 170_000) * 70),
            );
            setMockupProgress((prev) =>
              prev
                ? {
                    percent: Math.max(prev.percent, estimated),
                    label:
                      elapsed > 70_000
                        ? "Stitch가 화면을 다듬는 중"
                        : elapsed > 30_000
                          ? "레이아웃과 비주얼 생성 중"
                          : "Stitch에 요청 전달 중",
                  }
                : prev,
            );
          }, 1000);
          const editTargetBoard = !isNew
            ? (activeArtboardId
                ? artboards.find((a) => a.id === activeArtboardId)
                : currentIdeaBoards.at(-1)) ?? null
            : null;
          const editTargetId = editTargetBoard?.id;
          const editScreenId = editTargetBoard?.stitchScreenId || undefined;
          let res: Response;
          try {
            res = await fetch("/api/stitch", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              signal: stitchController.signal,
              body: JSON.stringify({
                prompt: stitchPrompt,
                device,
                projectId: stitchProjectId || undefined,
                screenId: editScreenId,
                previousHtmlHash:
                  !isNew && editTargetBoard?.html
                    ? quickHash(editTargetBoard.html)
                    : undefined,
                designStyle: activeDesignStyle(activeIdea)
                  ? { content: activeDesignStyle(activeIdea)?.content }
                  : null,
                designSystemId: stitchDesignSystemId,
                appliedDesignStyleHash,
                styleImage:
                  isNew && styleImageForTurn
                    ? { dataUrl: styleImageForTurn }
                    : undefined,
                styleSourceUrl:
                  isNew && styleSourceUrlForTurn
                    ? styleSourceUrlForTurn
                    : undefined,
                // Mission-supplied content images embed as-is on a new mockup,
                // unless the user attached a style image/URL this turn (that
                // drives the whole look and takes precedence server-side).
                assetImages:
                  isNew &&
                  !styleImageForTurn &&
                  !styleSourceUrlForTurn &&
                  activeOption?.assetImages?.length
                    ? activeOption.assetImages.map((image) => ({
                        url: image.url,
                        note: image.note,
                      }))
                    : undefined,
              }),
            });
          } finally {
            window.clearInterval(progressTimer);
            if (stitchAbortControllerRef.current === stitchController) {
              stitchAbortControllerRef.current = null;
            }
          }
          if (!res.ok) {
            const errText = await stitchResponseError(res);
            throw new Error(errText);
          }
          setMockupProgress({ percent: 92, label: "응답 처리 중" });
          const data = await res.json();
          if (data.error) throw new Error(data.error);
          if (
            (typeof data.html !== "string" || !data.html.trim()) &&
            !data.htmlPending
          ) {
            throw new Error("Stitch가 표시할 수 있는 화면 HTML을 반환하지 않았습니다.");
          }
          setMockupProgress({ percent: 96, label: "아트보드 배치 중" });
          if (data.projectId) setStitchProjectId(data.projectId);
          if (data.designSystemId !== undefined)
            setStitchDesignSystemId(data.designSystemId);
          if (data.appliedDesignStyleHash !== undefined)
            setAppliedDesignStyleHash(data.appliedDesignStyleHash);
          // Image-led generation derives a design style from the reconstructed
          // result — persist it on the idea so it shows and stays reusable.
          if (data.derivedDesignStyle?.content && mockupIdeaId) {
            setIdeas((prev) =>
              prev.map((idea) =>
                idea.id === mockupIdeaId
                  ? {
                      ...idea,
                      designStyle: {
                        id: idea.designStyle?.id ?? crypto.randomUUID(),
                        title: "디자인 스타일",
                        content: data.derivedDesignStyle.content,
                        createdAt: idea.designStyle?.createdAt ?? Date.now(),
                      },
                    }
                  : idea,
              ),
            );
            // The attached image only reaches memory as a content description
            // (the image normalizer deliberately avoids preference inference).
            // The actual visual preference lives in the style derived from the
            // generated result, which arrives after the turn's memory draft.
            // Record it as a separate, session-scoped style-preference signal.
            if (isNew && styleImageForTurn) {
              void encodeMemoryDraft(
                `style-image-preference-${assistantId}`,
                [
                  "사용자가 이번 턴에 스타일 참고 이미지를 첨부했고, 생성 결과에서 아래 디자인 스타일이 확인됨.",
                  "이번 미션/시안 맥락의 시각 선호 evidence로 기록하고, 단일 첨부를 사용자 전역 취향으로 단정하지 말 것.",
                  `사용자 요청: ${text}`,
                ].join("\n"),
                `첨부 이미지 기반으로 도출된 디자인 스타일:\n${String(
                  data.derivedDesignStyle.content,
                ).slice(0, 4000)}`,
                userMsg.createdAt ?? Date.now(),
              );
            }
          }
          if (isNew) {
            const primaryId = crypto.randomUUID();
            // Collect extra screens Stitch created (excluding the primary one)
            const extraScreenIds: string[] = (data.allScreenIds ?? []).filter(
              (sid: string) => sid !== data.screenId,
            );

            setArtboards((prev) => {
              const existingScreenIds = new Set(
                prev.map((a) => a.stitchScreenId).filter(Boolean),
              );
              const newExtra = extraScreenIds.filter(
                (sid: string) => !existingScreenIds.has(sid),
              );
              const ideaId = effectiveActiveIdeaId ?? "";
              const ideaBoards = prev.filter((a) => a.ideaId === ideaId);
              const last = ideaBoards[ideaBoards.length - 1];
              let offsetX = last
                ? last.x +
                  DEVICE_SIZE[last.device ?? "desktop"].width +
                  ARTBOARD_GAP
                : 0;
              const primaryBoard: Artboard = {
                id: primaryId,
                html: typeof data.html === "string" ? data.html : "",
                label: `Design ${ideaBoards.length + 1}`,
                createdAt: Date.now(),
                x: offsetX,
                y: 0,
                device,
                stitchScreenId: data.screenId,
                ideaId,
                htmlStatus: data.htmlPending ? "pending" : undefined,
              };
              offsetX += DEVICE_SIZE[device].width + ARTBOARD_GAP;

              const extraBoards: Artboard[] = newExtra.map(
                (sid: string, i: number) => ({
                  id: crypto.randomUUID(),
                  html: "",
                  label: `Design ${ideaBoards.length + 2 + i}`,
                  createdAt: Date.now(),
                  x: offsetX + i * (DEVICE_SIZE[device].width + ARTBOARD_GAP),
                  y: 0,
                  device,
                  stitchScreenId: sid,
                  ideaId,
                  htmlStatus: "pending",
                }),
              );

              return [...prev, primaryBoard, ...extraBoards];
            });
            setActiveArtboardId(primaryId);
            setTimeout(
              () => fitToCanvasForIdea(effectiveActiveIdeaId ?? ""),
              0,
            );

            const screensNeedingHtml = [
              ...(data.htmlPending ? [data.screenId] : []),
              ...extraScreenIds,
            ];
            // Lazy-load HTML for pending or extra screens
            screensNeedingHtml.forEach((sid: string) => {
              setMockupProgress({
                percent: 98,
                label:
                  sid === data.screenId
                    ? "화면 HTML 준비 대기 중"
                    : "추가 화면 불러오는 중",
              });
              fetchStitchScreenHtml(data.projectId, sid)
                .then((html) =>
                  setArtboards((prev) =>
                    prev.map((a) =>
                      a.stitchScreenId === sid
                        ? {
                            ...a,
                            html,
                            htmlStatus: undefined,
                            htmlUpdatedAt: Date.now(),
                          }
                        : a,
                    ),
                  ),
                )
                .catch(() =>
                  setArtboards((prev) =>
                    prev.map((a) =>
                      a.stitchScreenId === sid
                        ? { ...a, htmlStatus: "failed" }
                        : a,
                    ),
                  ),
                );
            });
          } else {
            const targetId =
              editTargetId ?? activeArtboardId ?? currentIdeaBoards.at(-1)?.id;
            const editCreatedNewScreen =
              Boolean(data.screenId) &&
              Boolean(editScreenId) &&
              data.screenId !== editScreenId;
            const existingEditBoard = editCreatedNewScreen
              ? artboards.find((a) => a.stitchScreenId === data.screenId)
              : null;
            const createdEditBoardId =
              editCreatedNewScreen && !existingEditBoard
                ? crypto.randomUUID()
                : null;
            const sameScreenEditBoard =
              !editCreatedNewScreen
                ? artboards.find(
                    (a) =>
                      a.id === targetId ||
                      a.stitchScreenId === data.screenId ||
                      (editScreenId && a.stitchScreenId === editScreenId),
                  ) ?? null
                : null;
            const sameScreenFallbackBoardId =
              !editCreatedNewScreen && !sameScreenEditBoard
                ? crypto.randomUUID()
                : null;
            const resultIdeaId =
              existingEditBoard?.ideaId ??
              sameScreenEditBoard?.ideaId ??
              effectiveActiveIdeaId ??
              editTargetBoard?.ideaId ??
              "";
            console.info("[mockup] edit response target resolution", {
              responseScreenId: data.screenId ?? null,
              editScreenId: editScreenId ?? null,
              targetId: targetId ?? null,
              editCreatedNewScreen,
              existingEditBoardId: existingEditBoard?.id ?? null,
              sameScreenEditBoardId: sameScreenEditBoard?.id ?? null,
              sameScreenFallbackBoardId,
              resultIdeaId,
              htmlLength:
                typeof data.html === "string" ? data.html.length : 0,
              htmlPending: Boolean(data.htmlPending),
            });

            setArtboards((prev) => {
              if (!editCreatedNewScreen) {
                const matchIndex = prev.findIndex(
                  (a) =>
                    a.id === targetId ||
                    a.stitchScreenId === data.screenId ||
                    (editScreenId && a.stitchScreenId === editScreenId),
                );
                if (matchIndex >= 0) {
                  const matched = prev[matchIndex];
                  const nextHtml =
                    typeof data.html === "string" && data.html
                      ? data.html
                      : matched?.html ?? "";
                  const previousHtml = matched?.html ?? "";
                  console.info("[mockup] applying edit HTML to existing artboard", {
                    artboardId: matched?.id ?? null,
                    previousScreenId: matched?.stitchScreenId ?? null,
                    nextScreenId: data.screenId ?? null,
                    ideaId: matched?.ideaId ?? null,
                    previousHtmlLength: previousHtml.length,
                    nextHtmlLength: nextHtml.length,
                    htmlChanged: previousHtml !== nextHtml,
                    previousHtmlHash: quickHash(previousHtml),
                    nextHtmlHash: quickHash(nextHtml),
                    htmlPending: Boolean(data.htmlPending),
                  });
                  if (previousHtml === nextHtml && nextHtml) {
                    console.warn("[mockup] edit response HTML is identical to current artboard HTML", {
                      artboardId: matched?.id ?? null,
                      screenId: data.screenId ?? null,
                      htmlHash: quickHash(nextHtml),
                    });
                  }
                  return prev.map((a, index) =>
                    index === matchIndex
                      ? {
                          ...a,
                          html: nextHtml || a.html,
                          stitchScreenId: data.screenId,
                          htmlStatus: data.htmlPending ? "pending" : undefined,
                          htmlUpdatedAt: data.html ? Date.now() : a.htmlUpdatedAt,
                        }
                      : a,
                  );
                }

                const ideaId =
                  effectiveActiveIdeaId ?? editTargetBoard?.ideaId ?? "";
                const ideaBoards = prev.filter((a) => a.ideaId === ideaId);
                const targetBoard =
                  editTargetBoard ?? ideaBoards.at(-1) ?? null;
                const x = targetBoard
                  ? targetBoard.x +
                    DEVICE_SIZE[targetBoard.device ?? "desktop"].width +
                    ARTBOARD_GAP
                  : 0;
                console.info("[mockup] edit result had no matching artboard; creating fallback", {
                  artboardId: sameScreenFallbackBoardId,
                  screenId: data.screenId ?? null,
                  ideaId,
                  htmlLength:
                    typeof data.html === "string" ? data.html.length : 0,
                  htmlPending: Boolean(data.htmlPending),
                });
                return [
                  ...prev,
                  {
                    id: sameScreenFallbackBoardId ?? crypto.randomUUID(),
                    html: data.html || editTargetBoard?.html || "",
                    label: `Design ${ideaBoards.length + 1}`,
                    createdAt: Date.now(),
                    x,
                    y: targetBoard?.y ?? 0,
                    device: targetBoard?.device ?? device,
                    stitchScreenId: data.screenId,
                    ideaId,
                    htmlStatus: data.htmlPending ? "pending" : undefined,
                    htmlUpdatedAt: data.html ? Date.now() : undefined,
                  },
                ];
              }

              if (existingEditBoard) {
                console.info("[mockup] applying edit HTML to existing new-screen artboard", {
                  artboardId: existingEditBoard.id,
                  screenId: data.screenId ?? null,
                  ideaId: existingEditBoard.ideaId,
                  htmlLength:
                    typeof data.html === "string" ? data.html.length : 0,
                  htmlPending: Boolean(data.htmlPending),
                });
                return prev.map((a) =>
                  a.id === existingEditBoard.id
                    ? {
                        ...a,
                        html: data.html || a.html,
                        htmlUpdatedAt: data.html ? Date.now() : a.htmlUpdatedAt,
                      }
                    : a,
                );
              }

              const ideaId = effectiveActiveIdeaId ?? editTargetBoard?.ideaId ?? "";
              const ideaBoards = prev.filter((a) => a.ideaId === ideaId);
              const targetBoard =
                prev.find((a) => a.id === targetId) ??
                editTargetBoard ??
                ideaBoards.at(-1);
              const x = targetBoard
                ? targetBoard.x +
                  DEVICE_SIZE[targetBoard.device ?? "desktop"].width +
                  ARTBOARD_GAP
                : 0;
              const board: Artboard = {
                id: createdEditBoardId ?? crypto.randomUUID(),
                html: data.html || editTargetBoard?.html || "",
                label: `Design ${ideaBoards.length + 1}`,
                createdAt: Date.now(),
                x,
                y: targetBoard?.y ?? 0,
                device: targetBoard?.device ?? device,
                stitchScreenId: data.screenId,
                ideaId,
                htmlStatus: data.htmlPending ? "pending" : undefined,
                htmlUpdatedAt: data.html ? Date.now() : undefined,
              };
              console.info("[mockup] creating artboard for new edit screen", {
                artboardId: board.id,
                screenId: data.screenId ?? null,
                ideaId,
                htmlLength:
                  typeof data.html === "string" ? data.html.length : 0,
                htmlPending: Boolean(data.htmlPending),
              });
              return [...prev, board];
            });

            const htmlTargetId =
              existingEditBoard?.id ??
              createdEditBoardId ??
              sameScreenEditBoard?.id ??
              sameScreenFallbackBoardId ??
              targetId;
            if (htmlTargetId) {
              console.info("[mockup] activating edit result artboard", {
                htmlTargetId,
                resultIdeaId,
              });
              setActiveArtboardId(htmlTargetId);
            }
            if (resultIdeaId) {
              setActiveIdeaId(resultIdeaId);
              setTimeout(() => {
                fitToCanvasForIdea(resultIdeaId);
                const board = artboardsRef.current.find(
                  (item) => item.id === htmlTargetId,
                );
                console.info("[mockup] post-apply active board snapshot", {
                  htmlTargetId,
                  resultIdeaId,
                  activeIdeaId: activeIdeaIdRef.current,
                  boardExists: Boolean(board),
                  boardIdeaId: board?.ideaId ?? null,
                  boardScreenId: board?.stitchScreenId ?? null,
                  boardHtmlLength: board?.html?.length ?? 0,
                  boardHtmlHash: quickHash(board?.html ?? ""),
                  boardHtmlStatus: board?.htmlStatus ?? null,
                });
              }, 0);
            }
            if (data.htmlPending && htmlTargetId) {
              console.info("[mockup] polling pending edit HTML", {
                projectId: data.projectId ?? null,
                screenId: data.screenId ?? null,
                htmlTargetId,
              });
              fetchStitchScreenHtml(data.projectId, data.screenId)
                .then((html) =>
                  setArtboards((prev) => {
                    console.info("[mockup] pending edit HTML resolved", {
                      htmlTargetId,
                      screenId: data.screenId ?? null,
                      htmlLength: html.length,
                    });
                    return prev.map((a) =>
                      a.id === htmlTargetId
                        ? {
                            ...a,
                            html,
                            htmlStatus: undefined,
                            htmlUpdatedAt: Date.now(),
                          }
                        : a,
                    );
                  }),
                )
                .catch((err) =>
                  setArtboards((prev) => {
                    console.warn("[mockup] pending edit HTML failed", {
                      htmlTargetId,
                      screenId: data.screenId ?? null,
                      error: err instanceof Error ? err.message : String(err),
                    });
                    return prev.map((a) =>
                      a.id === htmlTargetId
                        ? { ...a, htmlStatus: "failed" }
                        : a,
                    );
                  }),
                );
            }
          }
          setMockupProgress({ percent: 100, label: "완료" });
          setActiveIdeaTab("mockup");
          setSelectedElement(null);
          if (deferredMockupCompletionText) {
            setMessages((prev) =>
              prev.map((m) =>
                m.id === assistantId
                  ? {
                      ...m,
                      content: `${m.content}\n\n${deferredMockupCompletionText}`,
                    }
                  : m,
              ),
            );
          }
        } catch (err) {
          const wasCanceled = stitchCancelRequestedRef.current;
          const errMsg = stitchGenerationErrorMessage(err, wasCanceled);
          const failureLabel =
            mockupOperation === "edit" ? "목업 수정 실패" : "목업 생성 실패";
          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantId
                ? wasCanceled
                  ? {
                      ...m,
                      content: `${m.content}\n\n${errMsg}`,
                    }
                  : { ...m, error: `${failureLabel}: ${errMsg}` }
                : m,
            ),
          );
          if (!wasCanceled) {
            toast.error(`${failureLabel}: ${errMsg}`);
          }
        } finally {
          stitchAbortControllerRef.current = null;
          stitchCancelRequestedRef.current = false;
          setIsGeneratingMockup(false);
          setMockupOperation(null);
          setGeneratingMockupIdeaId(null);
          setPendingArtboardSkeleton(null);
          setMockupProgress(null);
        }
      }

    } catch (err) {
      const isTimeout =
        (err as Error)?.message === "timeout" ||
        (err instanceof DOMException && err.name === "AbortError");
      const requestErrorMessage =
        err instanceof Error && err.message
          ? err.message
          : "요청을 처리하지 못했습니다. 다시 시도해주세요.";
      setMessages((prev) =>
        prev.map((m) =>
          m.id === assistantId
            ? isTimeout
              ? {
                  ...m,
                  content: "응답 시간이 초과되었습니다. 다시 시도해주세요.",
                }
              : { ...m, error: requestErrorMessage }
            : m,
        ),
      );
      if (!isTimeout) {
        toast.error(requestErrorMessage);
      }
    } finally {
      clearTimeout(timeoutId);
      abortControllerRef.current = null;
      setChatPhasesByMessageId((prev) => {
        const next = { ...prev };
        delete next[assistantId];
        return next;
      });
      setIsLoading(false);
    }
  }, [
    inputText,
    composerCommand,
    composerMention,
    isLoading,
    isMissionContextReady,
    isGeneratingMockup,
    messages,
    artboards,
    activeArtboardId,
    activeIdeaId,
    selectedElement,
    selectedReferences,
    citedTexts,
    attachedStyleImage,
    ideas,
    references,
    device,
    stitchProjectId,
    missionTitle,
    missionBrief,
    userId,
    isReadOnly,
    isOnboardingMission,
    missionId,
    fitToCanvasForIdea,
    activeOption,
    parentMissionTitle,
    parentMissionBrief,
    appendActivityLog,
    encodeMemoryDraft,
    clearIframeSelections,
  ]);

  const fetchReferences = useCallback(
    async (
      title: string,
      brief: string,
      customQuery?: string | null,
      requestedCount?: number | null,
      userRequestText?: string | null,
    ): Promise<ReferenceFetchResult> => {
      if (isFetchingRefs || isReadOnly) return { references: [] };
      setIsFetchingRefs(true);
      setReferenceSearchError("");
      try {
        const loggedReferenceLinks = activityLog
          .filter((event) => event.section === "reference" && event.link)
          .map((event) => ({
            url: event.link,
            imageUrl: event.imageUrl,
          }));
        const res = await fetch("/api/references", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            missionTitle: title,
            missionBrief: brief,
            customQuery,
            userRequest: userRequestText ?? undefined,
            requestedCount: requestedCount ?? undefined,
            existingReferences: [...references, ...loggedReferenceLinks],
            referencePreferenceContext: missionId
              ? buildReferencePreferenceContext(
                  missionId,
                  references,
                  activityLog,
                  messages,
                  userRequestText ?? customQuery ?? undefined,
                )
              : null,
          }),
        });
        const data = await res.json();
        if (!res.ok) {
          throw new Error(data?.error ?? "레퍼런스 검색에 실패했습니다.");
        }
        if (data.references?.length > 0) {
          const newRefs = (data.references as Reference[]).filter(
            (candidate) =>
              !references.some((reference) =>
                referenceMatches(reference, candidate),
              ) &&
              !loggedReferenceLinks.some((reference) =>
                referenceMatches(reference as Reference, candidate),
              ),
          );
          newRefs.forEach((reference: Reference) => {
            appendActivityLog({
              section: "reference",
              action: "add",
              input: customQuery ?? title ?? brief,
              output: reference.description,
              outputTitle: reference.title,
              link: reference.url,
              imageUrl: reference.imageUrl,
            });
          });
          if (newRefs.length === 0) {
            return {
              references: [],
              message:
                "새로 추가할 레퍼런스를 찾지 못했습니다. 이미 추가했거나 삭제한 사이트는 제외됩니다.",
            };
          } else {
            setReferences((prev) => [...prev, ...newRefs]);
            return { references: newRefs };
          }
        } else {
          return {
            references: [],
            message:
              "조건에 맞는 레퍼런스를 찾지 못했습니다. 검색어를 조금 더 구체적으로 바꿔보세요.",
          };
        }
      } catch (error) {
        console.error("[references] fetch failed", error);
        return {
          references: [],
          message: "레퍼런스 검색에 실패했습니다.",
        };
      } finally {
        setIsFetchingRefs(false);
      }
      return { references: [] };
    },
    [
      activityLog,
      isFetchingRefs,
      isReadOnly,
      missionId,
      messages,
      references,
      appendActivityLog,
    ],
  );

  const ideaArtboards = artboards.filter((a) => a.ideaId === activeIdeaId);
  const hasPendingCurrentIdeaSkeleton =
    pendingArtboardSkeleton?.ideaId === activeIdeaId;
  const shouldRenderMockupCanvas =
    ideaArtboards.length > 0 || hasPendingCurrentIdeaSkeleton;
  const activeArtboard =
    ideaArtboards.find((a) => a.id === activeArtboardId) ??
    ideaArtboards[ideaArtboards.length - 1] ??
    null;
  const requestDeleteDesign = (artboardId: string) => {
    if (isReadOnly) return;
    const target = artboards.find((artboard) => artboard.id === artboardId);
    if (!target) return;
    const ownerIdea = ideas.find((i) => i.id === target.ideaId);
    setDestructiveAction({
      type: "design",
      artboard: target,
      ideaTitle: ownerIdea?.title ?? target.ideaId,
    });
  };

  const performDeleteDesign = (artboardId: string) => {
    if (isReadOnly) return;
    const target = artboards.find((artboard) => artboard.id === artboardId);
    if (!target) return;
    const ownerIdea = ideas.find((i) => i.id === target.ideaId);
    void encodeMemoryDraft(
      `delete-design-${artboardId}`,
      `목업 삭제: ${ownerIdea?.title ?? target.ideaId} 시안의 디자인`,
      `삭제된 artboardId: ${artboardId}`,
      Date.now(),
    );
    appendActivityLog({
      section: "mockup",
      action: "delete",
      output: `삭제된 artboardId: ${artboardId}`,
      outputTitle: ownerIdea?.title ?? target.label,
    });
    setDesignContextMenu(null);

    setArtboards((prev) => {
      const next = prev.filter((artboard) => artboard.id !== artboardId);
      if (activeArtboardId === artboardId) {
        const nextActive =
          next.filter((artboard) => artboard.ideaId === target.ideaId).at(-1) ??
          null;
        setActiveArtboardId(nextActive?.id ?? null);
      }
      return next;
    });
    setArtboardHeights((prev) => {
      const next = { ...prev };
      delete next[artboardId];
      return next;
    });
    setSelectedElement((prev) =>
      prev?.artboardId === artboardId ? null : prev,
    );
  };

  const requestDeleteReference = (reference: Reference) => {
    if (isReadOnly) return;
    setDestructiveAction({ type: "reference", reference });
  };

  const performDeleteReference = (reference: Reference) => {
    appendActivityLog({
      section: "reference",
      action: "delete",
      output: reference.description,
      outputTitle: reference.title,
      link: reference.url,
      imageUrl: reference.imageUrl,
    });
    void encodeMemoryDraft(
      `delete-reference-${reference.id}`,
      `레퍼런스 삭제: ${reference.title}`,
      formatReferenceMemoryDetail(reference),
      Date.now(),
      {
        links: [
          memorySourceLinkFromReference(reference),
        ],
      },
    );
    setReferences((prev) =>
      prev.filter((candidate) => candidate.id !== reference.id),
    );
    setSelectedReferences((prev) =>
      prev.filter((candidate) => candidate.id !== reference.id),
    );
  };
  const chooseMissionOption = async (option: MissionOption) => {
    const now = Date.now();
    const nextDevice = option.device ?? device;
    setSelectedOptionId(option.id);
    setDevice(nextDevice);
    setTimerEndedAt(null);

    setMissionTitle(option.title);
    setMissionBrief(optionBrief(option));
    if (!isReadOnly && userId) {
      const ref = sessionRefFor(userId);
      await setDoc(
        ref,
        {
          missionId,
          selectedOptionId: option.id,
          missionTitle: option.title,
          missionBrief: optionBrief(option),
          selectedDevice: nextDevice,
          status: "draft",
          updatedAt: now,
        },
        { merge: true },
      );
    }
  };
  const isGeneratingCurrentIdeaMockup =
    isGeneratingMockup && generatingMockupIdeaId === activeIdeaId;
  const openSessionReview = useCallback(() => {
    setIsCompletingSession(false);
    setSessionCompletionReady(false);
    router.push(`/main/${missionId}?review=1`);
  }, [missionId, router]);
  const completeSession = async () => {
    if (isReadOnly || isCompletingSession || sessionCompleted || !missionId)
      return;
    const currentUser = firebaseAuth.currentUser;
    if (!currentUser) return;
    setSessionCompletionStep(0);
    setSessionCompletionReady(false);
    setIsCompletingSession(true);
    let completedSuccessfully = false;
    try {
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
      }
      await persistSessionSnapshot();
      const finalBoard = finalArtboardId
        ? artboards.find((board) => board.id === finalArtboardId) ?? null
        : null;
      const finalIdea = finalBoard
        ? ideas.find((idea) => idea.id === finalBoard.ideaId) ?? null
        : null;
      if (finalBoard && finalIdea) {
        // Send every compared candidate mockup plus the session chat so the
        // server can investigate each board's HTML (copy/structure/UI style)
        // and the chat-revealed preference, then encode a rich memory input
        // instead of a bare label.
        const finalDesignPayload: FinalDesignEnrichmentPayload = {
          boards: artboards
            .filter((board) => board.html?.trim())
            .map((board) => ({
              artboardId: board.id,
              ideaTitle:
                ideas.find((idea) => idea.id === board.ideaId)?.title ?? "",
              label: board.label,
              device: board.device === "mobile" ? "mobile" : "desktop",
              html: board.html,
              chosen: board.id === finalBoard.id,
            })),
          chat: messages
            .filter((m) => m.role === "user" || m.role === "assistant")
            .map((m) => ({
              role: m.role,
              content: cleanMessageContentForModel(m.content),
            }))
            .filter((m) => m.content.trim()),
        };
        const finalMemoryCreated = await encodeMemoryDraft(
          `final-design-selection-${finalBoard.id}`,
          `최종 디자인 확정: ${finalBoard.label}`,
          `artboardId: ${finalBoard.id} / 시안: ${finalIdea.title} / 생성일: ${
            finalBoard.createdAt
              ? new Date(finalBoard.createdAt).toLocaleString("ko-KR")
              : "미상"
          }`,
          Date.now(),
          undefined,
          finalDesignPayload,
        );
        if (!finalMemoryCreated) {
          throw new Error("Unable to create the final-design memory draft.");
        }
      }
      const token = await getIdToken(currentUser, true);
      const res = await fetch("/api/memory/complete-session", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ missionId }),
      });
      if (!res.ok) throw new Error(`Session completion failed: ${res.status}`);
      const completionData = await res.json().catch(() => null);
      const completedAt = Number(completionData?.completedAt ?? Date.now());
      if (isOnboardingMission) {
        await fetch("/api/users/me", {
          method: "PATCH",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ onboardingCompleted: true }),
        });
        if (userId) {
          window.localStorage.removeItem(`vda:onboarding-required:${userId}`);
          window.localStorage.setItem(
            `vda:onboarding-completed:${userId}`,
            "true",
          );
        }
      }
      setTimerEndedAt(completedAt);
      setSessionCompletionStep(1);
      try {
        await fetch("/api/memory/clusters", {
          method: "POST",
          headers: { Authorization: `Bearer ${token}` },
        });
      } catch {
        // clustering failure is non-fatal
      }
      setSessionCompletionStep(2);
      const reviewTargetUid = userId ?? currentUser.uid;
      try {
        const summary = await fetchSessionMemorySummary(
          token,
          reviewTargetUid,
          missionId,
        );
        setSessionMemorySummary(summary);
        sessionMemorySummaryKeyRef.current = sessionMemorySummaryKey(
          reviewTargetUid,
          missionId,
        );
      } catch (summaryError) {
        console.warn("Unable to prepare review memory summary", summaryError);
        setSessionMemorySummary(EMPTY_SESSION_MEMORY_SUMMARY);
        sessionMemorySummaryKeyRef.current = null;
      }
      setSessionCompleted(true);
      setSessionCompletionReady(true);
      setMemoryGraphPhase("after");
      completedSuccessfully = true;
    } catch (error) {
      console.warn("Unable to complete session", error);
      toast.error("세션 종료 및 메모리 확정에 실패했습니다. 잠시 후 다시 시도해주세요.");
    } finally {
      if (!completedSuccessfully) {
        setIsCompletingSession(false);
        setSessionCompletionReady(false);
      }
    }
  };
  const exportMessageLogCsv = () => {
    const exportedAt = new Date().toISOString();
    const selectedOption = missionOptions.find(
      (option) => option.id === selectedOptionId,
    );
    const sessionMeta = {
      missionId,
      missionTitle:
        parentMissionTitle || missionTitle || selectedOption?.title || "",
      missionOptionId: selectedOptionId ?? "",
      missionOptionTitle: selectedOption?.title ?? "",
      viewedUserId: viewAs ?? userId ?? "",
      viewedUserName: viewAsName ?? "",
      device,
      stitchProjectId,
      timerStartedAt: timerStartedAt
        ? new Date(timerStartedAt).toISOString()
        : "",
      timerElapsedSeconds: timerStartedAt
        ? String(Math.max(0, Math.floor((Date.now() - timerStartedAt) / 1000)))
        : "",
      exportedAt,
    };
    const outputRows = [
      ...ideas.map((idea) => ({
        eventType: "note",
        section: "note",
        action: "snapshot",
        role: "",
        input: "",
        output: [idea.title, idea.description].filter(Boolean).join("\n\n"),
        outputType: "note",
        outputTitle: idea.title,
        link: "",
        referenceLinks: "",
        content: idea.description,
        html: "",
        imageUrl: "",
        createdAt: idea.createdAt ? new Date(idea.createdAt).toISOString() : "",
        stitchScreenId: "",
        stitchPrompt: "",
      })),
      ...references.map((reference) => ({
        eventType: "reference",
        section: "reference",
        action: "snapshot",
        role: "",
        input: "",
        output: [reference.title, reference.description, reference.url]
          .filter(Boolean)
          .join("\n"),
        outputType: "reference",
        outputTitle: reference.title,
        link: reference.url ?? "",
        referenceLinks: reference.url ?? "",
        content: reference.description,
        html: "",
        imageUrl: reference.imageUrl ?? "",
        createdAt: "",
        stitchScreenId: "",
        stitchPrompt: "",
      })),
      ...artboards.map((artboard) => ({
        eventType: "mockup",
        section: "mockup",
        action: "snapshot",
        role: "",
        input: "",
        output: artboard.html || artboard.label,
        outputType: "mockup",
        outputTitle: artboard.label,
        link: "",
        referenceLinks: "",
        content: artboard.label,
        html: artboard.html,
        imageUrl: "",
        createdAt: artboard.createdAt
          ? new Date(artboard.createdAt).toISOString()
          : "",
        stitchScreenId: artboard.stitchScreenId ?? "",
        stitchPrompt: "",
      })),
    ];
    const eventRows = [
      ...activityLog.map((event) => ({
        eventType: `${event.section}:${event.action}`,
        section: event.section,
        action: event.action,
        role: "",
        input: event.input ?? "",
        output: event.output ?? "",
        outputType: event.section,
        outputTitle: event.outputTitle ?? "",
        link: event.link ?? "",
        referenceLinks: event.section === "reference" ? (event.link ?? "") : "",
        content: event.output ?? "",
        html: event.html ?? "",
        imageUrl: event.imageUrl ?? "",
        createdAt: new Date(event.createdAt).toISOString(),
        stitchScreenId: "",
        stitchPrompt: event.stitchPrompt ?? "",
        messageIndex: "",
        citedElement: "",
        citedReferences: "",
      })),
      ...messages.map((message, index) => ({
        eventType: "message",
        section: "chat",
        action: message.role,
        role: message.role,
        input: message.role === "user" ? message.content : "",
        output: message.role === "assistant" ? message.content : "",
        outputType: message.role === "assistant" ? "message" : "",
        outputTitle: "",
        link: "",
        referenceLinks: (message.citedReferences ?? [])
          .map((reference) => reference.imageUrl)
          .filter(Boolean)
          .join("; "),
        content: message.content,
        html: "",
        imageUrl: "",
        createdAt: message.createdAt
          ? new Date(message.createdAt).toISOString()
          : "",
        stitchScreenId: "",
        stitchPrompt: "",
        messageIndex: String(index + 1),
        citedElement: message.citedElement
          ? `${message.citedElement.artboardId}:${message.citedElement.selector}`
          : "",
        citedElementHtml: message.citedElement?.outerHTML ?? "",
        citedReferences: (message.citedReferences ?? [])
          .map((reference) =>
            [reference.title, reference.imageUrl].filter(Boolean).join(" - "),
          )
          .join("; "),
      })),
      ...outputRows.map((row) => ({
        ...row,
        messageIndex: "",
        citedElement: "",
        citedReferences: "",
      })),
    ];
    const csvRows = [
      [
        "event_index",
        "event_type",
        "section",
        "action",
        "role",
        "message_index",
        "input",
        "output",
        "output_type",
        "output_title",
        "link",
        "reference_links",
        "content",
        "html",
        "image_url",
        "created_at",
        "cited_element",
        "cited_references",
        "mission_id",
        "mission_title",
        "mission_option_id",
        "mission_option_title",
        "viewed_user_id",
        "viewed_user_name",
        "device",
        "stitch_project_id",
        "stitch_screen_id",
        "stitch_prompt",
        "timer_started_at",
        "timer_elapsed_seconds",
        "exported_at",
      ],
      ...eventRows.map((row, index) => [
        String(index + 1),
        row.eventType,
        row.section,
        row.action,
        row.role,
        row.messageIndex,
        row.input,
        row.output,
        row.outputType,
        row.outputTitle,
        row.link,
        row.referenceLinks,
        row.content,
        row.html,
        row.imageUrl,
        row.createdAt,
        row.citedElement,
        row.citedReferences,
        sessionMeta.missionId,
        sessionMeta.missionTitle,
        sessionMeta.missionOptionId,
        sessionMeta.missionOptionTitle,
        sessionMeta.viewedUserId,
        sessionMeta.viewedUserName,
        sessionMeta.device,
        sessionMeta.stitchProjectId,
        row.stitchScreenId,
        row.stitchPrompt,
        sessionMeta.timerStartedAt,
        sessionMeta.timerElapsedSeconds,
        sessionMeta.exportedAt,
      ]),
    ];
    const csv = csvRows.map((row) => row.map(csvCell).join(",")).join("\n");
    const blob = new Blob(["\uFEFF", csv], {
      type: "text/csv;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    const sessionName = safeFilenamePart(
      viewAsName ?? viewAs ?? userId ?? "user",
    );
    const missionName = safeFilenamePart(missionId ?? "mission");
    link.href = url;
    link.download = `${missionName}-${sessionName}-log.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  };
  const gridSize = 20 * canvasScale;
  const getArtboardRenderHeight = (artboard: Artboard) =>
    Math.max(
      DEVICE_SIZE[artboard.device ?? "desktop"].height,
      artboardHeights[artboard.id] ?? 0,
    );
  const renderMockupCanvas = (expanded = false) => (
    <div
      ref={canvasRef}
      className={`relative w-full overflow-hidden select-none ${expanded ? "flex-1" : "h-150 rounded-2xl"}`}
      style={{
        backgroundColor: "#1a1a1a",
        backgroundImage:
          "radial-gradient(circle, #383838 1px, transparent 1px)",
        backgroundSize: `${gridSize}px ${gridSize}px`,
        backgroundPosition: `${canvasOffset.x}px ${canvasOffset.y}px`,
        cursor: isDragging ? "grabbing" : "grab",
      }}
      onMouseDown={handleCanvasMouseDown}
      onMouseMove={handleCanvasMouseMove}
      onMouseUp={handleCanvasMouseUp}
      onMouseLeave={handleCanvasMouseUp}
      onClick={(e) => {
        if (e.target !== e.currentTarget) return;
        setActiveArtboardId(null);
        clearSelectedElement();
        setDesignContextMenu(null);
      }}
    >
      <style>{`
        @keyframes vda-skeleton-shimmer {
          0% { background-position: 200% 0; }
          100% { background-position: -200% 0; }
        }
      `}</style>
      {isGeneratingCurrentIdeaMockup && (
        <div className="pointer-events-none absolute left-1/2 top-4 z-20 flex -translate-x-1/2 items-center gap-3 rounded-full border border-white/10 bg-black/75 px-4 py-2 text-white shadow-lg backdrop-blur">
          <Spinner className="size-4 text-white" />
          <p className="text-xs font-medium text-white/85">
            Stitch로 목업 {mockupOperation === "edit" ? "수정" : "생성"} 중...
          </p>
          {mockupProgress && (
            <p className="text-xs font-semibold text-white/75">
              {mockupProgress.percent}% · {mockupProgress.label}
            </p>
          )}
          {!isReadOnly && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                cancelMockupGeneration();
              }}
              className="pointer-events-auto rounded-full bg-white px-3 py-1 text-xs font-semibold text-slate-900 transition hover:bg-slate-100"
            >
              취소
            </button>
          )}
        </div>
      )}
      <div
        ref={canvasWorldRef}
        className="absolute inset-0"
        style={{
          transform: `translate3d(${canvasOffset.x}px, ${canvasOffset.y}px, 0) scale(${canvasScale})`,
          transformOrigin: "0 0",
          willChange: "transform",
          pointerEvents: isDragging ? "none" : "auto",
        }}
      >
        {ideaArtboards.map((artboard) => {
          const isActive = artboard.id === activeArtboardId;
          const artboardViewport =
            DEVICE_SIZE[artboard.device ?? "desktop"];
          const artboardHeight = getArtboardRenderHeight(artboard);
          const artboardHtml = injectHeightReporter(
            injectNoNavigation(injectSelectionScript(artboard.html, artboard.id)),
            artboard.id,
            artboardViewport,
          );
          return (
            <div key={artboard.id}>
              <div
                style={{
                  position: "absolute",
                  left: artboard.x,
                  top: artboard.y - 22,
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  color: isActive ? "#a5b4fc" : "#888",
                  fontSize: 11,
                  fontWeight: isActive ? 600 : 400,
                  whiteSpace: "nowrap",
                  userSelect: "none",
                }}
              >
                <span>{artboard.label}</span>
              </div>
              <div
                style={{
                  position: "absolute",
                  left: artboard.x,
                  top: artboard.y,
                  width: artboardViewport.width,
                  height: artboardHeight,
                  borderRadius: artboard.device === "mobile" ? 24 : 12,
                  overflow: "hidden",
                  outline: isActive
                    ? "2px solid #6366f1"
                    : "2px solid transparent",
                  outlineOffset: 3,
                  boxShadow: "0 8px 40px rgba(0,0,0,0.5)",
                }}
                onClick={() => setActiveArtboardId(artboard.id)}
                onContextMenu={(e) => {
                  if (isReadOnly) return;
                  e.preventDefault();
                  e.stopPropagation();
                  setActiveArtboardId(artboard.id);
                  setDesignContextMenu({
                    artboardId: artboard.id,
                    x: e.clientX,
                    y: e.clientY,
                  });
                }}
              >
                {artboard.html ? (
                  <iframe
                    key={`${artboard.id}-${artboard.htmlUpdatedAt ?? artboard.createdAt ?? 0}`}
                    ref={(node) => {
                      if (node) mockupFrameRefs.current.set(artboard.id, node);
                      else mockupFrameRefs.current.delete(artboard.id);
                    }}
                    srcDoc={artboardHtml}
                    sandbox="allow-scripts"
                    scrolling="no"
                    style={{
                      width: artboardViewport.width,
                      height: artboardHeight,
                      border: "none",
                      display: "block",
                      overflow: "hidden",
                      pointerEvents: editMode ? "auto" : "none",
                    }}
                    title={artboard.label}
                  />
                ) : (
                  <div className="flex h-full w-full flex-col items-center justify-center gap-4 bg-zinc-900 text-zinc-300">
                    {artboard.htmlStatus === "failed" ? (
                      <p className="text-sm font-medium">
                        화면을 불러오지 못했습니다. 페이지를 새로고침해 다시 시도해 주세요.
                      </p>
                    ) : (
                      <>
                        <Spinner className="size-7" />
                        <p className="text-sm font-medium">
                          Stitch 화면을 불러오는 중...
                        </p>
                      </>
                    )}
                  </div>
                )}
              </div>
            </div>
          );
        })}
        {hasPendingCurrentIdeaSkeleton && (
          <div>
            <div
              style={{
                position: "absolute",
                left: pendingArtboardSkeleton.x,
                top: pendingArtboardSkeleton.y - 22,
                color: "#94a3b8",
                fontSize: 11,
                fontWeight: 600,
                whiteSpace: "nowrap",
                userSelect: "none",
              }}
            >
              {pendingArtboardSkeleton.label}
            </div>
            <div
              style={{
                position: "absolute",
                left: pendingArtboardSkeleton.x,
                top: pendingArtboardSkeleton.y,
                width: DEVICE_SIZE[pendingArtboardSkeleton.device].width,
                height: DEVICE_SIZE[pendingArtboardSkeleton.device].height,
                borderRadius:
                  pendingArtboardSkeleton.device === "mobile" ? 24 : 12,
                overflow: "hidden",
                outline: "2px dashed rgba(148, 163, 184, 0.55)",
                outlineOffset: 3,
                boxShadow: "0 8px 40px rgba(0,0,0,0.35)",
                background:
                  "linear-gradient(110deg, #27272a 8%, #3f3f46 18%, #27272a 33%)",
                backgroundSize: "200% 100%",
                animation: "vda-skeleton-shimmer 1.25s linear infinite",
              }}
            >
              <div
                style={{
                  display: "flex",
                  height: "100%",
                  flexDirection: "column",
                  gap: 24,
                  padding:
                    pendingArtboardSkeleton.device === "mobile" ? 24 : 40,
                }}
              >
                <div
                  style={{
                    height: 18,
                    width: "32%",
                    borderRadius: 999,
                    background: "rgba(255,255,255,0.18)",
                  }}
                />
                <div
                  style={{
                    height:
                      pendingArtboardSkeleton.device === "mobile" ? 180 : 260,
                    borderRadius:
                      pendingArtboardSkeleton.device === "mobile" ? 20 : 24,
                    background: "rgba(255,255,255,0.14)",
                  }}
                />
                <div style={{ display: "grid", gap: 14 }}>
                  {[0, 1, 2].map((row) => (
                    <div
                      key={row}
                      style={{
                        height: row === 0 ? 28 : 14,
                        width: row === 2 ? "56%" : row === 1 ? "82%" : "68%",
                        borderRadius: 999,
                        background: "rgba(255,255,255,0.16)",
                      }}
                    />
                  ))}
                </div>
                <div
                  style={{
                    marginTop: "auto",
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    color: "rgba(255,255,255,0.72)",
                    fontSize: 13,
                    fontWeight: 600,
                  }}
                >
                  <span
                    style={{
                      height: 14,
                      width: 14,
                      borderRadius: 999,
                      border: "2px solid rgba(255,255,255,0.3)",
                      borderTopColor: "rgba(255,255,255,0.85)",
                      animation: "spin 0.8s linear infinite",
                    }}
                  />
                  새 아트보드 생성 중...
                </div>
                {mockupProgress && (
                  <div style={{ display: "grid", gap: 8 }}>
                    <div
                      style={{
                        height: 6,
                        overflow: "hidden",
                        borderRadius: 999,
                        background: "rgba(255,255,255,0.14)",
                      }}
                    >
                      <div
                        style={{
                          height: "100%",
                          width: `${mockupProgress.percent}%`,
                          borderRadius: 999,
                          background: "rgba(255,255,255,0.74)",
                          transition: "width 0.35s ease",
                        }}
                      />
                    </div>
                    <div
                      style={{
                        color: "rgba(255,255,255,0.58)",
                        fontSize: 12,
                        fontWeight: 600,
                      }}
                    >
                      {mockupProgress.percent}% · {mockupProgress.label}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );

  const contextMenuArtboard = designContextMenu
    ? artboards.find((artboard) => artboard.id === designContextMenu.artboardId)
    : null;
  const memoryPhaseToggle = (
    <div className="flex items-center gap-1 rounded-full bg-white/90 p-1 shadow-sm ring-1 ring-slate-100">
      {(["before", "after"] as const).map((phase) => (
        <button
          key={phase}
          type="button"
          onClick={() => {
            setMemoryGraphPhase(phase);
            if (
              phase === "before" &&
              (memoryGraphFilter === "promoted" ||
                memoryGraphFilter === "archived")
            ) {
              setMemoryGraphFilter("changed");
            }
          }}
          className={`rounded-full px-2.5 py-1 text-[11px] font-semibold transition ${
            memoryGraphPhase === phase
              ? "bg-slate-900 text-white"
              : "text-slate-400 hover:bg-slate-100 hover:text-slate-700"
          }`}
        >
          {phase === "before" ? "세션 이전" : "세션 이후"}
        </button>
      ))}
    </div>
  );
  const activeReviewClusters =
    sessionMemorySummary.clustersByVariant["keyword-episodic-semantic-link"];
  // Use the fixed-input cache; fall back to the variant-agnostic default when
  // that cache has not been generated yet so the graph never goes blank.
  const reviewGraphClusters = activeReviewClusters.graphClusters.length
    ? activeReviewClusters.graphClusters
    : sessionMemorySummary.graphClusters;
  const reviewGraphEdges = activeReviewClusters.graphClusters.length
    ? activeReviewClusters.graphEdges
    : sessionMemorySummary.graphEdges;
  const renderSessionImpactGraph = (variant: "panel" | "overlay" = "overlay") => {
    const isOverlay = variant === "overlay";
    const referencedByMemoryId = new Map(
      sessionMemorySummary.referenced.map((item) => [item.memoryId, item]),
    );
    const promotedIds = new Set(
      sessionMemorySummary.promoted.map((item) => item.id),
    );
    const sessionArchivedIds = new Set(
      sessionArchivedMemories.map((item) => item.id),
    );
    const visibleMemoryItems = cumulativeGraphMemories.filter(
      (memory) => {
        const referenced = referencedByMemoryId.get(memory.id);
        const isPromoted = promotedIds.has(memory.id);
        const isArchived = sessionArchivedIds.has(memory.id);
        if (memoryGraphPhase === "before" && isPromoted) return false;
        if (memoryGraphPhase === "before" && isArchived && !referenced) {
          return false;
        }
        if (memoryGraphFilter === "all") return true;
        if (memoryGraphFilter === "changed") {
          return Boolean(referenced) || isPromoted || isArchived;
        }
        if (memoryGraphFilter === "referenced") return Boolean(referenced);
        if (memoryGraphFilter === "promoted") return isPromoted;
        return isArchived && memoryGraphPhase === "after";
      },
    );
    const visibleMemoryIds = new Set(visibleMemoryItems.map((item) => item.id));
    const visibleGraphEdges = reviewGraphEdges.filter(
      (edge) =>
        visibleMemoryIds.has(edge.sourceId) &&
        visibleMemoryIds.has(edge.targetId),
    );
    const graphItems = visibleMemoryItems.map((memory) => {
      const referenced = referencedByMemoryId.get(memory.id);
      const phaseWeight =
        memoryGraphPhase === "before" && referenced?.weightBefore != null
          ? referenced.weightBefore
          : memory.weight;
      const memoryKeywords = Array.from(
        new Set([...(memory.keyword ?? []), ...(memory.keywords ?? [])]),
      );
      return {
        id: memory.id,
        memoryId: memory.id,
        semantic: memory.semantic ?? "",
        episodic: memory.episodic ?? "",
        input: memory.input ?? "",
        output: memory.output ?? "",
        originalInteractionContent: memory.originalInteractionContent ?? "",
        sourceType: memory.sourceType ?? null,
        action: [
          memory.agentActionCategory ?? "",
          referenced ? "referenced" : "",
          promotedIds.has(memory.id) ? "promoted" : "",
          sessionArchivedIds.has(memory.id) && memoryGraphPhase === "after"
            ? "archived"
            : "",
        ]
          .filter(Boolean)
          .join(" / "),
        timestamp: memory.timestamp ?? 0,
        weight: phaseWeight ?? null,
        embedding: memory.embedding,
        keyword: memoryKeywords,
        keywords: memoryKeywords,
        row: {
          source: memory.source ?? undefined,
        },
      };
    });
    const baseGraphClusters = reviewGraphClusters
      .map((cluster) => ({
        ...cluster,
        itemIds: cluster.itemIds.filter((itemId) => visibleMemoryIds.has(itemId)),
        count: cluster.itemIds.filter((itemId) => visibleMemoryIds.has(itemId))
          .length,
      }))
      .filter((cluster) => cluster.itemIds.length > 0);
    const clusteredMemoryIds = new Set(
      baseGraphClusters.flatMap((cluster) => cluster.itemIds),
    );
    const unclusteredMemoryIds = graphItems
      .map((item) => item.id)
      .filter((id) => !clusteredMemoryIds.has(id));
    const graphClusters =
      unclusteredMemoryIds.length > 0
        ? [
            ...baseGraphClusters,
            {
              id: "session-unclustered",
              label: "Unclustered session memory",
              summary:
                "Session memory items not included in the saved similarity cluster cache.",
              count: unclusteredMemoryIds.length,
              relatedActions: [],
              itemIds: unclusteredMemoryIds,
              representativeItems: [],
            },
          ]
        : baseGraphClusters;
    const graphClusterIds = new Set(graphClusters.map((cluster) => cluster.id));
    const selectedClusterId =
      selectedSessionGraphClusterId && graphClusterIds.has(selectedSessionGraphClusterId)
        ? selectedSessionGraphClusterId
        : graphClusters[0]?.id ?? null;

    const emptyState = (
      <div className="flex h-full items-center justify-center">
        <p className="rounded-lg bg-slate-50 px-3 py-5 text-center text-xs text-slate-400">
          {memoryGraphPhase === "before"
            ? "세션 이전에는 메모리가 없었습니다."
            : "아직 node view로 표시할 세션 메모리 변화가 없습니다."}
        </p>
      </div>
    );

    if (isOverlay) {
      // Mirror the /agent page layout: cluster list (left) + graph (center) +
      // detail side panel (right). The graph's inline detail card is disabled
      // so node details only appear in the side panel.
      const selectedCluster =
        graphClusters.find((cluster) => cluster.id === selectedClusterId) ??
        null;
      const selectedClusterItems = selectedCluster
        ? graphItems.filter((item) =>
            selectedCluster.itemIds.includes(item.id),
          )
        : [];
      const sidePanelMemories = cumulativeGraphMemories.map(
        (memory) => ({
          id: memory.id,
          episodic: memory.episodic ?? null,
          semantic: memory.semantic ?? null,
          input: memory.input ?? null,
          output: memory.output ?? null,
          originalInteractionContent: memory.originalInteractionContent ?? null,
          action: memory.agentActionCategory ?? null,
          sourceType: memory.sourceType ?? null,
          keywords: Array.from(
            new Set([...(memory.keyword ?? []), ...(memory.keywords ?? [])]),
          ),
          weight: memory.weight ?? null,
          timestamp: memory.timestamp ?? null,
          archivedAt: memory.archivedAt ?? null,
          archiveReason: memory.archiveReason ?? null,
          source: memory.source ?? null,
        }),
      );
      const mentionMemoryLabel = (memory: {
        semantic?: string;
        episodic?: string;
        input?: string;
        output?: string;
        action?: string;
        id: string;
      }) =>
        (memory.semantic ||
          memory.episodic ||
          memory.input ||
          memory.output ||
          memory.action ||
          memory.id).replace(/\s+/g, " ").trim();
      const selectReviewMentionMemory = (memoryId: string) => {
        setSelectedGraphMemoryId(memoryId);
        if (!memoryReviewMentionMode) return;
        const item = graphItems.find((candidate) => candidate.id === memoryId);
        if (!item) return;
        chooseMemoryReviewMention({
          id: item.id,
          type: "memory",
          label: mentionMemoryLabel(item),
        });
      };
      const focusReviewMention = (
        target: Omit<MemoryReviewMentionTarget, "eventId">,
      ) => {
        if (target.type === "cluster") {
          if (graphClusters.some((cluster) => cluster.id === target.id)) {
            setSelectedSessionGraphClusterId(target.id);
            setSelectedGraphMemoryId(null);
          }
          return;
        }

        const containingCluster = graphClusters.find((cluster) =>
          cluster.itemIds.includes(target.id),
        );
        if (containingCluster) {
          setSelectedSessionGraphClusterId(containingCluster.id);
        }
        if (graphItems.some((item) => item.id === target.id)) {
          setSelectedGraphMemoryId(target.id);
        }
      };
      return (
        <div className="flex h-full w-full min-h-0 gap-4 overflow-hidden">
          <MemoryClusterList
            clusters={graphClusters}
            selectedClusterId={selectedClusterId}
            generatedAt={null}
            hasStaleCache={false}
            isRegenerating={false}
            onSelectCluster={(clusterId) => {
              setSelectedSessionGraphClusterId(clusterId);
              setSelectedGraphMemoryId(null);
            }}
            mentionMode={memoryReviewMentionMode}
            onMentionCluster={(cluster) =>
              chooseMemoryReviewMention({
                id: cluster.id,
                type: "cluster",
                label: cluster.label,
              })
            }
            presentation="review"
            nodeCount={graphItems.length}
            edgeCount={visibleGraphEdges.length}
          />
          <div className="flex min-w-0 flex-1 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
            <MemoryClusterSidePanel
              cluster={selectedCluster}
              items={selectedClusterItems}
              memories={sidePanelMemories}
              selectedMemoryId={selectedGraphMemoryId}
              onSelectMemory={setSelectedGraphMemoryId}
              getMissionLabel={(originMissionId) => {
                if (originMissionId === ONBOARDING_MISSION_ID) return "온보딩";
                if (originMissionId === missionId && missionTitle) {
                  return missionTitle;
                }
                return `미션 ${originMissionId.slice(0, 10)}`;
              }}
              mentionMode={memoryReviewMentionMode}
              onMentionCluster={(selected) =>
                chooseMemoryReviewMention({
                  id: selected.id,
                  type: "cluster",
                  label: selected.label,
                })
              }
              onMentionMemory={(item) =>
                chooseMemoryReviewMention({
                  id: item.id,
                  type: "memory",
                  label: mentionMemoryLabel(item),
                })
              }
            />
            <div className="relative min-w-0 flex-1 overflow-hidden">
              {graphItems.length === 0 ? (
                emptyState
              ) : (
                <MemoryClusterGraph
                  clusters={graphClusters}
                  items={graphItems}
                  edges={visibleGraphEdges}
                  selectedClusterId={selectedClusterId}
                  selectedMemoryId={selectedGraphMemoryId}
                  onSelectCluster={setSelectedSessionGraphClusterId}
                  onSelectMemory={selectReviewMentionMemory}
                  getMissionLabel={(originMissionId) => {
                    if (originMissionId === ONBOARDING_MISSION_ID) return "온보딩";
                    if (originMissionId === missionId && missionTitle) {
                      return missionTitle;
                    }
                    return `미션 ${originMissionId.slice(0, 10)}`;
                  }}
                  showInlineDetail={false}
                  fill
                />
              )}
            </div>
            <MemoryReviewPanel
              mentionTarget={memoryReviewMentionTarget}
              onMentionModeChange={setMemoryReviewMentionMode}
              onMentionFocus={focusReviewMention}
              initialAnswers={memoryReviewAnswers ?? undefined}
              saveStatus={memoryReviewSaveStatus}
              submittedAt={memoryReviewSubmittedAt}
              readOnly={isViewingAsAdmin}
              onAnswersChange={handleMemoryReviewAnswersChange}
              onSubmitFeedback={
                isViewingAsAdmin
                  ? undefined
                  : (answers) => saveMemoryReviewFeedback(true, answers)
              }
              onSubmitted={() => router.push("/lobby")}
            />
          </div>
        </div>
      );
    }

    return (
      <div className="relative h-96 overflow-hidden rounded-lg border border-slate-100 bg-white">
        <div className="absolute left-3 top-3 z-10">{memoryPhaseToggle}</div>
        {graphItems.length === 0 && emptyState}
        {graphItems.length > 0 && (
          <>
            <div className="absolute right-3 top-3 z-10 rounded-full bg-white/90 px-2.5 py-1 text-[10px] font-semibold text-slate-400 shadow-sm ring-1 ring-slate-100">
              {graphClusters.length} clusters · {graphItems.length} nodes ·{" "}
              {visibleGraphEdges.length} edges
            </div>
            {graphClusters.length === 0 && (
              <div className="absolute right-3 top-10 z-10 max-w-64 rounded-lg border border-amber-100 bg-amber-50 px-3 py-2 text-[11px] leading-relaxed text-amber-700 shadow-sm">
                클러스터 cache가 없습니다. Admin Memory의 cluster view에서 Regenerate를 실행하면 similarity 묶음으로 표시됩니다.
              </div>
            )}
            <div className="h-full pt-14">
              <MemoryClusterGraph
                clusters={graphClusters}
                items={graphItems}
                edges={visibleGraphEdges}
                selectedClusterId={selectedClusterId}
                onSelectCluster={setSelectedSessionGraphClusterId}
                onSelectMemory={(memoryId) => {
                  setSelectedGraphMemoryId(memoryId);
                  const referenced = referencedByMemoryId.get(memoryId);
                  if (referenced) setSelectedReferencedMemoryId(referenced.memoryId);
                }}
                getMissionLabel={(originMissionId) => {
                  if (originMissionId === ONBOARDING_MISSION_ID) return "온보딩";
                  if (originMissionId === missionId && missionTitle) {
                    return missionTitle;
                  }
                  return `미션 ${originMissionId.slice(0, 10)}`;
                }}
                fill
              />
            </div>
          </>
        )}
      </div>
    );
  };

  const destructiveDialogCopy = destructiveAction
    ? destructiveAction.type === "idea"
      ? {
          title: "시안을 삭제할까요?",
          description: `${destructiveAction.idea.title} 시안과 연결된 목업이 함께 삭제됩니다. 삭제 내역은 세션 활동과 메모리 draft에 기록됩니다.`,
          actionLabel: "시안 삭제",
        }
      : destructiveAction.type === "design"
        ? {
            title: "디자인을 삭제할까요?",
            description: `${destructiveAction.ideaTitle} 시안의 ${destructiveAction.artboard.label} 목업을 삭제합니다. 다른 목업과 시안은 유지됩니다.`,
            actionLabel: "디자인 삭제",
          }
        : {
            title: "레퍼런스를 삭제할까요?",
            description: `${destructiveAction.reference.title} 레퍼런스를 현재 세션에서 제거합니다. 삭제 내역은 세션 활동과 메모리 draft에 기록됩니다.`,
            actionLabel: "레퍼런스 삭제",
          }
    : null;

  const runDestructiveAction = () => {
    if (!destructiveAction) return;
    const action = destructiveAction;
    setDestructiveAction(null);
    if (action.type === "idea") {
      performDeleteIdea(action.idea.id);
      return;
    }
    if (action.type === "design") {
      performDeleteDesign(action.artboard.id);
      return;
    }
    performDeleteReference(action.reference);
  };

  const isInitialSessionContextPending =
    !sessionLoaded || !isMissionContextReady;

  return (
    <div className="flex h-screen flex-col bg-[#f5f5f5] text-slate-900">
      <AlertDialog
        open={Boolean(destructiveAction)}
        onOpenChange={(open) => {
          if (!open) setDestructiveAction(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {destructiveDialogCopy?.title ?? "삭제할까요?"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {destructiveDialogCopy?.description}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>취소</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={(event) => {
                event.preventDefault();
                runDestructiveAction();
              }}
            >
              {destructiveDialogCopy?.actionLabel ?? "삭제"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <div
        ref={citeMenuRef}
        data-cite-menu="1"
        className="fixed z-50 -translate-x-1/2 -translate-y-full"
        style={{ display: "none" }}
      >
        <button
          type="button"
          onMouseDown={(e) => {
            e.preventDefault();
            const text = pendingCiteTextRef.current;
            if (text) setCitedTexts((prev) => [...prev, text]);
            if (citeMenuRef.current) citeMenuRef.current.style.display = "none";
            pendingCiteTextRef.current = "";
            window.getSelection()?.removeAllRanges();
          }}
          className="flex items-center gap-1.5 rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white shadow-lg hover:bg-slate-700"
        >
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
            <path
              d="M1 3h10M1 6h6M1 9h8"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
            />
          </svg>
          인용하기
        </button>
        <div className="mx-auto mt-1 h-1.5 w-1.5 rotate-45 bg-slate-900" />
      </div>

      {designContextMenu && contextMenuArtboard && !isReadOnly && (
        <div
          className="fixed z-50 min-w-36 overflow-hidden rounded-xl border border-slate-200 bg-white py-1 text-sm shadow-xl"
          style={{ left: designContextMenu.x, top: designContextMenu.y }}
          onClick={(e) => e.stopPropagation()}
          onContextMenu={(e) => e.preventDefault()}
        >
          <button
            type="button"
            onClick={() => requestDeleteDesign(contextMenuArtboard.id)}
            className="flex w-full items-center gap-2 px-3 py-2 text-left text-red-500 transition hover:bg-red-50"
          >
            <XIcon size={14} />
            디자인 삭제
          </button>
        </div>
      )}
      {rawPromptModal && (
        <PromptViewer
          turnId={rawPromptModal.turnId}
          rawPrompt={rawPromptModal.rawPrompt}
          rawPromptSanitization={rawPromptModal.rawPromptSanitization}
          rawResponseMeta={rawPromptModal.rawResponseMeta}
          onClose={() => setRawPromptModal(null)}
        />
      )}
      <SessionProductTour
        open={isProductTourOpen}
        hasIdeas={ideas.length > 0}
        onOpenChange={handleProductTourOpenChange}
        onStepTargetChange={(target) => {
          if (target === "mission-brief") {
            setIsOptionExpanded(false);
          }
        }}
      />
      {/* Read-only banner */}
      {isReadOnly && (
        <div className="flex items-center justify-between bg-amber-50 border-b border-amber-200 px-6 py-2 text-xs text-amber-700">
          <span className="flex items-center gap-1">
            <EyeIcon size={14} />
            {isViewingAsAdmin ? (
              <>
                읽기 전용 — <strong>{viewAsName ?? viewAs}</strong>의 세션을
                보고 있습니다
              </>
            ) : (
              <>리뷰 모드 — 완료된 세션을 읽기 전용으로 보고 있습니다</>
            )}
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={exportMessageLogCsv}
              disabled={messages.length === 0}
              className="inline-flex items-center gap-1.5 rounded-full border border-amber-200 bg-white/70 px-3 py-1 font-semibold text-amber-700 transition hover:bg-white disabled:cursor-not-allowed disabled:opacity-45"
              title="로그 CSV 내보내기"
            >
              <DownloadIcon size={14} />
              로그 CSV
            </button>
          </div>
        </div>
      )}
      {/* Header */}
      <header className="flex items-center justify-between border-b border-slate-200 bg-white px-6 py-4 lg:px-10">
        <div className="flex items-center gap-4">
          <button
            type="button"
            onClick={() => {
              if (!isReadOnly && selectedOptionId && !sessionCompleted) {
                setShowLobbyWarning(true);
              } else if (isViewingAsAdmin) {
                router.push("/admin");
              } else {
                router.push("/lobby");
              }
            }}
            className="flex cursor-pointer items-center gap-1.5 rounded-full border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-800"
          >
            <ArrowLeftIcon size={14} />
            {isViewingAsAdmin ? "어드민으로 돌아가기" : "로비로 돌아가기"}
          </button>
          <h1 className="text-xl font-semibold">
            {/* 마이그레이션 후 제목에 옵션명이 이미 포함되므로 옵션명을 따로 덧붙이지 않는다 */}
            {parentMissionTitle ||
              activeOption?.title ||
              missionTitle ||
              "미션 제목 없음"}
          </h1>
        </div>
        <div className="flex items-center gap-4 text-sm text-slate-500">
          {canShowProductTour && (
            <button
              type="button"
              onClick={() => setIsProductTourOpen(true)}
              data-tour="tutorial-button"
              className="inline-flex items-center gap-1.5 rounded-full border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 transition hover:border-slate-400 hover:bg-slate-50"
            >
              <HelpCircleIcon size={15} />
              튜토리얼
            </button>
          )}
          {isAdmin && !isReadOnly && (
            <label className="flex items-center gap-2 text-xs font-semibold text-slate-500">
              <span>LLM</span>
              <Select
                value={chatResponseProvider}
                onValueChange={(value) =>
                  setChatResponseProvider(
                    value === "anthropic" ? "anthropic" : "openai",
                  )
                }
                disabled={isLoading}
              >
                <SelectTrigger
                  size="sm"
                  className="h-8 rounded-full border-slate-300 bg-white px-3 text-xs font-semibold text-slate-700 shadow-sm hover:border-slate-400"
                  aria-label="Chat response provider"
                  title="Chat response provider"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent align="end">
                  <SelectItem value="openai">OpenAI</SelectItem>
                  <SelectItem value="anthropic">Claude</SelectItem>
                </SelectContent>
              </Select>
            </label>
          )}
          {timerDisplay && (
            <span
              data-tour="session-timer"
              className={`font-mono text-lg font-semibold tabular-nums ${timerDisplay === "시간 종료" ? "text-red-500" : missionDurationMinutes && timerStartedAt && missionDurationMinutes * 60 * 1000 - (Date.now() - timerStartedAt) < 60000 ? "text-red-500" : "text-slate-900"}`}
            >
              {missionDurationMinutes
                ? `⏱ ${timerDisplay}`
                : `${timerDisplay} 경과`}
            </span>
          )}
          {showReviewAnnotations && (
            <button
              type="button"
              onClick={() => setIsMemoryDiffOpen(true)}
              className="inline-flex cursor-pointer items-center gap-2 rounded-full bg-slate-900 px-3 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-slate-700"
            >
              <BrainIcon size={15} />
              메모리 리뷰하기
              <span className="rounded-full bg-white/15 px-1.5 py-0.5 text-[10px] font-semibold text-white/80">
                {sessionMemorySummary.referenced.length +
                  sessionMemorySummary.promoted.length}
              </span>
            </button>
          )}
          {!isReadOnly && selectedOptionId && (
            <div data-tour="session-finish" className="flex items-center gap-2">
              {showFinalDesignWarning && (
                <>
                  <span className="text-xs text-amber-600">
                    최종 디자인을 선택하지 않았습니다. 그래도 종료할까요?
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      setShowFinalDesignWarning(false);
                      void completeSession();
                    }}
                    className="rounded-full bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-slate-700"
                  >
                    종료
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowFinalDesignWarning(false)}
                    className="rounded-full border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-600 transition hover:bg-slate-50"
                  >
                    취소
                  </button>
                </>
              )}
              {!showFinalDesignWarning && (
                <button
                  type="button"
                  onClick={() => {
                    if (!hasSessionStarted) return;
                    if (!finalArtboardId && artboards.length > 0) {
                      setShowFinalDesignWarning(true);
                    } else {
                      void completeSession();
                    }
                  }}
                  disabled={
                    !hasSessionStarted || isCompletingSession || sessionCompleted
                  }
                  className="rounded-full bg-slate-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-700 disabled:bg-slate-200 disabled:text-slate-500"
                >
                  {sessionCompleted
                    ? "세션 종료됨"
                    : !hasSessionStarted
                      ? "세션 시작 전"
                      : isCompletingSession
                      ? "메모리 확정 중..."
                      : "세션 종료"}
                </button>
              )}
            </div>
          )}
          {!isReadOnly && sessionCompleted && (
            <button
              type="button"
              onClick={openSessionReview}
              className="rounded-full border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:border-slate-400 hover:bg-slate-50"
            >
              리뷰 보기
            </button>
          )}
        </div>
      </header>

      {isCompletingSession && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/35 px-4 backdrop-blur-sm">
          <div
            role="status"
            aria-live="polite"
            className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-2xl shadow-slate-900/20"
          >
            <div className="flex items-center gap-3">
              <div
                className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${
                  sessionCompletionReady
                    ? "bg-slate-900 text-white"
                    : "bg-slate-100 text-slate-900"
                }`}
              >
                {sessionCompletionReady ? "✓" : <Spinner className="size-5" />}
              </div>
              <div>
                <p
                  className={`text-sm font-semibold text-slate-900 ${
                    sessionCompletionReady
                      ? ""
                      : "vda-text-shimmer vda-text-shimmer-slate"
                  }`}
                >
                  {sessionCompletionReady
                    ? isOnboardingMission
                      ? "온보딩이 완료되었어요"
                      : "세션이 저장되었어요"
                    : SESSION_PROGRESS_MESSAGES[sessionCompletionStep] ??
                      SESSION_PROGRESS_MESSAGES[0]}
                </p>
                <p className="mt-1 text-xs text-slate-500">
                  {sessionCompletionReady
                    ? "리뷰 화면에서 이번 세션의 기억과 작업 흐름을 확인할 수 있어요."
                    : "잠시만 기다려주세요."}
                </p>
              </div>
            </div>
            {sessionCompletionReady && (
              <div className="mt-6 flex gap-2">
                <button
                  type="button"
                  onClick={openSessionReview}
                  className="flex-1 rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-slate-700"
                >
                  리뷰 보기
                </button>
                <button
                  type="button"
                  onClick={() => setIsCompletingSession(false)}
                  className="rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-500 transition hover:bg-slate-50 hover:text-slate-700"
                >
                  닫기
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {isInitialSessionContextPending ? (
        <main className="flex flex-1 items-center justify-center overflow-hidden">
          <div className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-white px-5 py-4 text-sm text-slate-500 shadow-sm">
            <Spinner className="size-4 text-slate-700" />
            미션 정보를 불러오는 중...
          </div>
        </main>
      ) : missionOptions.length > 1 && !selectedOptionId ? (
        <MissionOptionSelection
          options={missionOptions}
          activePreviewId={activeOptionPreviewId}
          parentMissionTitle={parentMissionTitle}
          parentMissionBrief={parentMissionBrief}
          device={device}
          onboarding={isOnboardingMission}
          missionDurationMinutes={missionDurationMinutes}
          onPreviewChange={setActiveOptionPreviewId}
          onChooseOption={(option) => {
            void chooseMissionOption(option);
          }}
        />
      ) : !isReadOnly && isMissionContextReady && sessionLoaded && !sessionCompleted && !profileModalConfirmed ? (
        /* Single-page setup: read mission, (optionally) add pre-session info, start.
           The former 1-2-3 steps were near-identical pages; merged into one scroll. */
        <main className="flex flex-1 flex-col overflow-hidden">
          {missionOptions.length > 1 && (
            <div className="border-b border-slate-100 bg-white px-8 py-4">
              <div className="mx-auto flex max-w-3xl items-center">
                <button
                  type="button"
                  onClick={() => setSelectedOptionId(null)}
                  className="flex shrink-0 items-center gap-1 text-sm text-slate-400 transition hover:text-slate-700"
                >
                  <ArrowLeftIcon className="size-3.5" aria-hidden="true" />
                  옵션 다시 선택
                </button>
              </div>
            </div>
          )}
          <div className="flex-1 overflow-y-auto">
            <div className="mx-auto max-w-3xl space-y-6 px-8 py-8">
              <SetupMissionSummaryCard
                missionTitle={missionTitle}
                missionBrief={missionBrief}
                parentMissionTitle={parentMissionTitle}
                parentMissionBrief={parentMissionBrief}
                activeOption={activeOption}
                showOption={missionOptions.length > 1}
                missionDurationMinutes={missionDurationMinutes}
              />
              {!isOnboardingMission && (
                <>
                  <div className="flex justify-center">
                    <button
                      type="button"
                      onClick={() =>
                        document
                          .getElementById("setup-profile-input")
                          ?.scrollIntoView({
                            behavior: "smooth",
                            block: "start",
                          })
                      }
                      className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 px-4 py-2 text-sm font-medium text-slate-500 transition hover:border-slate-300 hover:text-slate-700"
                    >
                      다음: 사전 정보 입력
                      <ArrowDownIcon className="size-3.5" aria-hidden="true" />
                    </button>
                  </div>
                  <div id="setup-profile-input" className="scroll-mt-8">
                    <ProfileInputCard
                      value={profileRawMarkdown}
                      onChange={setProfileRawMarkdown}
                    />
                  </div>
                </>
              )}
            </div>
          </div>
          {/* Session start button */}
          <div className="border-t border-slate-200 bg-white px-8 py-4">
            <div className="mx-auto max-w-3xl">
              <Button
                disabled={profileSaving}
                onClick={async () => {
                  const currentUser = firebaseAuth.currentUser;
                  if (!currentUser || !missionId) return;
                  setProfileSaving(true);
                  try {
                    if (!isOnboardingMission) {
                      const token = await getIdToken(currentUser);
                      await fetch("/api/memory/profile", {
                        method: "POST",
                        headers: {
                          Authorization: `Bearer ${token}`,
                          "Content-Type": "application/json",
                        },
                        body: JSON.stringify({
                          missionId,
                          items: [],
                          rawMarkdown: profileRawMarkdown,
                          missionTitle:
                            parentMissionTitle ||
                            activeOption?.title ||
                            missionTitle ||
                            "",
                          missionBrief:
                            parentMissionBrief ||
                            missionBrief ||
                            activeOption?.description ||
                            "",
                        }),
                      });
                    }
                  } catch {
                    // non-blocking
                  } finally {
                    const startedAt = Date.now();
                    setProfileSaving(false);
                    setTimerStartedAt(startedAt);
                    setProfileModalConfirmed(true);
                    void persistSessionSnapshot(startedAt);
                  }
                }}
                className="h-auto w-full rounded-2xl py-3.5 text-sm font-semibold"
              >
                {profileSaving ? (
                  <>
                    <Spinner className="size-4" />
                    세션 준비 중…
                  </>
                ) : missionDurationMinutes ? (
                  `세션 시작하기 (${missionDurationMinutes}분)`
                ) : (
                  "세션 시작하기"
                )}
              </Button>
            </div>
          </div>
        </main>
      ) : (
        <main className="flex min-h-0 flex-1 overflow-hidden">
          {/* Left panel: content */}
          <section
            ref={missionPanelRef}
            data-tour="content-panel"
            className="flex-1 space-y-5 overflow-y-auto bg-slate-50 px-6 pb-32 pt-6"
          >
            <div className="sticky top-0 z-10 -mx-6 px-6 py-3">
              <div className="flex w-fit items-center gap-1 rounded-2xl border border-slate-200 bg-white p-1 shadow-sm">
                {[
                  { id: "mission", label: "Mission", ref: missionSectionRef },
                  {
                    id: "reference",
                    label: "Reference",
                    ref: referenceSectionRef,
                  },
                  {
                    id: "workspace",
                    label: "Workspace",
                    ref: workspaceSectionRef,
                  },
                  { id: "final", label: "Final", ref: finalSectionRef },
                ].map((section) => (
                  <button
                    key={section.id}
                    type="button"
                    onClick={() => {
                      leftPanelSectionLockUntilRef.current = Date.now() + 500;
                      setActiveLeftPanelSection(
                        section.id as
                          | "mission"
                          | "reference"
                          | "workspace"
                          | "final",
                      );
                      const panel = missionPanelRef.current;
                      const target = section.ref.current;
                      if (!panel || !target) return;
                      panel.scrollTo({
                        top: Math.max(target.offsetTop - 12, 0),
                        behavior: "smooth",
                      });
                    }}
                    className={`rounded-xl px-3 py-1.5 text-xs font-semibold transition ${
                      activeLeftPanelSection === section.id
                        ? "bg-slate-900 text-white"
                        : "text-slate-500 hover:bg-slate-100 hover:text-slate-800"
                    }`}
                  >
                    {section.label}
                  </button>
                ))}
              </div>
            </div>

            <div ref={missionSectionRef} className="scroll-mt-16">
              <MissionBriefSection
                title={parentMissionTitle || missionTitle}
                brief={parentMissionBrief || (!activeOption ? missionBrief : "")}
                option={activeOption}
                device={device}
                optionExpanded={isOptionExpanded}
                onToggleOption={() =>
                  setIsOptionExpanded((expanded) => !expanded)
                }
                selectedAssetImageIds={
                  new Set(selectedReferences.map((reference) => reference.id))
                }
                getAssetImageId={(image, index) =>
                  missionAssetImageReferenceId(activeOption?.id, image, index)
                }
                onToggleAssetImage={
                  isReadOnly
                    ? undefined
                    : (image, index) => {
                        const reference = missionAssetImageReference(
                          activeOption?.id,
                          image,
                          index,
                          parentMissionTitle || missionTitle,
                        );
                        setSelectedReferences((prev) =>
                          prev.some((selected) => selected.id === reference.id)
                            ? prev.filter(
                                (selected) => selected.id !== reference.id,
                              )
                            : [...prev, reference],
                        );
                      }
                }
              />
            </div>

            <div ref={referenceSectionRef} className="scroll-mt-16">
              <ReferenceSection
                references={references}
                selectedReferenceIds={
                  new Set(selectedReferences.map((reference) => reference.id))
                }
                fetching={isFetchingRefs}
                error={referenceSearchError}
                readOnly={isReadOnly}
                onToggleReference={(reference) => {
                  setSelectedReferences((prev) =>
                    prev.some((selected) => selected.id === reference.id)
                      ? prev.filter((selected) => selected.id !== reference.id)
                      : [...prev, reference],
                  );
                }}
                onDeleteReference={requestDeleteReference}
              />
            </div>

            <div ref={workspaceSectionRef} className="scroll-mt-16">
              <IdeaWorkspace
                title="디자인 시안"
                ideas={ideas}
                activeIdeaId={activeIdeaId}
                activeSectionId={activeIdeaTab}
                readOnly={isReadOnly}
                sections={[
                  { id: "idea", label: "Design Brief", ref: ideaSectionRef },
                  { id: "style", label: "Design Style", ref: styleSectionRef },
                  { id: "mockup", label: "Mockup", ref: mockupSectionRef },
                ]}
                onSwitchIdea={switchIdea}
                onDeleteIdea={requestDeleteIdea}
                onSelectSection={setActiveIdeaTab}
              >
                {(() => {
                  const idea =
                    ideas.find((i) => i.id === activeIdeaId) ?? null;
                  return (
                    <>
                      <IdeaNoteSection
                        sectionRef={ideaSectionRef}
                        description={idea?.description ?? ""}
                        expanded={isIdeaExpanded}
                        onToggleExpanded={() =>
                          setIsIdeaExpanded((expanded) => !expanded)
                        }
                      />

                      <DesignStyleSection
                        sectionRef={styleSectionRef}
                        style={idea?.designStyle}
                        open={isDesignSpecOpen}
                        onToggle={() => setIsDesignSpecOpen((open) => !open)}
                      />
                    </>
                  );
                })()}

              <MockupSection
                sectionRef={mockupSectionRef}
                hasArtboards={ideaArtboards.length > 0}
                editMode={editMode}
                selectedElement={selectedElement}
                canvasScale={canvasScale}
                activeArtboard={activeArtboard}
                shouldRenderCanvas={shouldRenderMockupCanvas}
                expanded={isMockupExpanded}
                generating={isGeneratingCurrentIdeaMockup}
                mockupOperation={mockupOperation}
                readOnly={isReadOnly}
                canvas={renderMockupCanvas()}
                onToggleEditMode={() => {
                  setEditMode((p) => {
                    if (p) clearSelectedElement();
                    return !p;
                  });
                }}
                onClearSelectedElement={clearSelectedElement}
                onFit={fitToCanvas}
                onZoomIn={() =>
                  setCanvasScale((scale) =>
                    Math.min(scale * 1.2, MAX_CANVAS_SCALE),
                  )
                }
                onZoomOut={() =>
                  setCanvasScale((scale) =>
                    Math.max(scale * 0.8, MIN_CANVAS_SCALE),
                  )
                }
                onExport={() => {
                  const html = activeArtboard?.html;
                  if (!html) return;
                  const blob = new Blob([html], {
                    type: "text/html",
                  });
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement("a");
                  a.href = url;
                  a.download = `${activeArtboard?.label ?? "mockup"}.html`;
                  a.click();
                  URL.revokeObjectURL(url);
                }}
                onExpand={() => setIsMockupExpanded(true)}
                onCancelGeneration={cancelMockupGeneration}
              />
              </IdeaWorkspace>
            </div>

            <div ref={finalSectionRef} className="scroll-mt-16">
              <FinalDesignSelector
                sectionRef={finalDesignSectionRef}
                ideas={ideas}
                artboards={artboards}
                finalArtboardId={finalArtboardId}
                readOnly={isReadOnly}
                onSelect={(board) => {
                  const next = board.id === finalArtboardId ? null : board.id;
                  setFinalArtboardId(next);
                }}
              />
            </div>
          </section>

          {/* Memory detail side panel */}
          {reviewDetailModal?.mode === "memory" && (
            <div className="flex w-72 shrink-0 flex-col overflow-hidden border-l border-slate-200 bg-white">
              <div className="flex shrink-0 items-center justify-between border-b border-slate-200 px-4 py-3">
                <div>
                  <p className="text-sm font-semibold text-slate-900">
                    참고한 메모리
                  </p>
                  <p className="text-xs text-slate-400">
                    turn {reviewDetailModal.turnId}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setReviewDetailModal(null)}
                  className="rounded-full p-1.5 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
                  aria-label="메모리 상세 닫기"
                >
                  <XIcon size={14} />
                </button>
              </div>
              <div className="flex-1 space-y-2 overflow-y-auto p-4">
                {reviewDetailModal.memories.length === 0 ? (
                  <p className="rounded-xl bg-slate-50 px-3 py-2 text-sm text-slate-400">
                    참고한 메모리가 없습니다.
                  </p>
                ) : (
                  reviewDetailModal.memories.map((memory) => {
                    const archiveStatus =
                      reviewMemoryArchiveById[memory.memoryId];
                    const isArchived = Boolean(archiveStatus?.archivedAt);
                    const memoryFields = [
                      { label: "Semantic", value: memory.semantic },
                      { label: "Episodic", value: memory.episodic },
                      { label: "Input", value: memory.input },
                      { label: "Output", value: memory.output },
                      { label: "Action", value: memory.action },
                      {
                        label: "Keyword",
                        value:
                          Array.isArray(memory.keyword) &&
                          memory.keyword.length > 0
                            ? memory.keyword.join(", ")
                            : "",
                      },
                      { label: "Link", value: memory.link },
                    ].filter(
                      (field) =>
                        typeof field.value === "string" && field.value.trim(),
                    ) as Array<{ label: string; value: string }>;
                    return (
                      <div
                        key={memory.memoryId}
                        className="rounded-xl border border-slate-200 bg-white px-3 py-2.5"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0 flex-1 space-y-1.5">
                            {memoryFields.length === 0 ? (
                              <p className="text-xs text-slate-400">
                                내용 없는 메모리
                              </p>
                            ) : (
                              memoryFields.map((field) => (
                                <div
                                  key={field.label}
                                  className="rounded-lg bg-slate-50 px-2.5 py-1.5"
                                >
                                  <p className="text-[10px] font-bold uppercase text-slate-400">
                                    {field.label}
                                  </p>
                                  <p className="mt-0.5 whitespace-pre-wrap wrap-break-word text-xs leading-relaxed text-slate-700">
                                    {field.value}
                                  </p>
                                </div>
                              ))
                            )}
                          </div>
                          {isArchived && (
                            <span className="shrink-0 rounded-full bg-rose-50 px-1.5 py-0.5 text-[10px] font-semibold text-rose-500">
                              archived
                            </span>
                          )}
                        </div>
                        <div className="mt-1.5 flex flex-wrap gap-1.5 text-[10px] font-semibold text-slate-400">
                          {formatWeightStrength(memory.weight) && (
                            <span className="text-slate-500">
                              {formatWeightStrength(memory.weight)}
                            </span>
                          )}
                          <span>weight {formatReviewScore(memory.weight)}</span>
                          {memory.weightDelta != null && (
                            <span
                              className={
                                memory.weightDelta >= 0
                                  ? "text-emerald-500"
                                  : "text-slate-400"
                              }
                            >
                              delta {formatReviewDelta(memory.weightDelta)}
                            </span>
                          )}
                          <span>
                            sim {formatReviewScore(memory.similarity)}
                          </span>
                        </div>
                        {isArchived && archiveStatus && (
                          <div className="mt-2 rounded-lg border border-rose-100 bg-rose-50 px-2.5 py-1.5 text-[10px] leading-relaxed text-rose-700">
                            <span className="font-semibold">
                              {archiveStatus.archiveReason ?? "archived"}
                            </span>
                            {archiveStatus.duplicate && (
                              <p className="mt-1 wrap-break-word text-rose-500">
                                similarTo {archiveStatus.duplicate.memoryId}
                              </p>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          )}

          {/* Turn memory side panel */}
          {reviewDetailModal?.mode === "turn-memory" && reviewDetailModal.turnDraft && (
            <div className="flex w-72 shrink-0 flex-col overflow-hidden border-l border-slate-200 bg-white">
              <div className="flex shrink-0 items-center justify-between border-b border-slate-200 px-4 py-3">
                <div className="flex items-center gap-2">
                  <BrainIcon size={14} className="shrink-0 text-violet-500" />
                  <div>
                    <p className="text-sm font-semibold text-slate-900">
                      생성된 기억
                    </p>
                    <p className="text-xs text-slate-400">
                      turn {reviewDetailModal.turnId.slice(0, 8)}
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setReviewDetailModal(null)}
                  className="rounded-full p-1.5 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
                  aria-label="기억 상세 닫기"
                >
                  <XIcon size={14} />
                </button>
              </div>
              <div className="flex-1 space-y-3 overflow-y-auto p-4">
                {reviewDetailModal.turnDraft.episodic && (
                  <div className="rounded-xl bg-slate-50 px-3 py-2.5">
                    <p className="mb-1 text-[10px] font-bold uppercase text-slate-400">
                      Episodic
                    </p>
                    <p className="text-xs leading-relaxed text-slate-700 whitespace-pre-wrap">
                      {reviewDetailModal.turnDraft.episodic}
                    </p>
                  </div>
                )}
                {reviewDetailModal.turnDraft.semantic && (
                  <div className="rounded-xl bg-violet-50 px-3 py-2.5">
                    <p className="mb-1 text-[10px] font-bold uppercase text-violet-400">
                      Semantic
                    </p>
                    <p className="text-xs leading-relaxed text-slate-700 whitespace-pre-wrap">
                      {reviewDetailModal.turnDraft.semantic}
                    </p>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Resize handle between content and chat */}
          <div
            role="separator"
            aria-orientation="vertical"
            aria-label="채팅 창 크기 조절"
            onPointerDown={startChatResize}
            className="group relative w-1 shrink-0 cursor-col-resize bg-slate-100 transition-colors hover:bg-indigo-300"
          >
            <span className="absolute inset-y-0 -left-1 -right-1" />
          </div>

          {/* Right panel: agent chat */}
          <ChatPanel
            width={chatWidth}
            showReviewTabs={showReviewAnnotations}
            activeTab={rightPanelTab}
            messageCount={messages.length}
            beforeMemoryCount={beforeSessionMemoryImpact.availableCount}
            showScrollToBottom={showScrollToBottom}
            onTabChange={setRightPanelTab}
            onScrollToBottom={() => {
              const element = chatScrollRef.current;
              if (element) element.scrollTop = element.scrollHeight;
            }}
          >
            {/* Before-session memory panel */}
            {showReviewAnnotations && rightPanelTab === "before" && (
              <div className="min-h-0 flex-1 overflow-y-auto p-5">
                {/* Original raw input — shown once at top */}
                {(() => {
                  const rawInput =
                    beforeSessionMemoryImpact.items.find(
                      ({ memory }) => memory.input,
                    )?.memory.input ??
                    reviewProfileItems.find((item) => item.input)?.input;
                  return rawInput ? (
                    <div className="mb-5 rounded-xl border border-slate-100 bg-slate-50 px-4 py-3">
                      <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                        원래 입력한 내용
                      </p>
                      <p className="text-sm leading-relaxed text-slate-700">
                        {rawInput}
                      </p>
                    </div>
                  ) : null;
                })()}

                {beforeSessionMemoryImpact.availableCount > 0 ? (
                  <div className="space-y-3">
                    {beforeSessionMemoryImpact.items.map(
                      ({ memory }) => (
                        <MemoryCard
                          key={memory.id}
                          summary={memorySummaryText(memory)}
                          fields={[
                            memory.episodic
                              ? { label: "Episodic", value: memory.episodic }
                              : null,
                            memory.semantic
                              ? { label: "Semantic", value: memory.semantic }
                              : null,
                          ].filter(
                            (field): field is { label: string; value: string } =>
                              field !== null,
                          )}
                          weightStrengthLabel={
                            memory.weight != null
                              ? formatWeightStrength(memory.weight)
                              : null
                          }
                          weightScoreLabel={
                            memory.weight != null
                              ? formatReviewScore(memory.weight)
                              : null
                          }
                          onClick={() => {
                            setSelectedGraphMemoryId(memory.id);
                            setIsMemoryDiffOpen(true);
                          }}
                        />
                      ),
                    )}
                  </div>
                ) : reviewProfileItems.length === 0 ? (
                  <p className="text-xs text-slate-400">
                    이 미션에 입력한 정보가 없습니다.
                  </p>
                ) : (
                  <div className="space-y-2 rounded-xl border border-dashed border-slate-200 bg-slate-50 p-4">
                    <p className="text-[11px] leading-relaxed text-slate-400">
                      세션 전 입력은 있지만 아직 graph memory로 반영된 항목이
                      없습니다.
                    </p>
                    {reviewProfileItems.map((item) => (
                      <div key={item.id} className="flex gap-3">
                        <div className="mt-1 h-2 w-2 shrink-0 rounded-full bg-sky-400" />
                        <p className="text-xs leading-relaxed text-slate-700">
                          {item.input}
                        </p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
            {/* Messages */}
            <div
              ref={chatScrollRef}
              className={`min-h-0 flex-1 space-y-4 overflow-y-auto p-6 ${
                showReviewAnnotations && rightPanelTab === "before"
                  ? "hidden"
                  : ""
              }`}
            >
              {messages.length === 0 && (
                <div className="flex h-full flex-col items-center justify-center gap-4 text-center text-sm text-slate-400">
                  <div className="flex flex-col gap-1">
                    <p className="font-medium text-slate-500">디자인 에이전트</p>
                    <p>레퍼런스 탐색, 시안, 디자인 스타일과 목업 생성을 도와드립니다.</p>
                  </div>
                  <div className="w-full max-w-sm rounded-2xl border border-slate-200 bg-white p-4 text-left">
                    <ChatCapabilityCatalog
                      commands={composerCommandOptions}
                      onPick={(command) => {
                        setComposerCommand(command);
                        setInputText((current) =>
                          current.trim()
                            ? current
                            : `${command.label} `,
                        );
                        chatInputRef.current?.focus();
                      }}
                    />
                  </div>
                </div>
              )}

              {reviewTimelineItems.map((timelineItem) => {
                if (timelineItem.type === "activity-event") {
                  const event = timelineItem.event;
                  return (
                    <TimelineActivityEventCard
                      key={`activity-event-${event.id}`}
                      label={activityEventLabel(event)}
                      detail={activityEventDetail(event)}
                    />
                  );
                }
                if (timelineItem.type === "memory-event") {
                  const memory = timelineItem.memory;
                  const eventKey = memoryEventKey(memory);
                  const isEventSelected =
                    reviewDetailModal?.mode === "turn-memory" &&
                    reviewDetailModal.turnId === eventKey;
                  return (
                    <TimelineMemoryEventCard
                      key={`memory-event-${eventKey}`}
                      label={memoryEventLabel(memory)}
                      detail={memoryEventDetail(memory)}
                      selected={isEventSelected}
                      onToggle={() =>
                        setReviewDetailModal(
                          isEventSelected
                            ? null
                            : {
                                mode: "turn-memory",
                                turnId: eventKey,
                                reviewTurn: {} as ReviewTurn,
                                memories: [],
                                turnDraft: memory,
                              },
                        )
                      }
                    />
                  );
                }
                const msg = timelineItem.message;
                const isLastMessage = msg.id === messages.at(-1)?.id;
                const reviewTurn =
                  msg.role === "assistant"
                    ? reviewTurnsById[msg.reviewTurnId ?? msg.id]
                    : null;
                const retrievedReviewMemories = reviewTurn?.retrieved ?? [];
                const reviewTurnId = msg.reviewTurnId ?? msg.id;
                const turnMemoryDraft = showReviewAnnotations && msg.role === "assistant"
                  ? sessionMemorySummary.drafts.find((d) => d.id === reviewTurnId) ??
                    sessionMemorySummary.promoted.find(
                      (d) => d.id === reviewTurnId || d.source?.draftId === reviewTurnId,
                    )
                  : null;
                const isTurnSelected = reviewDetailModal?.mode === "turn-memory" && reviewDetailModal.turnId === reviewTurnId;
                const streamingChatPhases =
                  msg.role === "assistant" &&
                  isLoading &&
                  isLastMessage
                    ? chatPhasesByMessageId[msg.id] ?? []
                    : [];
                const visibleChatPhases =
                  streamingChatPhases.length > 0
                    ? streamingChatPhases
                    : (msg.chatPhases ?? []);
                const contentParts = processMessageContent(msg.content);
                const isStreamingThis =
                  msg.role === "assistant" && isLoading && isLastMessage;
                const isChatPhaseExpanded =
                  isStreamingThis
                    ? !collapsedChatPhaseIds.has(msg.id)
                    : expandedChatPhaseIds.has(msg.id);
                return (
                  <ChatBubble
                    key={msg.id}
                    message={msg}
                    contentParts={contentParts}
                    visibleChatPhases={visibleChatPhases}
                    isStreaming={isStreamingThis}
                    isTurnSelected={isTurnSelected}
                    isChatPhaseExpanded={isChatPhaseExpanded}
                    expandedChipKeys={expandedChips}
                    markdownComponents={CHAT_MARKDOWN_COMPONENTS}
                    remarkPlugins={CHAT_REMARK_PLUGINS}
                    adminMemoryCount={
                      msg.role === "assistant" &&
                      isViewingAsAdmin &&
                      reviewTurn
                        ? retrievedReviewMemories.length
                        : 0
                    }
                    hasTurnMemory={Boolean(
                      msg.role === "assistant" &&
                        turnMemoryDraft &&
                        (turnMemoryDraft.episodic ||
                          turnMemoryDraft.semantic),
                    )}
                    hasRawPrompt={Boolean(
                      msg.role === "assistant" &&
                        isViewingAsAdmin &&
                        reviewTurn?.rawPrompt != null,
                    )}
                    isReferenceLoading={
                      msg.role === "assistant" &&
                      referenceLoadingMessageId === msg.id
                    }
                    onToggleChatPhases={() =>
                      isStreamingThis
                        ? setCollapsedChatPhaseIds((prev) => {
                            const next = new Set(prev);
                            if (next.has(msg.id)) next.delete(msg.id);
                            else next.add(msg.id);
                            return next;
                          })
                        : setExpandedChatPhaseIds((prev) => {
                            const next = new Set(prev);
                            if (next.has(msg.id)) next.delete(msg.id);
                            else next.add(msg.id);
                            return next;
                          })
                    }
                    onToggleChip={(key) =>
                      setExpandedChips((prev) => {
                        const next = new Set(prev);
                        if (next.has(key)) next.delete(key);
                        else next.add(key);
                        return next;
                      })
                    }
                    onShowRetrievedMemory={() => {
                      if (!reviewTurn) return;
                      setReviewDetailModal({
                        mode: "memory",
                        turnId: reviewTurnId,
                        reviewTurn,
                        memories: retrievedReviewMemories,
                      });
                    }}
                    onToggleTurnMemory={() =>
                      setReviewDetailModal(
                        isTurnSelected || !turnMemoryDraft
                          ? null
                          : {
                              mode: "turn-memory",
                              turnId: reviewTurnId,
                              reviewTurn: reviewTurn ?? ({} as ReviewTurn),
                              memories: [],
                              turnDraft: turnMemoryDraft,
                            },
                      )
                    }
                    onShowRawPrompt={() => {
                      if (!reviewTurn?.rawPrompt) return;
                      setRawPromptModal({
                        turnId: reviewTurnId,
                        rawPrompt: reviewTurn.rawPrompt,
                        rawPromptSanitization:
                          reviewTurn.rawPromptSanitization,
                        rawResponseMeta: reviewTurn.rawResponseMeta,
                      });
                    }}
                  />
                );
              })}
            </div>

            <ChatInput
              ref={chatInputRef}
              readOnly={isReadOnly}
              selectedElement={selectedElement}
              citedTexts={citedTexts}
              selectedReferences={selectedReferences}
              styleImage={attachedStyleImage}
              inputText={inputText}
              composerCommand={composerCommand}
              composerMention={composerMention}
              commandOptions={composerCommandOptions}
              mentionOptions={composerMentionOptions}
              missionContextReady={isMissionContextReady}
              generatingMockup={isGeneratingMockup}
              loading={isLoading}
              generatingCurrentIdeaMockup={generatingMockupIdeaId === activeIdeaId}
              mockupOperation={mockupOperation}
              onClearSelectedElement={clearSelectedElement}
              onClearCitedTexts={() => setCitedTexts([])}
              onRemoveCitedText={(index) =>
                setCitedTexts((prev) => prev.filter((_, j) => j !== index))
              }
              onClearSelectedReferences={() => setSelectedReferences([])}
              onRemoveSelectedReference={(id) =>
                setSelectedReferences((prev) =>
                  prev.filter((reference) => reference.id !== id),
                )
              }
              onAttachStyleImage={handleAttachStyleImage}
              onClearStyleImage={() => setAttachedStyleImage(null)}
              onInputTextChange={setInputText}
              onCancelMockupGeneration={cancelMockupGeneration}
              onCancelMessage={cancelMessage}
              onSendMessage={sendMessage}
              onSelectComposerCommand={setComposerCommand}
              onClearComposerCommand={() => setComposerCommand(null)}
              onSelectComposerMention={(mention) => {
                setComposerMention(mention);
                if (mention.ideaId !== activeIdeaId) {
                  switchIdea(mention.ideaId, true);
                }
              }}
              onClearComposerMention={() => setComposerMention(null)}
            />
          </ChatPanel>
        </main>
      )}

      {isMemoryDiffOpen && (
        <SessionMemoryDiff
          toolbar={memoryPhaseToggle}
          onClose={() => setIsMemoryDiffOpen(false)}
        >
          {renderSessionImpactGraph("overlay")}
        </SessionMemoryDiff>
      )}

      {/* Mockup expanded canvas: keep the chat panel visible */}
      {isMockupExpanded && (
        <div
          className="fixed inset-y-0 left-0 right-0 z-40 flex flex-col bg-[#1a1a1a] md:right-[var(--chat-w,28rem)]"
          style={{
            backgroundImage:
              "radial-gradient(circle, #383838 1px, transparent 1px)",
            backgroundSize: "20px 20px",
          }}
        >
          {/* Overlay header */}
          <div className="flex items-center justify-between bg-slate-900/80 px-5 py-3 backdrop-blur">
            <div className="flex items-center gap-3">
              {!isReadOnly && (
                <button
                  onClick={() => {
                    setEditMode((prev) => {
                      if (prev) clearSelectedElement();
                      return !prev;
                    });
                  }}
                  className={`rounded border px-2 py-1 text-xs font-semibold transition ${
                    editMode
                      ? "border-indigo-300 bg-indigo-500/20 text-indigo-100"
                      : "border-white/20 text-white/70 hover:bg-white/10"
                  }`}
                >
                  {editMode ? "영역 선택 On" : "영역 선택 Off"}
                </button>
              )}
              <button
                onClick={fitToCanvas}
                className="rounded border border-white/20 px-2 py-1 text-xs text-white/70 hover:bg-white/10"
              >
                Fit
              </button>
              <button
                onClick={() =>
                  setCanvasScale((s) => Math.min(s * 1.2, MAX_CANVAS_SCALE))
                }
                className="rounded border border-white/20 px-2 py-1 text-xs text-white/70 hover:bg-white/10"
              >
                +
              </button>
              <button
                onClick={() =>
                  setCanvasScale((s) => Math.max(s * 0.8, MIN_CANVAS_SCALE))
                }
                className="rounded border border-white/20 px-2 py-1 text-xs text-white/70 hover:bg-white/10"
              >
                −
              </button>
              <span className="text-xs text-white/40">
                {Math.round(canvasScale * 100)}%
              </span>
            </div>
            <button
              onClick={() => setIsMockupExpanded(false)}
              className="flex items-center gap-1.5 rounded-full bg-white/10 px-3 py-1.5 text-xs text-white hover:bg-white/20"
            >
              <Minimize2Icon size={14} /> 축소
            </button>
          </div>

          {/* Canvas */}
          {renderMockupCanvas(true)}
        </div>
      )}

      {/* Lobby navigation warning */}
      {showLobbyWarning && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
          <div className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-xl">
            <h2 className="mb-2 text-base font-semibold text-slate-900">
              세션이 아직 종료되지 않았어요
            </h2>
            <p className="mb-6 text-sm leading-relaxed text-slate-600">
              <strong>세션 종료</strong> 버튼을 누르지 않으면 이번 세션의
              메모리가 저장되지 않을 수 있습니다. 계속 나가시겠어요?
            </p>
            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => setShowLobbyWarning(false)}
                className="flex-1 rounded-full border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
              >
                취소
              </button>
              <button
                type="button"
                onClick={() => router.push("/lobby")}
                className="flex-1 rounded-full bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-700"
              >
                그냥 나가기
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
