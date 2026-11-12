import { eq } from 'drizzle-orm';

const url = process.env.TURSO_DATABASE_URL;
function isLocalFile(value: string | undefined): value is string {
  if (!value || !value.startsWith('file:') || value.includes('?') || value.includes('#')) return false;
  const path = value.slice(5);
  if (!path || (path.startsWith('//') && (!path.startsWith('///') || path.startsWith('////')))) return false;
  try {
    const decoded = decodeURIComponent(path);
    return !decoded.includes('\0') && !decoded.includes('?') && !decoded.includes('#') && !decoded.includes(':memory:');
  } catch { return false; }
}

if (!isLocalFile(url)) {
  console.error('Seed requires an explicit local file: TURSO_DATABASE_URL');
  process.exitCode = 1;
} else {
  const clientModule = '../src/db/client.ts';
  const schemaModule = '../src/db/schema.ts';
  const draftsModule = '../src/lib/drafts.ts';
  const { createDatabase } = await import(clientModule) as typeof import('../src/db/client');
  const { posts } = await import(schemaModule) as typeof import('../src/db/schema');
  const { createDraft, publishDraft } = await import(draftsModule) as typeof import('../src/lib/drafts');
  const { db, client } = createDatabase(url, '');
  try {
    const created = await db.transaction(async tx => {
      const slug = 'que-es-una-ventana-de-contexto';
      if ((await tx.select({ id: posts.id }).from(posts).where(eq(posts.slug, slug)).limit(1)).length) return false;
      // The shared draft helpers use the transaction-compatible database API.
      const draftDb = tx as unknown as Parameters<typeof createDraft>[0];
      const draft = await createDraft(draftDb, {
        slug,
        title: '¿Qué es una ventana de contexto?',
        excerpt: 'Una forma sencilla de entender qué información puede tener en cuenta un modelo de lenguaje.',
        content: `Un modelo de lenguaje recibe texto y predice cómo continuarlo. Para responder, utiliza la información que cabe en su ventana de contexto: una cantidad limitada de texto disponible en ese momento.\n\nEse texto se divide en tokens, que pueden ser palabras o partes de palabras. Las instrucciones, la conversación y la respuesta comparten ese espacio. Si la conversación crece demasiado, no todo el texto anterior puede caber a la vez.\n\nPrueba la siguiente ilustración para explorar la idea. Es una simplificación educativa, no una representación exacta de un modelo.\n\n\`\`\`context-window\n\`\`\`\n\nEn la práctica, el límite y la manera de manejar conversaciones largas dependen del modelo y de la aplicación.`,
        tags: ['Inteligencia artificial'],
        coverImage: null,
      });
      await publishDraft(draftDb, draft.id);
      return true;
    });
    console.log(created ? 'Example article created' : 'Example article already exists; no changes made');
  } finally { client.close(); }
}
