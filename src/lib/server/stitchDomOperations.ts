// Stitch edit_screens does not persist edited screen HTML back to the screen
// resource: the edit agent emits the change as DOM patch operations inside a
// sessionEvent output component, and the Stitch web UI applies them to its
// canvas (dev_document 15.257). These helpers extract those operations from a
// raw edit_screens response and apply them to the screen HTML we already have,
// so the app can harvest the edit result directly.

import * as cheerio from "cheerio";

export type StitchDomOperation = {
  action?: string;
  selector?: string;
  content?: string;
  attr_name?: string;
  attr_value?: string;
  class_name?: string;
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : {};
}

// sessionEvent arrives as a JSON string (observed) or an object; its
// eventPayload.dom_operations carries the patch list. Components without a
// parsable sessionEvent are ignored.
export function extractStitchDomOperations(raw: unknown): StitchDomOperation[] {
  const components = asRecord(raw).outputComponents;
  if (!Array.isArray(components)) return [];

  const operations: StitchDomOperation[] = [];
  for (const component of components) {
    let event: unknown = asRecord(component).sessionEvent;
    if (typeof event === "string") {
      try {
        event = JSON.parse(event);
      } catch {
        continue;
      }
    }
    const domOperations = asRecord(asRecord(event).eventPayload).dom_operations;
    if (!Array.isArray(domOperations)) continue;
    for (const operation of domOperations) {
      if (operation && typeof operation === "object") {
        operations.push(operation as StitchDomOperation);
      }
    }
  }
  return operations;
}

export type AppliedDomOperations = {
  html: string;
  appliedCount: number;
  failedCount: number;
  failures: string[];
};

// Only replace_element has been observed so far; the other actions cover the
// obvious sibling shapes of the same payload. Unknown actions and unmatched
// selectors are reported as failures instead of throwing, so a partially
// applicable event still patches what it can.
export function applyStitchDomOperations(
  html: string,
  operations: StitchDomOperation[],
): AppliedDomOperations {
  const $ = cheerio.load(html);
  let appliedCount = 0;
  const failures: string[] = [];

  for (const operation of operations) {
    const action = operation.action ?? "";
    const selector = operation.selector ?? "";
    let target: cheerio.Cheerio<never> | null = null;
    try {
      target = selector ? ($(selector).first() as cheerio.Cheerio<never>) : null;
    } catch {
      target = null;
    }
    if (!target || target.length === 0) {
      failures.push(`${action || "unknown"}: selector not found (${selector})`);
      continue;
    }

    if (action === "replace_element" && operation.content) {
      target.replaceWith(operation.content);
      appliedCount += 1;
    } else if (action === "remove_element") {
      target.remove();
      appliedCount += 1;
    } else if (action === "set_attribute" && operation.attr_name) {
      target.attr(operation.attr_name, operation.attr_value ?? "");
      appliedCount += 1;
    } else if (
      (action === "replace_content" || action === "set_content") &&
      typeof operation.content === "string"
    ) {
      target.html(operation.content);
      appliedCount += 1;
    } else if (action === "add_class" && operation.class_name) {
      target.addClass(operation.class_name);
      appliedCount += 1;
    } else if (action === "remove_class" && operation.class_name) {
      target.removeClass(operation.class_name);
      appliedCount += 1;
    } else {
      failures.push(`unsupported action: ${action || "unknown"}`);
    }
  }

  return {
    html: $.html(),
    appliedCount,
    failedCount: failures.length,
    failures,
  };
}
