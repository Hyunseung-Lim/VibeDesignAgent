export type MemorySourceLink = {
  title?: string;
  url?: string;
  description?: string;
  rationale?: string;
  imageUrl?: string;
  referenceMode?: "style" | "product";
  searchProvider?: string;
  referencePurpose?: string;
  referencePurposeLabel?: string;
  analysis?: string;
};

export type MemorySourceUiResult = {
  artboardId?: string;
  selector?: string;
  html?: string;
};

export type MemoryDraftSources = {
  texts?: string[];
  links?: MemorySourceLink[];
  image?: { dataUrl?: string; name?: string } | null;
  uiResult?: MemorySourceUiResult | null;
};
