export type MemorySource = {
  missionId?: string;
  draftId?: string;
  missionTitle?: string;
  sourceText?: string;
};

export type MemoryItem = {
  id: string;
  episodic: string | null;
  semantic: string | null;
  input: string | null;
  output: string | null;
  originalInteractionContent?: string | null;
  action: string | null;
  preferenceSignal?: unknown;
  sourceType: string | null;
  keywords: string[];
  weight: number | null;
  embedding?: number[];
  timestamp: number | null;
  archivedAt: number | null;
  archiveReason: string | null;
  inactiveReason?: string | null;
  inactiveReasonDetail?: string | null;
  source: MemorySource | null;
};

export type MemoryCluster = {
  id: string;
  label: string;
  summary: string;
  count: number;
  relatedActions: string[];
  itemIds: string[];
  representativeItems: string[];
  colorIndex?: number;
  /**
   * True for pseudo-groups (e.g. 비활성 메모리) that are not real similarity
   * clusters — the graph skips the enclosing hull/area for them.
   */
  hideArea?: boolean;
};

export type ClusterGraphEdge = {
  sourceId: string;
  targetId: string;
  weight: number;
};

export type ClusterGraphItem = {
  id: string;
  memoryId: string;
  semantic: string;
  episodic: string;
  input: string;
  output: string;
  originalInteractionContent?: string;
  action: string;
  preferenceSignal?: unknown;
  sourceType?: string | null;
  weight?: number | null;
  embedding?: number[];
  timestamp: number;
  archivedAt?: number | null;
  archiveReason?: string | null;
  inactive?: boolean;
  /**
   * True면 caller가 활성/비활성을 이미 확정한 것이다(예: 세션 리뷰가 phase
   * snapshot 멤버십으로 그 시점 상태를 판정). 표시 계층은 weight/archivedAt
   * 휴리스틱으로 재판정하지 않고 inactive 값을 그대로 믿어야 한다 — 과거
   * 세션 리뷰에서 현재 문서 상태가 당시 상태를 덮어쓰는 것을 막는다(15.345).
   */
  inactiveResolved?: boolean;
  inactiveReason?: string | null;
  inactiveReasonDetail?: string | null;
  /**
   * 리뷰에서 staging된 활성/비활성 토글. 제출 전까지 서버에 반영되지 않은
   * 상태임을 카드 배지로 알리는 데 쓴다.
   */
  pendingActivation?: "activate" | "deactivate" | null;
  keyword: string[];
  keywords: string[];
  row: {
    source?: MemorySource;
  };
};
