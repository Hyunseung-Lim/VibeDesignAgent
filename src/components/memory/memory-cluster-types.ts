export type MemoryItem = {
  id: string;
  episodic: string | null;
  semantic: string | null;
  input: string | null;
  output: string | null;
  action: string | null;
  keywords: string[];
  weight: number | null;
  embedding?: number[];
  timestamp: number | null;
  archivedAt: number | null;
  archiveReason: string | null;
  source: { missionId?: string; draftId?: string } | null;
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

export type ClusterGraphItem = {
  id: string;
  memoryId: string;
  semantic: string;
  episodic: string;
  input: string;
  output: string;
  action: string;
  weight?: number | null;
  embedding?: number[];
  timestamp: number;
  keyword: string[];
  keywords: string[];
  row: {
    source?: { missionId?: string; draftId?: string };
  };
};
