export type MemoryItem = {
  id: string;
  episodic: string | null;
  semantic: string | null;
  input: string | null;
  output: string | null;
  originalInteractionContent?: string | null;
  action: string | null;
  sourceType: string | null;
  keywords: string[];
  weight: number | null;
  embedding?: number[];
  timestamp: number | null;
  archivedAt: number | null;
  archiveReason: string | null;
  source: { missionId?: string; draftId?: string } | null;
  // 0.0–1.0: how well the interaction supported the semantic interpretation
  // (low = speculative over-reading). null for legacy memories.
  interpretationConfidence?: number | null;
};

export type MemoryCluster = {
  id: string;
  label: string;
  summary: string;
  count: number;
  relatedActions: string[];
  itemIds: string[];
  representativeItems: string[];
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
  sourceType?: string | null;
  weight?: number | null;
  embedding?: number[];
  timestamp: number;
  keyword: string[];
  keywords: string[];
  interpretationConfidence?: number | null;
  row: {
    source?: { missionId?: string; draftId?: string };
  };
};
