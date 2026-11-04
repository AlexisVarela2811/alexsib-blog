// A deliberately small model: each step adds one message to a three-slot window.
export const contextMessages = [
  'Hola',
  '¿Qué es una ventana de contexto?',
  'Es el texto que el modelo puede considerar.',
  '¿Y si la conversación continúa?',
  'Los mensajes más antiguos pueden quedar fuera.',
] as const;

export const initialContext = 0;
export function advanceContext(step: number): number {
  return Math.min(step + 1, contextMessages.length);
}
export function resetContext(): number {
  return initialContext;
}
