'use client';

import { createElement as h, useState } from 'react';
// Node's native TypeScript runner requires the extension.
// @ts-expect-error TypeScript config does not enable TS extension imports.
import { advanceContext, contextMessages, initialContext, resetContext } from '../../lib/content/context-window.ts';

export function ContextWindowFigure() {
  const [step, setStep] = useState(initialContext);
  const visible = contextMessages.slice(Math.max(0, step - 3), step);
  return h('figure', { className: 'my-8 rounded-lg border border-[#304537] bg-[#111a15] p-5' },
    h('figcaption', { className: 'font-mono text-[#a1efb5]' }, 'Ventana de contexto'),
    h('p', null, 'Simplificación educativa: mostramos tres mensajes; los modelos reales usan tokens y límites diferentes.'),
    h('div', { 'aria-live': 'polite', className: 'my-4' },
      h('p', null, `Mensajes en la ventana: ${visible.length} de 3`),
      visible.length ? h('ol', { className: 'list-inside list-decimal' }, visible.map((message, i) => h('li', { key: `${step}-${i}` }, message))) : h('p', null, 'La ventana está vacía.'),
      step > 3 ? h('p', null, 'Los mensajes anteriores quedaron fuera de esta ventana.') : null,
    ),
    h('div', { className: 'flex flex-wrap gap-3' },
      h('button', { type: 'button', disabled: step >= contextMessages.length, onClick: () => setStep(advanceContext), className: 'rounded border border-[#a1efb5] px-3 py-1 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#a1efb5] disabled:opacity-50' }, 'Avanzar'),
      h('button', { type: 'button', onClick: () => setStep(resetContext()), className: 'rounded border border-[#a1efb5] px-3 py-1 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#a1efb5]' }, 'Reiniciar'),
    ),
  );
}
