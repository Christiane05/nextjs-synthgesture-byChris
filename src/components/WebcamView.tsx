"use client"

import { useEffect, useRef } from "react"
import type { HandLandmarkerResult } from "@mediapipe/tasks-vision"
import { chordColorVar } from "@/lib/chords"

type WaveParams = {
  volume: number
  qualityIndex: number
  
  chord: string | null

  bassVolume: number
  bassNote: string | null
  bassDegree: string | null
  
}

type Props = {
  videoRef: React.RefObject<HTMLVideoElement | null>
  getResult: () => HandLandmarkerResult | null
  getWaveParams: () => WaveParams
  dimmed: boolean
}

function coverCrop(vw: number, vh: number, cw: number, ch: number) {
  const videoAspect = vw / vh
  const canvasAspect = cw / ch
  if (videoAspect > canvasAspect) {
    const sHeight = vh
    const sWidth = vh * canvasAspect
    return { sx: (vw - sWidth) / 2, sy: 0, sWidth, sHeight }
  }
  const sWidth = vw
  const sHeight = vw / canvasAspect
  return { sx: 0, sy: (vh - sHeight) / 2, sWidth, sHeight }
}

  function drawWaves(
  ctx: CanvasRenderingContext2D,
  volume: number,
  layers: number,
  rgb: string,
  baseY: number,
  amplitude: number = 20,
  frequency: number = 0.005,
) {
  if (volume <= 0 || layers <= 0) return

  const width = ctx.canvas.width

  // Volume → épaisseur
  const lineW = 1 + volume * 8

  // Tone → quantité et fréquence du jitter
  const noiseAmt = ((1 + 1) / 2) * 25
  const noiseFreq = 0.05 + ((1 + 1) / 2) * 0.15

  // Animation
  const t = performance.now() * 0.004

  ctx.save()

  // Volume → intensité du glow
  ctx.shadowBlur = 10 + volume * 20
  ctx.shadowColor = `rgba(${rgb}, ${0.5 * volume})`

  for (let i = 0; i < layers; i++) {
    ctx.beginPath()

    // Position verticale de chaque couche
    const y0 =
      baseY +
      (i - (layers - 1) / 2) * 12

    for (let x = 0; x <= width; x += 10) {
      // Amplitude de la wave
      const wave =
        Math.sin(
          x * frequency +
          t +
          i * 0.5
        ) * amplitude

      // Instabilité contrôlée par tone
      const jitter =
        (Math.random() - 0.5) *
        noiseAmt *
        Math.sin(
          x * noiseFreq + t
        )

      const y = y0 + wave + jitter

      if (x === 0) {
        ctx.moveTo(x, y)
      } else {
        ctx.lineTo(x, y)
      }
    }

    ctx.strokeStyle = `rgba(${rgb}, ${volume})`

    ctx.lineWidth = Math.max(
      1,
      lineW - i * 0.5
    )

    ctx.lineCap = "round"
    ctx.lineJoin = "round"

    ctx.stroke()
  }

  ctx.restore()
}



/** Draws the mirrored webcam feed, hand landmark dots and the reactive wave visualizer.
 * Runs its own rAF loop reading refs/callbacks — never touches React state. */
export function WebcamView({ videoRef, getResult, getWaveParams, dimmed }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const resize = () => {
      canvas.width = window.innerWidth
      canvas.height = window.innerHeight
    }
    resize()
    window.addEventListener("resize", resize)

    let raf = 0
    const paint = () => {
      const video = videoRef.current
      const ctx = canvas.getContext("2d")
      if (!ctx || !video || !video.videoWidth) {
        raf = requestAnimationFrame(paint)
        return
      }
      const { width: cw, height: ch } = canvas
      const { sx, sy, sWidth, sHeight } = coverCrop(video.videoWidth, video.videoHeight, cw, ch)
      ctx.save()
      ctx.clearRect(0, 0, cw, ch)
      ctx.translate(cw, 0)
      ctx.scale(-1, 1)
      ctx.drawImage(video, sx, sy, sWidth, sHeight, 0, 0, cw, ch)

      const result = getResult()
      if (result) {
        ctx.fillStyle = "rgba(255, 255, 255, 0.55)"
        for (const hand of result.landmarks) {
          for (const pt of hand) {
            const lx = pt.x * video.videoWidth
            const ly = pt.y * video.videoHeight
            const dx = ((lx - sx) / sWidth) * cw
            const dy = ((ly - sy) / sHeight) * ch
            ctx.beginPath()
            ctx.arc(dx, dy, 4, 0, Math.PI * 2)
            ctx.fill()
          }
        }
      }
      ctx.restore()

      const wave = getWaveParams()

      const chordRgb = "252, 211, 77"
      drawWaves(
        ctx,
        wave.volume,                         // volume
        wave.qualityIndex,                   // nombre de layers
        chordRgb,                            // couleur
        ctx.canvas.height - 56,              // position
        20,                                 // amplitude
        0.005                               // fréquence
      )

      
      const chordRgbBass = "255, 90, 140"
      drawWaves(
        ctx,
        wave.bassVolume,                     // volume de la basse
        1,                                  // une seule layer
        chordRgbBass,                            // couleur de la basse
        ctx.canvas.height - 56,             // position
        35,                                 // amplitude plus importante
        0.003                               // fréquence plus lente
      )


      
      
      
      {/*drawWaves(ctx, wave.volume, wave.qualityIndex, wave.tone, wave.chord)*/}

      raf = requestAnimationFrame(paint)
    }
    raf = requestAnimationFrame(paint)

    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener("resize", resize)
    }
  }, [videoRef, getResult, getWaveParams])

  return (
    <canvas
      ref={canvasRef}
      className="absolute inset-0 h-full w-full transition-opacity duration-500"
      style={{ opacity: dimmed ? 0.5 : 1 }}
    />
  )
}
