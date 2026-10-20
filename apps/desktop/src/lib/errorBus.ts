/** Tiny pub/sub for user-visible app errors (playback, downloads, uploads). */

type Listener = (message: string) => void;

const listeners = new Set<Listener>();

export function emitAppError(message: string): void {
  console.error("[app]", message);
  for (const listener of listeners) listener(message);
}

export function onAppError(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
