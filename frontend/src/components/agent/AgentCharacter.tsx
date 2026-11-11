import { useEffect, useId, useState } from 'react'
import type { AgentApprovalMode, AgentLiveStatus } from '../../types'

export type CharacterMood =
  | AgentLiveStatus['state']
  | 'hovered'
  | 'dragging'
  | 'jumping'
  | 'running'

export const MOOD_FPS: Record<CharacterMood, number> = {
  idle: 8,       // Gentle float, scarf sway, cursor tracking & natural blinking
  hovered: 12,   // Friendly wave & happy curved visor eyes
  limit: 10,     // Patient pause
  thinking: 12,  // Curious tilted head & pulsing thinking dots
  error: 14,     // Cute dizzy shiver
  done: 16,      // Victory bounce & sparkles
  approval: 18,  // Urgent alert jump & wave
  jumping: 18,   // Squash-and-stretch leap
  running: 20,   // Playful sprint with fluttering scarf
  dragging: 20,  // Responsive dangling physics while held
  executing: 24, // High-speed telemetry work & spark bursts
}

interface SkinPalette {
  shellLight: string
  shellMid: string
  shellStroke: string
  visorBg: string
  podDark: string
  scarfStart: string
  scarfEnd: string
  eyeGlow: string
  blushColor: string
  idleAccent: string
}

const MODE_SKINS: Record<AgentApprovalMode, SkinPalette> = {
  safe: {
    // Harbor Guard — Warm Ceramic Pearl & Sky Blue
    shellLight: '#ffffff',
    shellMid: '#cbd5e1',
    shellStroke: '#475569',
    visorBg: '#071120',
    podDark: '#1e293b',
    scarfStart: '#38bdf8',
    scarfEnd: '#818cf8',
    eyeGlow: '#7dd3fc',
    blushColor: '#f472b6',
    idleAccent: '#38bdf8',
  },
  agent: {
    // Beacon Luma — Glossy Porcelain White, Obsidian Visor & Cyan-Mint Beacon Crystal/Scarf
    shellLight: '#ffffff',
    shellMid: '#dce6f2',
    shellStroke: '#334155',
    visorBg: '#050b16',
    podDark: '#0f172a',
    scarfStart: '#00e5ff',
    scarfEnd: '#34d399',
    eyeGlow: '#5eead4',
    blushColor: '#fb7185',
    idleAccent: '#22d3ee',
  },
  full: {
    // Overdrive Spark — Sleek Carbon Obsidian & Warm Solar Gold
    shellLight: '#3f3f46',
    shellMid: '#18181b',
    shellStroke: '#f59e0b',
    visorBg: '#07070b',
    podDark: '#27272a',
    scarfStart: '#fbbf24',
    scarfEnd: '#fb7185',
    eyeGlow: '#fde047',
    blushColor: '#fb923c',
    idleAccent: '#fbbf24',
  },
}

/** Advances a frame counter at the mood's target FPS. */
function useMoodFrameTicker(fps: number): number {
  const [frame, setFrame] = useState(0)
  useEffect(() => {
    const intervalMs = Math.max(16, Math.round(1000 / fps))
    const id = window.setInterval(() => {
      setFrame((f) => (f + 1) % 10000)
    }, intervalMs)
    return () => window.clearInterval(id)
  }, [fps])
  return frame
}

interface AgentCharacterProps {
  mood: CharacterMood
  mode?: AgentApprovalMode
  dragTilt?: number
  look?: { x: number; y: number }
  runDir?: 1 | -1
}

