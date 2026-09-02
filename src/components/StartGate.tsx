"use client"

type Props = {
  cameraReady: boolean
  cameraError: string | null
  onStart: () => void
}

export function StartGate({ cameraReady, cameraError, onStart }: Props) {
  return (
    <div className="absolute inset-0 z-20 flex items-center justify-center bg-black/70 backdrop-blur-sm">
      <div className="flex flex-col items-center gap-4 rounded-2xl bg-zinc-900/90 px-10 py-8 text-center text-zinc-50 shadow-xl">
        <h1 className="text-2xl font-semibold">Gesture Synth</h1>
        {cameraError ? (
          <p className="max-w-xs text-sm text-red-400">{cameraError}</p>
        ) : (
          <p className="max-w-xs text-sm text-zinc-400">
            Lève la main gauche pour jouer un accord, la main droite pour le volume et le filtre.
          </p>
        )}
        <button
          type="button"
          onClick={onStart}
          disabled={!cameraReady}
          className="rounded-full bg-emerald-400 px-6 py-2 font-medium text-black transition hover:bg-emerald-300 disabled:cursor-not-allowed disabled:bg-zinc-600 disabled:text-zinc-400"
        >
          {cameraReady ? "Start" : "Chargement de la caméra…"}
        </button>
      </div>
    </div>
  )
}
