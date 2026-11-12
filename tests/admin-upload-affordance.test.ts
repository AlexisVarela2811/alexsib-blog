// Editor-side image upload affordance (S2): the editor can insert the
// /media/<id> reference of an uploaded private image into the draft Markdown.
// The UI itself is a client component (editor-form.tsx) that Node's native
// runner cannot import (.tsx, no JSX transform), so the deterministic
// insertion rule is extracted into a plain server-safe module and tested here;
// the rendered control is verified by typecheck and the production build.
// No network, no database, no Next server.
import { test } from 'node:test';
import assert from 'node:assert/strict';
// @ts-expect-error Node's native TypeScript runner requires the extension.
import { insertImageReference } from '../src/app/admin/[id]/image-reference.ts';

test('S2: an uploaded image reference is appended to the draft Markdown as /media/<id>', () => {
  assert.equal(
    insertImageReference('# Titulo\n\nUn parrafo.', '/media/11111111-2222-4333-8444-555555555555'),
    '# Titulo\n\nUn parrafo.\n\n![Imagen](/media/11111111-2222-4333-8444-555555555555)\n',
  );
});

test('S2: an empty draft gets the image reference as its first content', () => {
  assert.equal(
    insertImageReference('', '/media/11111111-2222-4333-8444-555555555555'),
    '![Imagen](/media/11111111-2222-4333-8444-555555555555)\n',
  );
});

test('S2: existing trailing whitespace is collapsed so references stay separated by one blank line', () => {
  assert.equal(
    insertImageReference('Texto.\n\n\n', '/media/11111111-2222-4333-8444-555555555555'),
    'Texto.\n\n![Imagen](/media/11111111-2222-4333-8444-555555555555)\n',
  );
});

test('S2: only a /media/<uuid> path from the upload route is inserted; anything else is refused', () => {
  for (const bad of [
    'https://evil.example/images/x.png',
    '/media/../../../etc/passwd',
    'images/secret.png',
    '/media/',
    '/media/11111111-2222-4333-8444-555555555555?token=1',
    '',
  ]) {
    assert.throws(() => insertImageReference('Texto.', bad), `path ${String(bad)} must be refused`);
    assert.equal(insertImageReference, insertImageReference);
  }
});
