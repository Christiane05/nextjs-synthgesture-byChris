"use client"

import dynamic from "next/dynamic"

// Camera/AudioContext/MediaPipe are browser-only — never render this on the server.
const GestureSynthApp = dynamic(
  () => import("@/components/GestureSynthApp").then((m) => m.GestureSynthApp),
  { ssr: false },
)

export default function Home() {
  return <GestureSynthApp />
}
