// Pure helper for the editor form: appends one uploaded image reference to the
// draft Markdown. Only the exact path shape the guarded upload route answers —
// /media/<uuid>, served privately by /media/[id] — is accepted, so an
// unexpected or malicious answer can never inject an arbitrary URL or text
// into the article. Server-safe: the Node native runner imports it directly.
const mediaPath = /^\/media\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function insertImageReference(markdown: string, path: string): string {
  if (typeof markdown !== 'string' || typeof path !== 'string' || !mediaPath.test(path)) {
    throw new Error('Invalid image reference');
  }
  const base = markdown.replace(/\s+$/, '');
  return `${base ? `${base}\n\n` : ''}![Imagen](${path})\n`;
}
