import { createStore } from "./store"

/** Loop playback progress in [0, 1], updated every rAF tick while a loop is playing. */
export const loopProgressStore = createStore<number>(0)
