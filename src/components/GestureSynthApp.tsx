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

            <a
              href="https://github.com/Christiane05/nextjs-synthgesture-byChris.git"
              target="_blank"
              rel="noopener noreferrer"
              className="pointer-events-auto absolute bottom-8 left-1/2 z-20 -translate-x-1/2 text-white transition-opacity hover:opacity-70"
              aria-label="GitHub"
            >
              <svg
                width="24"
                height="24"
                viewBox="0 0 256 250"
                fill="pink"
                aria-hidden="true"
              >
                <path d="M128.00106,0C57.3172926,0,0,57.3066942,0,128.00106c0,56.554221,36.6761997,104.534482,87.534937,121.459839,6.3972853,1.184779,8.745651-2.776962,8.745651-6.157794,0-3.052062-.118701-13.135434-.173812-23.831129-35.61061,7.743556-43.124761-15.101964-43.124761-15.101964-5.822662-14.79587-14.212072-18.729474-14.212072-18.729474-11.614316-7.944513.988437-7.781302.988437-7.781302,12.853548.902937,19.621572,13.190034,19.621572,13.190034,11.416402,19.56857,29.944048,13.91195,37.248342,10.641515,1.148847-8.273529,4.465692-13.92051,8.126324-17.116626-28.431282-3.237214-58.318664-14.212072-58.318664-63.260068,0-13.974973,5.000239-25.393478,13.188964-34.357472-1.321325-3.223032-5.703521-16.241672,1.200311-33.873309,0,0,10.748715-3.440188,35.209406,13.12059,10.210326-2.836805,21.161903-4.259069,32.040634-4.30782,10.878731.048751,21.8396,1.471015,32.049926,4.30782,24.460691-16.560778,35.209406-13.12059,35.209406-13.12059,6.903832,17.631637,2.521636,30.650277,1.200311,33.873309,8.188725,8.963994,13.188964,20.382499,13.188964,34.357472,0,49.166073-29.944048,59.976913-58.475342,63.13513,4.594889,3.964478,8.703957,11.759118,8.703957,23.706666,0,17.128991-.14884,30.919193-.14884,35.135175,0,3.414954,2.304272,7.406821,8.752291,6.146742C219.370432,232.499507,256,184.536204,256,128.00106,256,57.3066942,198.691187,0,128.00106,0Z" />
              </svg>
            </a>

      {audioOn && <BassDisplay />}

      {!audioOn && (
        <StartGate cameraReady={status === "ready"} cameraError={error} onStart={handleStart} />
      )}
      
    </div>
  )
}
