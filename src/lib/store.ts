/** Minimal external store for high-frequency data that must bypass React's render cycle. */
export type Store<T> = {
  get: () => T
  set: (next: T) => void
  subscribe: (cb: () => void) => () => void
}

export function createStore<T>(initial: T): Store<T> {
  let state = initial
  const listeners = new Set<() => void>()
  return {
    get: () => state,
    set: (next) => {
      state = next
      listeners.forEach((listener) => listener())
    },
    subscribe: (cb) => {
      listeners.add(cb)
      return () => listeners.delete(cb)
    },
  }
}
