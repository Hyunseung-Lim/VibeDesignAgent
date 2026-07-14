// Mockup edit history lives inline on activityLog events (previousHtml =
// pre-edit HTML; the post-edit HTML is the next event's previousHtml, or the
// artboard's current html for the latest edit). The whole session persists as
// ONE Firestore document (1MiB limit) alongside messages and artboard HTML,
// so the history must yield before it can break session saves: when the
// combined size of history fields exceeds the budget, drop previousHtml from
// the OLDEST events first and mark them so analysis can tell "trimmed" apart
// from "never recorded".

export type HtmlHistoryEvent = {
  previousHtml?: string;
  previousHtmlTrimmed?: boolean;
  html?: string;
};

// ~35KB per mockup HTML observed; 300k chars keeps roughly 8-20 edits of
// history while leaving ample headroom for messages + artboards in the 1MiB
// session document.
export const ACTIVITY_LOG_HTML_BUDGET_CHARS = 300_000;

export function trimActivityLogHtmlForSave<T extends HtmlHistoryEvent>(
  events: T[],
  budgetChars = ACTIVITY_LOG_HTML_BUDGET_CHARS,
): T[] {
  let total = 0;
  for (const event of events) {
    total += (event.previousHtml?.length ?? 0) + (event.html?.length ?? 0);
  }
  if (total <= budgetChars) return events;

  const trimmed = events.map((event) => ({ ...event }));
  for (const event of trimmed) {
    if (total <= budgetChars) break;
    if (event.previousHtml) {
      total -= event.previousHtml.length;
      delete event.previousHtml;
      event.previousHtmlTrimmed = true;
    }
    if (total > budgetChars && event.html) {
      total -= event.html.length;
      delete event.html;
      event.previousHtmlTrimmed = true;
    }
  }
  return trimmed;
}
