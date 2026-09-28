import { baseName } from "./names";
import type { EntryKind } from "./types";

/** Trimmed, split on whitespace, lower-cased; [] is "no query". */
export function queryTerms(text: string): string[] {
  const trimmed = text.trim().toLowerCase();
  return trimmed === "" ? [] : trimmed.split(/\s+/);
}

/**
 * Every term is a substring of one of the subject's names. Shared by the server's
 * search and the client's Narrow filter, so typing and submitting cannot drift
 * apart (`file-search`, *Names match term by term*).
 */
export function matchesTerms(
  terms: readonly string[],
  subject: {
    name: string;
    kind: EntryKind;
    displayName?: string;
    ancestorNames?: readonly (string | null)[];
  },
  folderMatching: boolean,
): boolean {
  // Containers match on their own names only, or one hit returns a subtree of tiles.
  const alongPath = subject.kind === "model" && folderMatching;
  const names = [alongPath ? subject.name : baseName(subject.name)];
  if (subject.displayName !== undefined) names.push(subject.displayName);
  if (alongPath && subject.ancestorNames !== undefined) {
    for (const n of subject.ancestorNames) if (n !== null) names.push(n);
  }
  // Tested per name, never joined: a term must not match across two names.
  const lowered = names.map((n) => n.toLowerCase());
  return terms.every((t) => lowered.some((n) => n.includes(t)));
}
