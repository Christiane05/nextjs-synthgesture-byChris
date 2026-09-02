import { createStore } from "./store"

export type LiveState = {
  volume: number
  tone: number
  chord: string | null
  quality: string
  qualityIndex: number
}

export const idleLive: LiveState = {
  volume: 0,
  tone: 0,
  chord: null,
  quality: "--",
  qualityIndex: 0,
}

/** Updated every rAF tick by the gesture loop — read via useSyncExternalStore so only
 * the small display components re-render, not the whole app. */
export const liveStore = createStore<LiveState>(idleLive)