/** Beacon AI Mascot ("Luma") — Original chibi cyber-scout with glossy helmet, LED visor eyes & flowing cyan-mint scarf. */
export function AgentCharacter({
  mood,
  mode = 'agent',
  dragTilt = 0,
  look = { x: 0, y: 0 },
  runDir = 1,
}: AgentCharacterProps) {
  const uid = useId().replace(/:/g, '')
  const skin = MODE_SKINS[mode] || MODE_SKINS.agent
  const baseFps = MOOD_FPS[mood]
  const fps = mode === 'full' && mood === 'idle' ? 10 : baseFps
  const frame = useMoodFrameTicker(fps)

  const accent =
    mood === 'executing'
      ? mode === 'full'
        ? '#fbbf24'
        : '#22d3ee'
      : mood === 'done' || mood === 'jumping'
        ? '#34d399'
        : mood === 'thinking'
          ? '#38bdf8'
          : mood === 'approval' || mood === 'limit'
            ? '#fbbf24'
            : mood === 'error'
              ? '#f87171'
              : mood === 'dragging'
                ? '#c084fc'
                : mood === 'running'
                  ? mode === 'full'
                    ? '#fbbf24'
                    : '#22d3ee'
                  : skin.idleAccent

  const eyeColor =
    mood === 'error'
      ? '#f87171'
      : mood === 'approval' || mood === 'limit'
        ? '#fbbf24'
        : mood === 'done'
          ? '#34d399'
          : mood === 'dragging'
            ? '#c084fc'
            : skin.eyeGlow

  const lookX = Math.max(-1, Math.min(1, look.x))
  const lookY = Math.max(-1, Math.min(1, look.y))
  const eyeShiftX = lookX * 3.1
  const eyeShiftY = lookY * 2.1

  let bobY = 0
  let shakeX = 0
  let headTilt = 0
  let bodyLean = 0
  let squashX = 1
  let squashY = 1

  if (mood === 'idle') {
    bobY = Math.sin(frame * 0.4) * 1.8
    headTilt = lookX * 5.5
  } else if (mood === 'hovered') {
    bobY = -2.4 + Math.sin(frame * 0.72) * 1.6
    headTilt = 5 + lookX * 3
  } else if (mood === 'jumping') {
    const arc = Math.abs(Math.sin(frame * 0.45))
    bobY = 2 - arc * 13.5
    squashX = arc < 0.14 ? 1.1 : arc > 0.72 ? 0.93 : 1
    squashY = arc < 0.14 ? 0.88 : arc > 0.72 ? 1.07 : 1
    headTilt = Math.sin(frame * 0.45) * 4.5
  } else if (mood === 'running') {
    const stride = Math.sin(frame * 0.95)
    bobY = -Math.abs(stride) * 4.5
    bodyLean = 9
    headTilt = 5
  } else if (mood === 'thinking') {
    bobY = -2.4 + Math.sin(frame * 0.55) * 1.8
    headTilt = -7 + Math.sin(frame * 0.35) * 2.5
  } else if (mood === 'executing') {
    bobY = -1.6 + Math.sin(frame * 0.9) * 1.7
    headTilt = frame % 4 < 2 ? -2.4 : 2.4
  } else if (mood === 'limit') {
    bobY = 1 + Math.sin(frame * 0.45) * 1.1
    headTilt = -5 + lookX * 2
  } else if (mood === 'approval') {
    bobY = -Math.abs(Math.sin(frame * 0.55)) * 7
    headTilt = Math.sin(frame * 0.8) * 5.5
  } else if (mood === 'done') {
    bobY = -Math.abs(Math.sin(frame * 0.5)) * 6.5
    headTilt = Math.sin(frame * 0.6) * 6
  } else if (mood === 'error') {
    shakeX = Math.sin(frame * 2.2) * 2.4
    bobY = 1 + Math.cos(frame * 1.8) * 0.9
    headTilt = Math.sin(frame * 1.5) * 6.5
  } else if (mood === 'dragging') {
    bobY = -4 + Math.sin(frame * 0.8) * 1.4
    headTilt = dragTilt * 0.42 + lookX * 2.5
  }

  const liftFactor = Math.max(0.45, Math.min(1.05, 1 + bobY * 0.036))
  const shadowOpacity = mood === 'dragging' ? 0.2 : 0.42 * liftFactor
  const shadowRx = 19 * liftFactor

  const isBlinking = mood === 'idle' && (frame % 28 === 26 || frame % 28 === 27)

  // Chibi arms kinematics (shoulders around (26, 59) & (62, 59))
  let leftArmAngle = 16 + Math.sin(frame * 0.4) * 5
  let rightArmAngle = -16 - Math.sin(frame * 0.4) * 5
  let leftArmShiftY = 0
  let rightArmShiftY = 0

  if (mood === 'hovered') {
    leftArmAngle = 14
    rightArmAngle = -128 + Math.sin(frame * 0.95) * 24
    rightArmShiftY = -2
  } else if (mood === 'jumping') {
    const arc = Math.abs(Math.sin(frame * 0.45))
    leftArmAngle = 118 + arc * 30
    rightArmAngle = -118 - arc * 30
    leftArmShiftY = -2
    rightArmShiftY = -2
  } else if (mood === 'running') {
    const stride = Math.sin(frame * 0.95)
    leftArmAngle = -stride * 48
    rightArmAngle = stride * 48
  } else if (mood === 'thinking') {
    leftArmAngle = 16
    rightArmAngle = -84 + Math.sin(frame * 0.4) * 5
    rightArmShiftY = -3
  } else if (mood === 'executing') {
    const stroke = frame % 4
    leftArmAngle = stroke < 2 ? -34 : -14
    rightArmAngle = stroke >= 2 ? 34 : 14
    leftArmShiftY = stroke < 2 ? -2 : 1
    rightArmShiftY = stroke >= 2 ? -2 : 1
  } else if (mood === 'limit') {
    leftArmAngle = 14
    rightArmAngle = -14
  } else if (mood === 'approval') {
    const wave = Math.sin(frame * 0.8) * 18
    leftArmAngle = 130 + wave
    rightArmAngle = -130 - wave
  } else if (mood === 'done') {
    const pump = Math.sin(frame * 0.7) * 15
    leftArmAngle = 136 + pump
    rightArmAngle = -136 - pump
  } else if (mood === 'error') {
    leftArmAngle = 92 + Math.sin(frame * 1.6) * 6
    rightArmAngle = -92 - Math.sin(frame * 1.6) * 6
    leftArmShiftY = -3
    rightArmShiftY = -3
  } else if (mood === 'dragging') {
    leftArmAngle = 54 + dragTilt * 1.2 + Math.sin(frame * 0.9) * 12
    rightArmAngle = -54 + dragTilt * 1.2 - Math.sin(frame * 0.9) * 12
  }

  let leftFootX = 0
  let rightFootX = 0
  let leftFootY = 74
  let rightFootY = 74
  let footSwing = 0

  if (mood === 'executing') {
    leftFootY = frame % 4 < 2 ? 72.5 : 75
    rightFootY = frame % 4 >= 2 ? 72.5 : 75
  } else if (mood === 'running') {
    const stride = Math.sin(frame * 0.95)
    leftFootX = stride * 4.8
    rightFootX = -stride * 4.8
    leftFootY = 74 - Math.max(0, stride) * 3.5
    rightFootY = 74 - Math.max(0, -stride) * 3.5
  } else if (mood === 'jumping') {
    const arc = Math.abs(Math.sin(frame * 0.45))
    leftFootY = 74 - arc * 3.5
    rightFootY = 74 - arc * 3.5
  } else if (mood === 'approval' || mood === 'done') {
    leftFootY = 72.5
    rightFootY = 72.5
  } else if (mood === 'dragging') {
    footSwing = -dragTilt * 0.85 + Math.sin(frame * 0.85) * 6
  }

  const rigRotate = mood === 'dragging' ? dragTilt : mood === 'running' ? bodyLean : 0
  const flipTransform =
    mood === 'running' ? `translate(44, 0) scale(${runDir}, 1) translate(-44, 0) ` : ''
  const squashTransform =
    squashX !== 1 || squashY !== 1
      ? `translate(44, 82) scale(${squashX}, ${squashY}) translate(-44, -82) `
      : ''

  // Dynamic scarf tail wave
  const scarfFlutter =
    mood === 'running' || mood === 'dragging'
      ? Math.sin(frame * 1.1) * 5 + 3
      : Math.sin(frame * 0.45) * 2.4

  const shellGradId = `luma-shell-${uid}`
  const scarfGradId = `luma-scarf-${uid}`
  const visorGradId = `luma-visor-${uid}`

  return (
    <svg
      viewBox="0 0 88 94"
      className="w-[74px] h-[82px] overflow-visible select-none"
      style={{ filter: `drop-shadow(0 5px 12px rgba(0, 0, 0, 0.35))` }}
    >
      <defs>
        <radialGradient id={shellGradId} cx="35%" cy="28%" r="72%">
          <stop offset="0%" stopColor={skin.shellLight} />
          <stop offset="100%" stopColor={skin.shellMid} />
        </radialGradient>
        <linearGradient id={scarfGradId} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor={skin.scarfStart} />
          <stop offset="100%" stopColor={skin.scarfEnd} />
        </linearGradient>
        <linearGradient id={visorGradId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#0f1d32" />
          <stop offset="100%" stopColor={skin.visorBg} />
        </linearGradient>
      </defs>

      {/* Ground Shadow */}
      <ellipse cx="44" cy="87.5" rx={shadowRx} ry="4" fill="#000000" opacity={shadowOpacity} />

      {/* Running Dust Puffs */}
      {mood === 'running' && (
        <g transform={`translate(44, 0) scale(${runDir}, 1) translate(-44, 0)`} fill={accent} opacity="0.55">
          <circle cx={20 - (frame % 6) * 2.2} cy={82 - (frame % 4) * 0.8} r={2.4 - (frame % 6) * 0.25} />
          <circle
            cx={12 - ((frame + 3) % 6) * 2.2}
            cy={83 - ((frame + 2) % 4) * 0.7}
            r={1.8 - ((frame + 3) % 6) * 0.18}
          />
        </g>
      )}

      {/* Jump Speed Lines */}
      {mood === 'jumping' && (
        <g stroke={accent} strokeWidth="1.5" strokeLinecap="round" opacity="0.72">
          <line x1="16" y1="73" x2="16" y2="81" />
          <line x1="72" y1="73" x2="72" y2="81" />
        </g>
      )}

      {/* Telemetry Work Sparks */}
      {(mood === 'executing' || (mode === 'full' && mood === 'idle')) && (
        <g fill={accent} opacity={mood === 'executing' ? 0.9 : 0.5}>
          <circle cx={12 + ((frame * 3) % 10)} cy={58 - (frame % 16)} r="1.4" />
          <circle cx={76 - ((frame * 2) % 10)} cy={54 - ((frame + 7) % 16)} r="1.4" />
        </g>
      )}

      {/* Done Celebration Sparkles */}
      {mood === 'done' && (
        <g stroke={accent} strokeWidth="1.6" strokeLinecap="round" opacity={frame % 6 < 4 ? 0.95 : 0.45}>
          <path d="M12 21 L12 27 M9 24 L15 24" />
          <path d="M76 18 L76 24 M73 21 L79 21" />
          <circle cx="20" cy="11" r="1.4" fill={accent} stroke="none" />
          <circle cx="68" cy="12" r="1.4" fill={accent} stroke="none" />
        </g>
      )}

      {/* Thinking Bubbles */}
      {mood === 'thinking' && (
        <g fill={accent} opacity="0.88">
          <circle cx="69" cy="18" r={frame % 9 < 3 ? 1.8 : 1.3} opacity={frame % 9 < 3 ? 0.95 : 0.45} />
          <circle
            cx="74"
            cy="12"
            r={frame % 9 >= 3 && frame % 9 < 6 ? 2.4 : 1.7}
            opacity={frame % 9 >= 3 && frame % 9 < 6 ? 0.95 : 0.45}
          />
          <circle cx="79" cy="6" r={frame % 9 >= 6 ? 3 : 2.1} opacity={frame % 9 >= 6 ? 0.95 : 0.45} />
        </g>
      )}

      {/* Approval Sonar Ping */}
      {mood === 'approval' && (
        <circle
          cx="44"
          cy="40"
          r={28 + (frame % 6) * 1.6}
          fill="none"
          stroke={accent}
          strokeWidth="1.5"
          opacity={Math.max(0, 0.74 - (frame % 6) * 0.12)}
        />
      )}

      {/* Main Chibi Character Rig */}
      <g transform={`${flipTransform}${squashTransform}translate(${shakeX}, ${bobY}) rotate(${rigRotate}, 44, 52)`}>
        {/* Fluttering Cyan-Mint Beacon Signal Scarf Tail (behind body/head) */}
        <path
          d={`M 26 56 Q ${14 - scarfFlutter * 0.4} ${58 + scarfFlutter * 0.6} ${10 - scarfFlutter * 0.25} ${68 + scarfFlutter * 0.5} Q 18 69 27 62 Z`}
          fill={`url(#${scarfGradId})`}
          stroke={skin.shellStroke}
          strokeWidth="1"
          strokeLinejoin="round"
        />

        {/* Chibi Boots */}
        <g transform={`rotate(${footSwing}, 44, 68)`}>
          <rect
            x={30.5 + leftFootX}
            y={leftFootY}
            width="10.5"
            height="7.5"
            rx="3.75"
            fill={skin.podDark}
            stroke={skin.shellStroke}
            strokeWidth="1.25"
          />
          <rect
            x={47 + rightFootX}
            y={rightFootY}
            width="10.5"
            height="7.5"
            rx="3.75"
            fill={skin.podDark}
            stroke={skin.shellStroke}
            strokeWidth="1.25"
          />
          {/* Glowing Hover Boot Trim */}
          <rect x={32.5 + leftFootX} y={leftFootY + 5} width="6.5" height="1.5" rx="0.75" fill={accent} />
          <rect x={49 + rightFootX} y={rightFootY + 5} width="6.5" height="1.5" rx="0.75" fill={accent} />
        </g>

        {/* Left Chibi Arm */}
        <g transform={`translate(0, ${leftArmShiftY}) rotate(${leftArmAngle}, 27, 58)`}>
          <rect
            x="17.5"
            y="55"
            width="11"
            height="6.8"
            rx="3.4"
            fill={`url(#${shellGradId})`}
            stroke={skin.shellStroke}
            strokeWidth="1.25"
          />
          <circle cx="17.5" cy="58.4" r="2.8" fill={skin.podDark} stroke={accent} strokeWidth="1" />
        </g>

        {/* Right Chibi Arm */}
        <g transform={`translate(0, ${rightArmShiftY}) rotate(${rightArmAngle}, 61, 58)`}>
          <rect
            x="59.5"
            y="55"
            width="11"
            height="6.8"
            rx="3.4"
            fill={`url(#${shellGradId})`}
            stroke={skin.shellStroke}
            strokeWidth="1.25"
          />
          <circle cx="70.5" cy="58.4" r="2.8" fill={skin.podDark} stroke={accent} strokeWidth="1" />
        </g>

        {/* Plump Rounded Chibi Torso */}
        <rect
          x="28"
          y="53.5"
          width="32"
          height="22"
          rx="11"
          fill={`url(#${shellGradId})`}
          stroke={skin.shellStroke}
          strokeWidth="1.4"
        />

        {/* Chest Dark Suit Plate + Minimalist Beacon Core Pill */}
        <rect x="33.5" y="59" width="21" height="12.5" rx="5.5" fill={skin.podDark} />
        {mode === 'safe' ? (
          <path
            d="M44 61.2 L47.5 62.6 V65.3 C47.5 67.5 44 69 44 69 C44 69 40.5 67.5 40.5 65.3 V62.6 L44 61.2 Z"
            fill={accent}
          />
        ) : mode === 'full' ? (
          <path
            d="M44.8 60.8 L40.8 65.4 H43.6 L42.8 69.2 L47.2 64.4 H44.3 L44.8 60.8 Z"
            fill={accent}
          />
        ) : (
          <>
            {/* Signature Beacon Pill Light on Chest */}
            <rect
              x="38"
              y="64"
              width="12"
              height="3.2"
              rx="1.6"
              fill={`url(#${scarfGradId})`}
              opacity={mood === 'executing' || frame % 2 === 0 ? 1 : 0.8}
            />
          </>
        )}

        {/* Scarf Collar Wrap */}
        <rect
          x="29.5"
          y="52"
          width="29"
          height="5.2"
          rx="2.6"
          fill={`url(#${scarfGradId})`}
          stroke={skin.shellStroke}
          strokeWidth="1"
        />

        {/* Big Expressive Chibi Head + Beacon Drop Crest */}
        <g transform={`rotate(${headTilt}, 44, 51)`}>
          {/* Cute Beacon Teardrop / Crystal Fin Antenna on Top */}
          {mode === 'full' ? (
            <g>
              <path d="M26 20 L17 10 L23 18 Z" fill="#f59e0b" stroke="#78350f" strokeWidth="0.9" strokeLinejoin="round" />
              <path d="M62 20 L71 10 L65 18 Z" fill="#f59e0b" stroke="#78350f" strokeWidth="0.9" strokeLinejoin="round" />
            </g>
          ) : (
            <g>
              {/* Soft glow halo around Beacon teardrop crystal */}
              <circle cx="44" cy="9.5" r="7.5" fill={accent} opacity="0.22" />
              <path
                d="M 44 3.5 C 47.6 8.2 48.2 12.2 44 15 C 39.8 12.2 40.4 8.2 44 3.5 Z"
                fill={`url(#${scarfGradId})`}
                stroke={skin.shellStroke}
                strokeWidth="1"
              />
              <circle cx="43.2" cy="9" r="1.15" fill="#ffffff" opacity="0.9" />
            </g>
          )}

          {/* Soft Rounded Headphone Ear Pods */}
          <rect
            x="14.5"
            y="28.5"
            width="6"
            height="15"
            rx="3"
            fill={skin.podDark}
            stroke={skin.shellStroke}
            strokeWidth="1.2"
          />
          <rect
            x="67.5"
            y="28.5"
            width="6"
            height="15"
            rx="3"
            fill={skin.podDark}
            stroke={skin.shellStroke}
            strokeWidth="1.2"
          />
          <line x1="17.5" y1="32" x2="17.5" y2="40" stroke={accent} strokeWidth="1.6" strokeLinecap="round" />
          <line x1="70.5" y1="32" x2="70.5" y2="40" stroke={accent} strokeWidth="1.6" strokeLinecap="round" />

          {/* Smooth Pillowy Chibi Helmet Head */}
          <rect
            x="18.5"
            y="14.5"
            width="51"
            height="39.5"
            rx="19.5"
            fill={`url(#${shellGradId})`}
            stroke={skin.shellStroke}
            strokeWidth="1.5"
          />

          {/* Top Ceramic Specular Shine */}
          <path
            d="M31 18.2 Q44 16.5 57 18.2"
            fill="none"
            stroke="#ffffff"
            strokeWidth="1.8"
            strokeLinecap="round"
            opacity="0.72"
          />

          {/* Wide Dark Curved Visor Screen */}
          <rect
            x="23.5"
            y="21.5"
            width="41"
            height="27"
            rx="13"
            fill={`url(#${visorGradId})`}
            stroke={accent}
            strokeWidth="1.3"
            strokeOpacity="0.82"
          />

          {/* Glossy Diagonal Glass Reflection in Visor */}
          <path
            d="M29 25 Q35 23 41 24.5"
            fill="none"
            stroke="#ffffff"
            strokeWidth="1.2"
            strokeLinecap="round"
            opacity="0.22"
          />

          {/* Warm Cute Cheek Blush + Expressive Astro-Bot LED Eyes (tracking cursor inside visor!) */}
          {mood === 'executing' ? (
            <g>
              {/* Crisp terminal prompt > _ */}
              <path
                d="M31.5 31 L37.5 35 L31.5 39"
                fill="none"
                stroke={eyeColor}
                strokeWidth="2.6"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <rect x="42" y="37" width="11" height="2.8" rx="1.4" fill={eyeColor} opacity={frame % 4 < 2 ? 1 : 0.28} />
              <rect x="55" y={30 + (frame % 3)} width="2.5" height={7 - (frame % 3)} rx="1.2" fill="#38bdf8" />
            </g>
          ) : mood === 'thinking' ? (
            <g>
              {/* Pondering big/small glowing LED eyes + animated dots */}
              <rect x="31" y="29" width="7.2" height="9.2" rx="3.6" fill={eyeColor} />
              <circle cx="33.5" cy="31.5" r="1.4" fill="#ffffff" />
              <rect x="49.5" y="32" width="7.2" height="5.5" rx="2.75" fill={eyeColor} />
              <circle cx="40" cy="42.5" r="1.2" fill={eyeColor} opacity={frame % 6 < 2 ? 1 : 0.25} />
              <circle cx="44" cy="42.5" r="1.2" fill={eyeColor} opacity={frame % 6 >= 2 && frame % 6 < 4 ? 1 : 0.25} />
              <circle cx="48" cy="42.5" r="1.2" fill={eyeColor} opacity={frame % 6 >= 4 ? 1 : 0.25} />
            </g>
          ) : mood === 'limit' ? (
            <g>
              <line x1="30.5" y1="33.5" x2="38.5" y2="33.5" stroke={eyeColor} strokeWidth="2.5" strokeLinecap="round" />
              <line x1="49.5" y1="33.5" x2="57.5" y2="33.5" stroke={eyeColor} strokeWidth="2.5" strokeLinecap="round" />
              <rect x="41.5" y="39.5" width="2" height="4.5" rx="1" fill={eyeColor} opacity={frame % 6 < 4 ? 0.95 : 0.35} />
              <rect x="45" y="39.5" width="2" height="4.5" rx="1" fill={eyeColor} opacity={frame % 6 < 4 ? 0.95 : 0.35} />
            </g>
          ) : mood === 'approval' ? (
            <g fill="#fbbf24">
              <rect x="33.5" y="27.5" width="3.6" height="9" rx="1.8" />
              <circle cx="35.3" cy="39.8" r="1.9" />
              <rect x="50.9" y="27.5" width="3.6" height="9" rx="1.8" />
              <circle cx="52.7" cy="39.8" r="1.9" />
            </g>
          ) : mood === 'error' ? (
            <g>
              <path d="M31 30.5 L37.5 34.5 L31 38.5" fill="none" stroke="#f87171" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
              <path d="M57 30.5 L50.5 34.5 L57 38.5" fill="none" stroke="#f87171" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
              <path d="M38 42.2 Q41 40.2 44 42.2 Q47 44.2 50 42.2" fill="none" stroke="#f87171" strokeWidth="1.7" strokeLinecap="round" />
              <path
                d={`M 65.5 ${21 + (frame % 4) * 0.7} Q 68 25 65.5 27.5 Q 63 25 65.5 ${21 + (frame % 4) * 0.7} Z`}
                fill="#38bdf8"
              />
            </g>
          ) : mood === 'dragging' ? (
            <g>
              {/* Wide surprised LED circles */}
              <circle cx={35 + eyeShiftX * 0.6} cy={34.5 + eyeShiftY * 0.6} r="4.8" fill={eyeColor} />
              <circle cx={33.6 + eyeShiftX * 0.6} cy={32.6 + eyeShiftY * 0.6} r="1.5" fill="#ffffff" />
              <circle cx={53 + eyeShiftX * 0.6} cy={34.5 + eyeShiftY * 0.6} r="4.8" fill={eyeColor} />
              <circle cx={51.6 + eyeShiftX * 0.6} cy={32.6 + eyeShiftY * 0.6} r="1.5" fill="#ffffff" />
              <ellipse cx="44" cy="42.5" rx="2.4" ry="2" fill="none" stroke={eyeColor} strokeWidth="1.7" />
            </g>
          ) : mood === 'running' ? (
            <g>
              {/* Determined angled racing eyes */}
              <path d="M31 30.5 L38.5 33 V36.5 Q38.5 39 34.8 39 Q31 39 31 36.5 Z" fill={eyeColor} />
              <circle cx="33.5" cy="33.5" r="1.2" fill="#ffffff" />
              <path d="M57 30.5 L49.5 33 V36.5 Q49.5 39 53.2 39 Q57 39 57 36.5 Z" fill={eyeColor} />
              <circle cx="52" cy="33.5" r="1.2" fill="#ffffff" />
              <path d="M40 41.2 Q44 44.5 48 41.2" fill="none" stroke={eyeColor} strokeWidth="1.8" strokeLinecap="round" />
            </g>
          ) : mood === 'done' || mood === 'hovered' || mood === 'jumping' ? (
            <g>
              {/* Super happy ^ ^ curved LED smile eyes + rosy blush */}
              <path d="M30.5 36.5 Q35 29.5 39.5 36.5" fill="none" stroke={eyeColor} strokeWidth="2.8" strokeLinecap="round" />
              <path d="M48.5 36.5 Q53 29.5 57.5 36.5" fill="none" stroke={eyeColor} strokeWidth="2.8" strokeLinecap="round" />
              <path d="M39.5 40.5 Q44 45 48.5 40.5" fill="none" stroke={eyeColor} strokeWidth="2" strokeLinecap="round" />
              <ellipse cx="29.5" cy="40.2" rx="2.5" ry="1.3" fill={skin.blushColor} opacity="0.55" />
              <ellipse cx="58.5" cy="40.2" rx="2.5" ry="1.3" fill={skin.blushColor} opacity="0.55" />
            </g>
          ) : (
            <g>
              {/* Default Warm Chibi Visor Eyes with Smooth Cursor Tracking & Specular Shine */}
              <g transform={`translate(${eyeShiftX}, ${eyeShiftY})`}>
                <rect
                  x="31"
                  y={isBlinking ? 34 : 29}
                  width="7.2"
                  height={isBlinking ? 2 : 10.2}
                  rx={isBlinking ? 1 : 3.6}
                  fill={eyeColor}
                />
                <rect
                  x="49.8"
                  y={isBlinking ? 34 : 29}
                  width="7.2"
                  height={isBlinking ? 2 : 10.2}
                  rx={isBlinking ? 1 : 3.6}
                  fill={eyeColor}
                />
                {!isBlinking && (
                  <>
                    <circle cx="33.3" cy="31.8" r="1.45" fill="#ffffff" opacity="0.95" />
                    <circle cx="35.6" cy="35.4" r="0.65" fill="#ffffff" opacity="0.7" />
                    <circle cx="52.1" cy="31.8" r="1.45" fill="#ffffff" opacity="0.95" />
                    <circle cx="54.4" cy="35.4" r="0.65" fill="#ffffff" opacity="0.7" />
                  </>
                )}
              </g>
              {/* Soft Blush + Tiny Smile */}
              <ellipse cx="29.5" cy="41.2" rx="2.2" ry="1.15" fill={skin.blushColor} opacity="0.42" />
              <ellipse cx="58.5" cy="41.2" rx="2.2" ry="1.15" fill={skin.blushColor} opacity="0.42" />
              <path
                d={`M40.8 41.8 Q44 ${44 + lookY * 0.6} 47.2 41.8`}
                fill="none"
                stroke={eyeColor}
                strokeWidth="1.6"
                strokeLinecap="round"
                opacity="0.9"
              />
            </g>
          )}
        </g>
      </g>
    </svg>
  )
}
