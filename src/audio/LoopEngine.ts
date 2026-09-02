export type LoopState = "idle" | "recording" | "playing"

type Frame = {
  /** Milliseconds since recording started. */
  t: number
  freqs: number[]
  volume: number
  filterTilt: number
  bassFreq: number
  bassVolume: number
}

const RAMP_SEC = 0.006
const MIN_LOOP_MS = 150

/**
 * Single-track "looper pedal": records the live gesture performance (frequencies,
 * volume, filter tilt) while recording, then bounces it to a looping AudioBuffer
 * via OfflineAudioContext for glitch-free, gapless playback.
 */
export class LoopEngine {
  private ctx: AudioContext
  private bus: GainNode
  private trackGain: GainNode
  private frames: Frame[] = []
  private recordStart = 0
  private durationMs = 0
  private state: LoopState = "idle"
  private source: AudioBufferSourceNode | null = null
  private playStartCtxTime = 0

  constructor(ctx: AudioContext, bus: GainNode) {
    this.ctx = ctx
    this.bus = bus
    this.trackGain = ctx.createGain()
    this.trackGain.gain.value = 1
    this.trackGain.connect(bus)
  }

  getState() {
    return this.state
  }

  getDuration() {
    return this.durationMs
  }

  hasContent() {
    return this.frames.some((f) => f.freqs.length > 0 || f.bassFreq > 0)
  }

  /** Playback position in [0, 1], 0 when idle/recording. */
  getProgress(): number {
    if (this.state !== "playing" || this.durationMs <= 0) return 0
    const elapsedMs = (this.ctx.currentTime - this.playStartCtxTime) * 1000
    return (elapsedMs % this.durationMs) / this.durationMs
  }

  startRecording() {
    this.stopPlayback()
    this.frames = []
    this.recordStart = performance.now()
    this.state = "recording"
  }

  /** Called every rAF tick while recording; no-op otherwise. */
  recordFrame(freqs: number[], volume: number, filterTilt: number, bassFreq: number, bassVolume: number) {
    if (this.state !== "recording") return
    this.frames.push({ t: performance.now() - this.recordStart, freqs, volume, filterTilt, bassFreq, bassVolume })
  }

  async stopRecording() {
    if (this.state !== "recording") return
    this.durationMs = performance.now() - this.recordStart
    this.state = "idle"
    if (this.durationMs >= MIN_LOOP_MS && this.hasContent()) {
      await this.play()
    } else {
      this.frames = []
      this.durationMs = 0
    }
  }

  private async renderBuffer(): Promise<AudioBuffer | null> {
    if (this.frames.length === 0 || this.durationMs <= 0) return null
    const durSec = this.durationMs / 1000
    const sampleRate = this.ctx.sampleRate
    const length = Math.max(1, Math.ceil(sampleRate * durSec))
    const offline = new OfflineAudioContext(2, length, sampleRate)

    const ws = offline.createWaveShaper()
    ws.curve = null
    ws.oversample = "4x"
    const filt = offline.createBiquadFilter()
    filt.type = "lowpass"
    filt.frequency.value = 1200
    filt.Q.value = 0.7
    ws.connect(filt)
    filt.connect(offline.destination)

    // Bass bypasses the chord filter, mirroring the live SynthEngine routing
    const bassBus = offline.createGain()
    bassBus.gain.value = 1
    bassBus.connect(offline.destination)

    const sorted = [...this.frames].sort((a, b) => a.t - b.t)
    for (let i = 0; i < sorted.length; i++) {
      const frame = sorted[i]
      if (frame.freqs.length === 0) continue
      const startSec = frame.t / 1000
      const nextT = i + 1 < sorted.length ? sorted[i + 1].t : this.durationMs
      const endSec = Math.max(startSec + 0.02, nextT / 1000)

      let freq = 1200
      let q = 0.7
      if (frame.filterTilt < 0) {
        const r = Math.abs(frame.filterTilt)
        freq = 1200 - r * 950
        q = 0.7 + r * 1.5
      } else if (frame.filterTilt > 0) {
        freq = 1200 + frame.filterTilt * 3800
        q = 0.7 + frame.filterTilt * 4.5
      }
      filt.frequency.setValueAtTime(freq, startSec)
      filt.Q.setValueAtTime(q, startSec)

      frame.freqs.forEach((hz) => {
        const osc = offline.createOscillator()
        osc.type = "sawtooth"
        osc.frequency.value = hz
        const g = offline.createGain()
        const sustainEnd = Math.max(startSec + RAMP_SEC, endSec - RAMP_SEC)
        g.gain.setValueAtTime(0, startSec)
        g.gain.linearRampToValueAtTime(frame.volume, startSec + RAMP_SEC)
        g.gain.setValueAtTime(frame.volume, sustainEnd)
        g.gain.linearRampToValueAtTime(0, endSec)
        osc.connect(g)
        g.connect(ws)
        osc.start(startSec)
        osc.stop(endSec + 0.01)
      })
    }

    // Bass runs — grouped separately since the root can hold while the chord changes
    let i2 = 0
    while (i2 < sorted.length) {
      if (sorted[i2].bassFreq <= 0) { i2++; continue }
      const startSec = sorted[i2].t / 1000
      const freq = sorted[i2].bassFreq
      const volume = sorted[i2].bassVolume
      let j = i2 + 1
      while (j < sorted.length && Math.abs(sorted[j].bassFreq - freq) < 0.5) j++
      const endT = j < sorted.length ? sorted[j].t : this.durationMs
      const endSec = Math.max(startSec + 0.02, endT / 1000)

      const osc = offline.createOscillator()
      osc.type = "sawtooth"
      osc.frequency.value = freq
      const g = offline.createGain()
      const sustainEnd = Math.max(startSec + RAMP_SEC, endSec - RAMP_SEC)
      g.gain.setValueAtTime(0, startSec)
      g.gain.linearRampToValueAtTime(volume, startSec + RAMP_SEC)
      g.gain.setValueAtTime(volume, sustainEnd)
      g.gain.linearRampToValueAtTime(0, endSec)
      osc.connect(g)
      g.connect(bassBus)
      osc.start(startSec)
      osc.stop(endSec + 0.01)
      i2 = j
    }

    return offline.startRendering()
  }

  private async play() {
    const buffer = await this.renderBuffer()
    if (!buffer) return
    this.source = this.ctx.createBufferSource()
    this.source.buffer = buffer
    this.source.loop = true
    this.source.connect(this.trackGain)
    this.playStartCtxTime = this.ctx.currentTime
    this.source.start()
    this.state = "playing"
  }

  stopPlayback() {
    if (this.source) {
      try { this.source.stop() } catch { /* already stopped */ }
      this.source.disconnect()
      this.source = null
    }
    if (this.state === "playing") this.state = "idle"
  }

  clear() {
    this.stopPlayback()
    this.frames = []
    this.durationMs = 0
    this.state = "idle"
  }
}
