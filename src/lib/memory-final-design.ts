// Shared contract for the final-design memory "input enrichment" pass.
//
// At session end the client sends the chosen artboard plus every candidate
// artboard (the boards the user actually compared in the Final Design picker)
// and a transcript of the session chat. The server runs a single LLM pass that
// investigates each board's HTML directly (copy / structure / UI style — design
// style metadata is intentionally ignored, since one 시안 can have several
// mockups that the style does not uniformly cover) and pulls out what the user
// expressed liking in chat. The result becomes the memory draft `input`, so the
// existing semantic encoder can infer the preference without us touching its
// prompt.

export type FinalDesignDeviceInput = "desktop" | "mobile";

export type FinalDesignBoardInput = {
  artboardId: string;
  ideaTitle: string;
  label: string;
  device: FinalDesignDeviceInput;
  html: string;
  /** True for the board confirmed as the final design. */
  chosen: boolean;
};

export type FinalDesignChatExcerpt = {
  role: "user" | "assistant";
  content: string;
};

export type FinalDesignEnrichmentPayload = {
  /** Chosen board first is not required; each board carries a `chosen` flag. */
  boards: FinalDesignBoardInput[];
  /** Session chat in chronological order, already cleaned of UI markup. */
  chat: FinalDesignChatExcerpt[];
};
