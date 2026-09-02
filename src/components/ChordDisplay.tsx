"use client"

import { useSyncExternalStore } from "react"
import { idleLive, liveStore } from "@/lib/liveStore"
import { chordColorVar } from "@/lib/chords"

/** Subscribes directly to the live gesture store — re-renders only this small panel,
 * never the rest of the app, no matter how fast the rAF loop publishes updates. */
export function LeftChordsDisplay() {
  const live = useSyncExternalStore(liveStore.subscribe, liveStore.get, () => idleLive)
  const rgb = chordColorVar(live.chord)
  const active = Boolean(live.chord)

  return (
    <div className="pointer-events-none absolute bottom-6 left-0 right-1/2 flex flex-col items-center gap-2">
      <div className="text-sm uppercase tracking-[0.2em] text-zinc-400">Chord</div>
      <div
        className="text-4xl font-bold tabular-nums"
        style={{ color: `rgb(${rgb})`, opacity: active ? 1 : 0.4 }}
      >
        {live.chord ?? "--"}
      </div>
      <div className="text-sm text-zinc-300"> {live.quality}</div>
      <div className="h-1.5 w-40 overflow-hidden rounded-full bg-zinc-700">
        <div
          className="h-full bg-emerald-400 transition-[width] duration-75"
          style={{ width: `${Math.round(live.volume * 100)}%` }}
        />
      </div>
    </div>
  )
}

export function BassDisplay() {
  const live = useSyncExternalStore(liveStore.subscribe, liveStore.get, () => idleLive)
  const active = Boolean(live.bassDegree)

  return (
    <div className="pointer-events-none absolute bottom-6 left-1/2 right-0 flex flex-col items-center gap-2">
      <div className="text-sm uppercase tracking-[0.2em] text-zinc-400">Bass</div>
      <div
        className="text-4xl font-bold tabular-nums text-amber-300"
        style={{ opacity: active ? 1 : 0.4 }}
      >
        {live.bassDegree ?? "--"}
      </div>
      <div className="text-sm text-zinc-300">{live.bassNote ?? "--"}</div>
      <div className="h-1.5 w-40 overflow-hidden rounded-full bg-zinc-700">
        <div
          className="h-full bg-amber-300 transition-[width] duration-75"
          style={{ width: `${Math.round(live.bassVolume * 100)}%` }}
        />
      </div>
    </div>
  )
}
