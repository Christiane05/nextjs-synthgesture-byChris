"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { LoopEngine, type LoopState } from "@/audio/LoopEngine"
import { SynthEngine } from "@/audio/SynthEngine"
import { KEY_OPTIONS, bassHzFromRoman, chordTonesFromRoman, notesForQuality, qualityLabel } from "@/lib/chords"
import {
  chordFromLeftHand,
  createChordStabilizer,
  createDegreeStabilizer,
  normalizeChordCase,
  volumeFromHand,
  wristTilt,
  type StabilizedChord,
} from "@/lib/gestures"
import { useHandTracking } from "@/hooks/useHandTracking"
import { liveStore, type LiveState } from "@/lib/liveStore"
import { loopProgressStore } from "@/lib/loopProgressStore"
import { ChordDisplay } from "./ChordDisplay"
import { LoopControls } from "./LoopControls"
import { StartGate } from "./StartGate"
import { WebcamView } from "./WebcamView"

export function GestureSynthApp() {
  const videoRef = useRef<HTMLVideoElement>(null)
  const synthRef = useRef(new SynthEngine())
  const loopRef = useRef<LoopEngine | null>(null)
  const stabilizeRef = useRef(createChordStabilizer())
  const bassStabilizeRef = useRef(createDegreeStabilizer())
  const { status, error, handsRef } = useHandTracking(videoRef)

  const [audioOn, setAudioOn] = useState(false)
  const [keyHz, setKeyHz] = useState<number>(KEY_OPTIONS[0].hz)
  const [loopState, setLoopState] = useState<LoopState>("idle")

  const getResult = useCallback(() => handsRef.current.result, [handsRef])
  const getWaveParams = useCallback(() => {
    const live = liveStore.get()
    return { volume: live.volume, qualityIndex: live.qualityIndex, tone: live.tone, chord: live.chord }
  }, [])

  // --- Main data flow: landmarks → gesture → chord → SynthEngine/LoopEngine → audio output ---
  useEffect(() => {
    let raf = 0
    let lastKey = ""

    const publish = (next: LiveState) => {
      const key = [next.chord, next.qualityIndex, Math.round(next.tone * 100), Math.round(next.volume * 16)].join("|")
      if (key === lastKey) return
      lastKey = key
      liveStore.set(next)
    }

    const tick = () => {
      const now = performance.now()
      const { left, right } = handsRef.current
      const synth = synthRef.current
      const loopEngine = loopRef.current

      let candidate: StabilizedChord | null = null
      if (left) {
        const leftTilt = wristTilt(left, "Left")
        const rawChord = chordFromLeftHand(left, "Left")
        const isMajorMode = leftTilt >= 0
        // Right hand only plays the bass root now — left-hand chord is always a basic triad.
        if (rawChord) {
          candidate = { chord: normalizeChordCase(rawChord, isMajorMode), isMajorMode, qualityIndex: 1, thumbDown: false }
        }
      }

      const stable = stabilizeRef.current(candidate, now)
      const chord = stable?.chord ?? null
      const isMajor = stable?.isMajorMode ?? true
      const qualityIndex = stable?.qualityIndex ?? 0
      const quality = qualityLabel(qualityIndex, isMajor, false)

      // Left hand: chord volume by its own height — independent of the right hand.
      const leftVolume = left ? volumeFromHand(left) : 0
      let playedFreqs: number[] = []
      if (audioOn) {
        if (chord && qualityIndex >= 1) {
          const notes = notesForQuality(chordTonesFromRoman(chord, isMajor, keyHz), qualityIndex, isMajor)
          playedFreqs = notes
          synth.playNotes(notes)
          synth.setVolume(leftVolume)
        } else {
          synth.setVolume(0)
        }
      }

      // Right hand: bass root, by its own height — independent of the left hand.
      // Tilt nudges the bass root by a semitone (right = up, left = down) on specific degrees.
      let tone = 0
      let bassFreq = 0
      let bassVolume = 0
      if (right) {
        tone = wristTilt(right, "Right")
        const rightVolume = volumeFromHand(right)

        // Right hand's finger/thumb pattern → Roman-numeral bass degree (root only, no chord)
        const rawDegree = chordFromLeftHand(right, "Right")
        const degree = bassStabilizeRef.current(rawDegree, now)
        const hz = bassHzFromRoman(degree, keyHz, tone)
        if (hz) {
          bassFreq = hz
          bassVolume = rightVolume
        }

        if (audioOn) {
          if (hz) synth.playBass(hz, rightVolume)
          else synth.stopBass()
        }
      } else if (audioOn) {
        synth.stopBass()
      }

      if (loopEngine) {
        loopEngine.recordFrame(
          playedFreqs,
          playedFreqs.length > 0 ? leftVolume : 0,
          tone,
          bassFreq,
          bassVolume,
        )
        loopProgressStore.set(loopEngine.getProgress())
      }

      publish({ volume: leftVolume, tone, chord, quality, qualityIndex })
      raf = requestAnimationFrame(tick)
    }

    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [audioOn, handsRef, keyHz])

  const handleStart = useCallback(() => {
    const ctx = synthRef.current.getContext()
    const bus = synthRef.current.getOutputBus()
    loopRef.current = new LoopEngine(ctx, bus)
    setAudioOn(true)
  }, [])

  const handleRecord = useCallback(() => {
    loopRef.current?.startRecording()
    setLoopState("recording")
  }, [])

  const handleStop = useCallback(() => {
    const loop = loopRef.current
    if (!loop) return
    void loop.stopRecording().then(() => setLoopState(loop.getState()))
  }, [])

  const handleClear = useCallback(() => {
    loopRef.current?.clear()
    setLoopState("idle")
    loopProgressStore.set(0)
  }, [])

  const statusText = useMemo(() => {
    if (error) return "Caméra bloquée — autorisez l'accès et rechargez"
    if (status === "requesting") return "Demande d'accès à la caméra…"
    if (status === "loading") return "Chargement du modèle de mains…"
    if (!audioOn) return "Audio coupé — cliquez sur Start"
    return "Main gauche = accord · main droite = basse (I-VII) + volume/filtre"
  }, [audioOn, error, status])

  return (
    <div className="relative h-dvh w-full overflow-hidden bg-black">
      <video ref={videoRef} className="hidden" playsInline muted autoPlay />
      <WebcamView videoRef={videoRef} getResult={getResult} getWaveParams={getWaveParams} dimmed={!audioOn} />

      <div className="pointer-events-none absolute top-4 left-4 z-10 flex items-center gap-3 text-sm text-zinc-200">
        <span>{statusText}</span>
        {audioOn && (
          <select
            value={keyHz}
            onChange={(e) => setKeyHz(Number(e.target.value))}
            className="pointer-events-auto rounded bg-zinc-800/80 px-2 py-1 text-zinc-100"
          >
            {KEY_OPTIONS.map((k) => (
              <option key={k.label} value={k.hz}>
                {k.label}
              </option>
            ))}
          </select>
        )}
      </div>

      {audioOn && <ChordDisplay />}
      {audioOn && (
        <LoopControls loopState={loopState} onRecord={handleRecord} onStop={handleStop} onClear={handleClear} />
      )}

      {!audioOn && (
        <StartGate cameraReady={status === "ready"} cameraError={error} onStart={handleStart} />
      )}
    </div>
  )
}
