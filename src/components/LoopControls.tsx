"use client"

import { useSyncExternalStore } from "react"
import type { LoopState } from "@/audio/LoopEngine"
import { loopProgressStore } from "@/lib/loopProgressStore"

type Props = {
  loopState: LoopState
  onRecord: () => void
  onStop: () => void
  onClear: () => void
}

/** Loop transport controls. Progress is read from its own store so this component
 * doesn't need to re-render the whole tree on every playback tick. */
export function LoopControls({ loopState, onRecord, onStop, onClear }: Props) {
  const progress = useSyncExternalStore(loopProgressStore.subscribe, loopProgressStore.get, () => 0)

  return (
    <div className="absolute top-6 left-1/2 z-10 flex -translate-x-1/2 flex-col items-center gap-2">
      <div className="flex gap-2">
        <button
          type="button"
          onClick={onRecord}
          disabled={loopState === "recording"}
          className="rounded-full bg-red-500 px-4 py-1.5 text-sm font-medium text-white transition hover:bg-red-400 disabled:cursor-not-allowed disabled:bg-zinc-600"
        >
          {loopState === "recording" ? "Recording…" : "Record"}
        </button>
        <button
          type="button"
          onClick={onStop}
          disabled={loopState === "idle"}
          className="rounded-full bg-zinc-200 px-4 py-1.5 text-sm font-medium text-black transition hover:bg-white disabled:cursor-not-allowed disabled:bg-zinc-600 disabled:text-zinc-400"
        >
          Stop
        </button>
        <button
          type="button"
          onClick={onClear}
          className="rounded-full border border-zinc-400 px-4 py-1.5 text-sm font-medium text-zinc-200 transition hover:bg-zinc-700"
        >
          Clear
        </button>
      </div>
      {loopState === "playing" && (
        <div className="h-1 w-56 overflow-hidden rounded-full bg-zinc-700">
          <div className="h-full bg-zinc-200" style={{ width: `${Math.round(progress * 100)}%` }} />
        </div>
      )}
    </div>
  )
}
