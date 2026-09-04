"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { SynthEngine } from "@/audio/SynthEngine"
import { KEY_OPTIONS, bassHzFromRoman, bassNoteFromRoman, chordNameFromRoman, chordTonesFromRoman, notesForQuality, qualityLabel } from "@/lib/chords"
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
import { BassDisplay, LeftChordsDisplay } from "./ChordDisplay"
import { StartGate } from "./StartGate"
import { WebcamView } from "./WebcamView"

export function GestureSynthApp() {
  const videoRef = useRef<HTMLVideoElement>(null)
  const synthRef = useRef(new SynthEngine())
  const stabilizeRef = useRef(createChordStabilizer())
  const bassStabilizeRef = useRef(createDegreeStabilizer())
  const { status, error, handsRef } = useHandTracking(videoRef)

  const [audioOn, setAudioOn] = useState(false)
  const [keyHz, setKeyHz] = useState<number>(KEY_OPTIONS[0].hz)

  const getResult = useCallback(() => handsRef.current.result, [handsRef])
  const getWaveParams = useCallback(() => {
    const live = liveStore.get()
    return { 
      volume: live.volume, qualityIndex: live.qualityIndex, tone: live.tone, chord: live.chord,
      bassVolume: live.bassVolume, bassNote: live.bassNote, bassDegree: live.bassDegree,
    }
  }, [])

  // --- Main data flow: landmarks → gesture → chord → SynthEngine → audio output ---
  useEffect(() => {
    let raf = 0
    let lastKey = ""

    

    const publish = (next: LiveState) => {
      const key = [
        next.chord,
        next.chordName,
        next.qualityIndex,
        next.bassDegree,
        next.bassNote,
        Math.round(next.tone * 100),
        Math.round(next.volume * 16),
        Math.round(next.bassVolume * 16),
      ].join("|")
      if (key === lastKey) return
      lastKey = key
      liveStore.set(next)
    }

    const tick = () => {
      const now = performance.now()
      const { left, right } = handsRef.current
      const synth = synthRef.current

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
      const chordName = chordNameFromRoman(chord, keyHz, isMajor)

      // Left hand: chord volume by its own height — independent of the right hand.
      const leftVolume = left ? volumeFromHand(left) : 0
      if (audioOn) {
        if (chord && qualityIndex >= 1) {
          const notes = notesForQuality(chordTonesFromRoman(chord, isMajor, keyHz), qualityIndex, isMajor)
          synth.playNotes(notes)
          synth.setVolume(leftVolume)
        } else {
          synth.setVolume(0)
        }
      }

      // Right hand: bass root, by its own height — independent of the left hand.
      // Tilt nudges the bass root by a semitone (right = up, left = down) on specific degrees.
      let tone = 0
      let bassDegree: string | null = null
      let bassNote: string | null = null
      let bassVolume = 0
      if (right) {
        tone = wristTilt(right, "Right")
        const rightVolume = volumeFromHand(right)

        // Right hand's finger/thumb pattern → Roman-numeral bass degree (root only, no chord)
        const rawDegree = chordFromLeftHand(right, "Right")
        bassDegree = bassStabilizeRef.current(rawDegree?.toUpperCase() ?? null, now)

        const hz = bassHzFromRoman(bassDegree, keyHz, tone)
        bassNote = bassNoteFromRoman(bassDegree, keyHz, tone)
        bassVolume = hz ? rightVolume : 0

        if (audioOn) {
          if (hz) synth.playBass(hz, rightVolume)
          else synth.stopBass()
        }
      } else if (audioOn) {
        synth.stopBass()
      }

      let displayBassDegree = bassDegree

      if (bassDegree) {
        if (tone > 0.3) {
          if (bassDegree !== "I" && bassDegree !== "IV") {
            displayBassDegree = `${bassDegree}b`
          } else {
            displayBassDegree = bassDegree
          }
        } else if (tone < -0.3) {
          if (bassDegree !== "III" && bassDegree !== "VII") {
            displayBassDegree = `${bassDegree}#` 
          } else {
            displayBassDegree = bassDegree
          }
        }
        else if (tone === 0.3) {
          displayBassDegree = `${bassDegree}` 
        }
      }

      publish({
        volume: leftVolume,
        tone,
        chord,
        chordName,
        quality,
        qualityIndex,
        bassDegree: displayBassDegree,
        bassNote,
        bassVolume,
      })
      raf = requestAnimationFrame(tick)
    }

    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [audioOn, handsRef, keyHz])

  const handleStart = useCallback(() => {
    synthRef.current.getContext()
    setAudioOn(true)
  }, [])

  const statusText = useMemo(() => {
    if (error) return "Caméra bloquée — autorisez l'accès et rechargez"
    if (status === "requesting") return "Demande d'accès à la caméra…"
    if (status === "loading") return "Chargement du modèle de mains…"
    if (!audioOn) return "Audio coupé — cliquez sur Start"
    return "Main gauche = Chord Maj / min + Volume \n Main droite = Bass # / b + Volume \n VI = I__I \n VII = _I__I "
  }, [audioOn, error, status])

  

  return (
    <div className="relative h-dvh w-full overflow-hidden bg-black">
      <video ref={videoRef} className="hidden" playsInline muted autoPlay />
      <WebcamView videoRef={videoRef} getResult={getResult} getWaveParams={getWaveParams} dimmed={!audioOn} />
      
        
          <div className="pointer-events-none absolute top-4 left-4 z-10 flex items-center gap-3 text-sm text-zinc-200">
            <span  className="whitespace-pre-line left-4">{statusText}</span>
          </div>

            {audioOn && (
              <div className="pointer-events-none absolute top-4 left-1/2 z-10 -translate-x-1/2">
                <select
                  value={keyHz}
                  onChange={(e) => setKeyHz(Number(e.target.value))}
                  className="pointer-events-auto  rounded  bg-zinc-800/80 px-2 py-1 text-pink-300 focus:outline-none  "
                >
                  {KEY_OPTIONS.map((k) => (
                    <option 
                        key={k.label} 
                        value={k.hz}   
                    >
                      {k.label}
                    </option>
                  ))}
                </select>
              </div>
            )}
          

      {audioOn && <LeftChordsDisplay />}
      {audioOn && <BassDisplay />}

      {!audioOn && (
        <StartGate cameraReady={status === "ready"} cameraError={error} onStart={handleStart} />
      )}
    </div>
  )
}
