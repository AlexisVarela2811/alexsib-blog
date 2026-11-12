/** Trim entries, discard empty entries, and preserve order and duplicates. */
export function parseTags(text: string): string[] {
  return text.split(',').map((tag) => tag.trim()).filter(Boolean);
}

export function formatTags(tags: string[]): string {
  return tags.map((tag) => tag.trim()).filter(Boolean).join(', ');
}
