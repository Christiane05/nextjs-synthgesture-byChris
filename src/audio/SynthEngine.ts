export class SynthEngine {
  private ctx: AudioContext | null = null
  private filter: BiquadFilterNode | null = null
  private waveShaper: WaveShaperNode | null = null
  private masterGain: GainNode | null = null
  private oscillators: OscillatorNode[] = []
  private currentKey: string | null = null

  // Independent bass voice (right hand) — own gain, bypasses the chord filter chain
  private bassOsc: OscillatorNode | null = null
  private bassGain: GainNode | null = null

  // Audio bus — everything connects here, routed through <audio> element
  // so Chrome keeps audio alive in background tabs
  private bus: GainNode | null = null
  private bgAudio: HTMLAudioElement | null = null

  ensureContext(): AudioContext {
    if (!this.ctx) {
      this.ctx = new (window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)()

      // Shared output bus (live synth + loop track). Hear it once via destination —
      // dual-routing to MediaStreamDestination as well doubles the signal and causes
      // comb-filter / phase artifacts when oscillators restart on note changes.
      this.bus = this.ctx.createGain()
      this.bus.gain.value = 1
      this.bus.connect(this.ctx.destination)

      // Silent MediaStream → <audio> keepalive so Chrome is less likely to suspend
      // the tab / AudioContext while a loop plays in the background. Muted so it does
      // not mix a second copy of the bus into the speakers.
      const keepAliveDest = this.ctx.createMediaStreamDestination()
      const keepAlive = this.ctx.createConstantSource()
      keepAlive.offset.value = 0
      keepAlive.connect(keepAliveDest)
      keepAlive.start()
      this.bgAudio = document.createElement("audio")
      this.bgAudio.srcObject = keepAliveDest.stream
      this.bgAudio.autoplay = true
      this.bgAudio.muted = true
      this.bgAudio.play().catch(() => { /* retried on user gesture / visibility */ })

      // Synth signal chain → bus
      this.waveShaper = this.ctx.createWaveShaper()
      this.waveShaper.curve = null
      this.waveShaper.oversample = "4x"
      this.filter = this.ctx.createBiquadFilter()
      this.filter.type = "lowpass"
      this.filter.frequency.value = 1200
      this.filter.Q.value = 0.7
      this.masterGain = this.ctx.createGain()
      this.masterGain.gain.value = 0
      this.waveShaper.connect(this.filter)
      this.filter.connect(this.masterGain)
      this.masterGain.connect(this.bus)

      // Bass chain: sawtooth → own gain → bus directly, independent of the chord's volume/filter
      this.bassGain = this.ctx.createGain()
      this.bassGain.gain.value = 0
      this.bassGain.connect(this.bus)
      this.bassOsc = this.ctx.createOscillator()
      this.bassOsc.type = "sawtooth"
      this.bassOsc.frequency.value = 110
      this.bassOsc.connect(this.bassGain)
      this.bassOsc.start()

      const ctx = this.ctx
      const audio = this.bgAudio
      document.addEventListener("visibilitychange", () => {
        if (ctx.state === "suspended") void ctx.resume()
        if (audio.paused) audio.play().catch(() => {})
      })
      ctx.addEventListener("statechange", () => {
        if (ctx.state === "suspended") void ctx.resume()
      })

      if ("mediaSession" in navigator) {
        navigator.mediaSession.metadata = new MediaMetadata({
          title: "Gesture Synth",
          artist: "Loop Playback",
        })
        navigator.mediaSession.playbackState = "playing"
      }
    }
    if (this.ctx.state === "suspended") void this.ctx.resume()
    return this.ctx
  }

  getContext(): AudioContext {
    return this.ensureContext()
  }

  // Output bus — LoopEngine connects here for background tab support
  getOutputBus(): GainNode {
    this.ensureContext()
    return this.bus!
  }

  setVolume(level: number) {
    if (!this.ctx || !this.masterGain) return
    const t = Math.max(0, Math.min(1, level))
    this.masterGain.gain.linearRampToValueAtTime(t, this.ctx.currentTime + 0.05)
  }

  playNotes(freqs: number[]) {
    this.ensureContext()
    if (!this.ctx || !this.waveShaper || freqs.length === 0) return
    const key = freqs.map((f) => f.toFixed(1)).join(",")
    if (key === this.currentKey) return
    this.oscillators.forEach((o) => {
      try { o.stop() } catch { /* already stopped */ }
    })
    this.oscillators = freqs.map((hz) => {
      const osc = this.ctx!.createOscillator()
      osc.type = "sawtooth"
      osc.frequency.value = hz
      osc.connect(this.waveShaper!)
      osc.start()
      return osc
    })
    this.currentKey = key
  }

  /** Right-hand bass root — independent of the left-hand chord, always a single note. */
  playBass(freq: number, volume: number) {
    this.ensureContext()
    if (!this.ctx || !this.bassOsc || !this.bassGain) return
    const now = this.ctx.currentTime
    this.bassOsc.frequency.setTargetAtTime(freq, now, 0.03)
    this.bassGain.gain.setTargetAtTime(Math.max(0, Math.min(1, volume)), now, 0.05)
  }

  stopBass() {
    if (!this.ctx || !this.bassGain) return
    this.bassGain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.08)
  }

  private stopChordOscillators() {
    this.oscillators.forEach((o) => {
      try { o.stop() } catch { /* already stopped */ }
    })
    this.oscillators = []
    this.currentKey = null
  }

  stopAll() {
    this.setVolume(0)
    this.stopBass()
    this.stopChordOscillators()
  }

  stop() {
    this.stopAll()
  }
}
