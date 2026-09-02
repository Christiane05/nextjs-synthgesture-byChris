export type Landmark = { x: number; y: number; z: number; visibility?: number }
export type Handedness = "Left" | "Right"

const FINGERS = {
  index: { pip: 6, tip: 8 },
  middle: { pip: 10, tip: 12 },
  ring: { pip: 14, tip: 16 },
  pinky: { pip: 18, tip: 20 },
} as const

type FingerName = keyof typeof FINGERS

export function isFingerRaised(landmarks: Landmark[], finger: FingerName): boolean {
  const { pip, tip } = FINGERS[finger]
  return landmarks[tip].y < landmarks[pip].y
}

/** Thumb extended outward — drives octave-down and the VI/VII degrees. */
export function isThumbExtended(landmarks: Landmark[], handedness: Handedness): boolean {
  const tip = landmarks[4]
  const ip = landmarks[3]
  return handedness === "Right" ? tip.x > ip.x : tip.x < ip.x
}

/** Palm orientation hint used for Roman numeral casing. */
export function palmMode(landmarks: Landmark[]): "major" | "minor" {
  const wrist = landmarks[0]
  return landmarks[9].x > wrist.x ? "minor" : "major"
}

/** Wrist tilt in [-1, 1], relative to the middle/ring MCP span. */
//Inclinaison de la paume de la main et a une valeur entre 1 et -1 (gauche/droite)
export function wristTilt(landmarks: Landmark[], handedness: Handedness): number {
  if (!landmarks || landmarks.length < 18) return 0
  try {
    const wrist = landmarks[0]
    const mid = landmarks[9]
    const ring = landmarks[13]
    if (!wrist || !mid || !ring) return 0
    const left = Math.min(mid.x, ring.x)
    const right = Math.max(mid.x, ring.x)
    const dead = 0.12
    let t = 0
    if (wrist.x < left) t = (wrist.x - left) / dead
    else if (wrist.x > right) t = (wrist.x - right) / dead
    t = Math.max(-1, Math.min(1, t))
    if (handedness === "Right") t = -t
    return t
  } catch {
    return 0
  }
}

export function volumeFromHand(landmarks: Landmark[]): number {
  const y = landmarks[0].y
  const lo = 0.05
  const hi = 0.95
  return 1 - (Math.max(lo, Math.min(hi, y)) - lo) / (hi - lo)
}

export function raisedFingerCount(landmarks: Landmark[]): number {
  return (["index", "middle", "ring", "pinky"] as FingerName[])
    .map((f) => isFingerRaised(landmarks, f))
    .filter(Boolean).length
}

/** Left-hand Roman numeral chord degree from raised fingers + thumb. */
export function chordFromLeftHand(landmarks: Landmark[], handedness: Handedness): string | null {
  const thumb = isThumbExtended(landmarks, handedness)
  const index = isFingerRaised(landmarks, "index")
  const middle = isFingerRaised(landmarks, "middle")
  const ring = isFingerRaised(landmarks, "ring")
  const pinky = isFingerRaised(landmarks, "pinky")
  const mode = palmMode(landmarks)

  if (index && pinky && !middle && !ring && !thumb) {
    return mode === "major" ? "VI" : "vi"
  }
  if (index && pinky && !middle && !ring && thumb) {
    return mode === "major" ? "VII" : "vii"
  }

  const count = [thumb, index, middle, ring, pinky].filter(Boolean).length
  const map: Record<number, string> = {
    1: "I",
    2: "II",
    3: "III",
    4: "IV",
    5: "V",
  }
  const degree = map[count]
  if (!degree) return null
  return mode === "major" ? degree : degree.toLowerCase()
}

/** Normalize Roman numeral casing to match the active major/minor mode. */
export function normalizeChordCase(chord: string, isMajorMode: boolean): string {
  return isMajorMode ? chord.toUpperCase() : chord.toLowerCase()
}

export type StabilizedChord = {
  chord: string
  isMajorMode: boolean
  qualityIndex: number
  thumbDown: boolean
}

const HOLD_MS = 100
const GRACE_MS = 50

/** Debounces raw per-frame chord guesses into a stable, held chord. */
export function createChordStabilizer() {
  let committed: StabilizedChord | null = null
  let pending: StabilizedChord | null = null
  let pendingSince = 0
  let lastSeen = 0

  const same = (a: StabilizedChord | null, b: StabilizedChord | null) => {
    if (a === null && b === null) return true
    if (a === null || b === null) return false
    return (
      a.chord === b.chord &&
      a.isMajorMode === b.isMajorMode &&
      a.qualityIndex === b.qualityIndex &&
      a.thumbDown === b.thumbDown
    )
  }

  return function stabilize(input: StabilizedChord | null, now: number): StabilizedChord | null {
    if (input !== null) lastSeen = now
    let candidate = input
    if (input === null && now - lastSeen < GRACE_MS) candidate = pending

    if (!same(candidate, pending)) {
      pending = candidate
      pendingSince = now
    }
    if (now - pendingSince >= HOLD_MS) committed = pending
    return committed
  }
}

/** Same debounce logic as createChordStabilizer, for a plain Roman-numeral degree. */
export function createDegreeStabilizer() {
  let committed: string | null = null
  let pending: string | null = null
  let pendingSince = 0
  let lastSeen = 0

  return function stabilize(input: string | null, now: number): string | null {
    if (input !== null) lastSeen = now
    let candidate = input
    if (input === null && now - lastSeen < GRACE_MS) candidate = pending

    if (candidate !== pending) {
      pending = candidate
      pendingSince = now
    }
    if (now - pendingSince >= HOLD_MS) committed = pending
    return committed
  }
}
