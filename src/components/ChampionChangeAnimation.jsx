import React, { useEffect, useMemo, useRef, useState } from 'react'

// ── Inline SVG cartoon characters ────────────────────────────────────────
// Kept as flat, simple shapes on purpose — no external image assets.

export function Podium({ style }) {
  return (
    <svg viewBox="0 0 110 70" width="110" height="70" style={style}>
      <rect x="0" y="6" width="110" height="64" rx="6" fill="#D9B36C" />
      <rect x="0" y="6" width="110" height="12" rx="6" fill="#F2D28C" />
      <rect x="4" y="30" width="102" height="4" fill="#C99A4A" opacity="0.6" />
      <text x="55" y="52" textAnchor="middle" fontSize="20" fontWeight="700" fill="#8A6420" fontFamily="system-ui,sans-serif">★</text>
    </svg>
  )
}

export function Trophy({ style }) {
  return (
    <svg viewBox="0 0 40 50" width="40" height="50" style={style}>
      <path d="M8 4 H32 L30 20 C30 28 25 33 20 33 C15 33 10 28 10 20 Z" fill="#F2C94C" stroke="#C99A1E" strokeWidth="1.5" />
      <path d="M8 6 C0 6 0 18 9 18" fill="none" stroke="#C99A1E" strokeWidth="2.5" />
      <path d="M32 6 C40 6 40 18 31 18" fill="none" stroke="#C99A1E" strokeWidth="2.5" />
      <rect x="17" y="33" width="6" height="8" fill="#F2C94C" stroke="#C99A1E" strokeWidth="1" />
      <rect x="10" y="41" width="20" height="6" rx="1.5" fill="#E0AC2E" stroke="#C99A1E" strokeWidth="1" />
      <rect x="6" y="47" width="28" height="3" rx="1.5" fill="#C99A1E" />
    </svg>
  )
}

export function ChampionFemale({ pose = 'trophy', style, className }) {
  // pose: 'trophy' (holding it up on the podium), 'flying' (arms out, mid-spin),
  // 'landed' (relaxed + thumbs-up)
  const armsUp = pose === 'trophy'
  const armsOut = pose === 'flying'
  return (
    <svg viewBox="0 0 74 104" width="74" height="104" style={style} className={className}>
      {/* ponytail */}
      <path d="M50 14 C64 10 66 30 56 34 C60 22 54 16 50 14 Z" fill="#3B2416" />
      {/* legs */}
      <rect x="26" y="82" width="9" height="20" rx="3" fill="#3B2416" />
      <rect x="39" y="82" width="9" height="20" rx="3" fill="#3B2416" />
      <ellipse cx="30.5" cy="102" rx="7" ry="3.5" fill="#7A1F3D" />
      <ellipse cx="43.5" cy="102" rx="7" ry="3.5" fill="#7A1F3D" />
      {/* kurti/saree body */}
      <path d="M23 40 L51 40 L57 84 L17 84 Z" fill="#D6336C" />
      <path d="M23 40 L51 40 L49 50 L25 50 Z" fill="#F2C94C" opacity="0.85" />
      <path d="M40 40 L57 84 L49 84 L34 42 Z" fill="#B0245A" opacity="0.55" />
      {/* arms */}
      {armsUp && (
        <>
          <path d="M25 46 C14 40 10 22 14 14" stroke="#D6336C" strokeWidth="8" strokeLinecap="round" fill="none" />
          <path d="M49 46 C60 40 64 22 60 14" stroke="#D6336C" strokeWidth="8" strokeLinecap="round" fill="none" />
          <circle cx="14" cy="13" r="5" fill="#F1C27D" />
          <circle cx="60" cy="13" r="5" fill="#F1C27D" />
        </>
      )}
      {armsOut && (
        <>
          <path d="M23 48 L-2 40" stroke="#D6336C" strokeWidth="8" strokeLinecap="round" fill="none" />
          <path d="M51 48 L76 40" stroke="#D6336C" strokeWidth="8" strokeLinecap="round" fill="none" />
          <circle cx="-2" cy="40" r="5" fill="#F1C27D" />
          <circle cx="76" cy="40" r="5" fill="#F1C27D" />
        </>
      )}
      {pose === 'landed' && (
        <>
          <path d="M23 50 C12 52 8 46 8 40" stroke="#D6336C" strokeWidth="8" strokeLinecap="round" fill="none" />
          <circle cx="8" cy="39" r="5" fill="#F1C27D" />
          <rect x="6.5" y="30" width="3" height="8" rx="1.5" fill="#F1C27D" />
          <path d="M51 50 C58 54 60 60 58 66" stroke="#D6336C" strokeWidth="8" strokeLinecap="round" fill="none" />
          <circle cx="58" cy="67" r="5" fill="#F1C27D" />
        </>
      )}
      {/* head */}
      <circle cx="37" cy="22" r="16" fill="#F1C27D" />
      <path d="M22 20 C22 6 52 6 52 20 C48 12 26 12 22 20 Z" fill="#3B2416" />
      {/* face */}
      <circle cx="31" cy="23" r="1.6" fill="#2A1B10" />
      <circle cx="43" cy="23" r="1.6" fill="#2A1B10" />
      <path d="M30 29 Q37 34 44 29" stroke="#7A3B1F" strokeWidth="2" fill="none" strokeLinecap="round" />
    </svg>
  )
}

export function ChampionMale({ pose = 'angry', style, className }) {
  // pose: 'angry' (marching in, fists clenched), 'bounce' (belly puffed out),
  // 'lift' (arms up holding the trophy on the podium)
  const lifting = pose === 'lift'
  const bouncing = pose === 'bounce'
  return (
    <svg viewBox="0 0 86 108" width="86" height="108" style={style} className={className}>
      {/* legs */}
      <rect x="30" y="86" width="10" height="20" rx="3" fill="#2B3A55" />
      <rect x="46" y="86" width="10" height="20" rx="3" fill="#2B3A55" />
      <ellipse cx="35" cy="106" rx="8" ry="4" fill="#1B2438" />
      <ellipse cx="51" cy="106" rx="8" ry="4" fill="#1B2438" />
      {/* chubby belly */}
      <ellipse cx="43" cy={bouncing ? 68 : 70} rx={bouncing ? 34 : 29} ry={bouncing ? 28 : 25} fill="#2F80ED" />
      <ellipse cx="43" cy={bouncing ? 68 : 70} rx={bouncing ? 20 : 16} ry={bouncing ? 16 : 13} fill="#5B9BF5" opacity="0.5" />
      {/* arms */}
      {!lifting && (
        <>
          <path d="M16 62 C6 66 4 76 8 82" stroke="#2F80ED" strokeWidth="10" strokeLinecap="round" fill="none" />
          <circle cx="8" cy="83" r="8" fill="#E0A96D" />
          <path d="M70 62 C80 66 82 76 78 82" stroke="#2F80ED" strokeWidth="10" strokeLinecap="round" fill="none" />
          <circle cx="78" cy="83" r="8" fill="#E0A96D" />
        </>
      )}
      {lifting && (
        <>
          <path d="M20 58 C10 44 10 26 16 14" stroke="#2F80ED" strokeWidth="10" strokeLinecap="round" fill="none" />
          <circle cx="17" cy="13" r="7" fill="#E0A96D" />
          <path d="M66 58 C76 44 76 26 70 14" stroke="#2F80ED" strokeWidth="10" strokeLinecap="round" fill="none" />
          <circle cx="69" cy="13" r="7" fill="#E0A96D" />
        </>
      )}
      {/* head */}
      <circle cx="43" cy="20" r="15" fill="#E0A96D" />
      <path d="M27 16 C29 4 40 2 43 6 C46 2 57 4 59 16 C50 10 36 10 27 16 Z" fill="#241708" />
      {/* grumpy/determined eyebrows */}
      <path d="M28 15 L38 20" stroke="#241708" strokeWidth="3" strokeLinecap="round" />
      <path d="M58 15 L48 20" stroke="#241708" strokeWidth="3" strokeLinecap="round" />
      <circle cx="35" cy="23" r="1.6" fill="#241708" />
      <circle cx="51" cy="23" r="1.6" fill="#241708" />
      <path d="M36 30 Q43 27 50 30" stroke="#7A3B1F" strokeWidth="2" fill="none" strokeLinecap="round" />
    </svg>
  )
}

// ── Confetti (plain CSS, no library) ─────────────────────────────────────
const CONFETTI_COLORS = ['#F2C94C', '#EB5757', '#2F80ED', '#27AE60', '#D6336C', '#9B51E0']

function Confetti({ count = 40 }) {
  const pieces = useMemo(() => (
    Array.from({ length: count }).map((_, i) => ({
      id: i,
      left: Math.random() * 100,
      delay: Math.random() * 0.5,
      duration: 1.6 + Math.random() * 1.2,
      color: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
      rotate: Math.random() * 360,
      size: 6 + Math.random() * 5,
    }))
  ), [count])
  return (
    <div style={{ position: 'absolute', inset: 0, overflow: 'hidden', pointerEvents: 'none' }}>
      {pieces.map(p => (
        <span
          key={p.id}
          className="champ-confetti-piece"
          style={{
            left: `${p.left}%`,
            width: p.size,
            height: p.size * 0.4,
            background: p.color,
            animationDelay: `${p.delay}s`,
            animationDuration: `${p.duration}s`,
            transform: `rotate(${p.rotate}deg)`,
          }}
        />
      ))}
    </div>
  )
}

const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)'

function prefersReducedMotion() {
  try {
    return window.matchMedia && window.matchMedia(REDUCED_MOTION_QUERY).matches
  } catch {
    return false
  }
}

// Timeline (ms from mount): 0 fade-in previous champion → 1000 new champion
// marches in → 2000 belly-bounce hands off the trophy → 3000 he climbs the
// podium & lifts it → 4500 banner slides in → 6000 animation ends (click
// anywhere now closes it) → 7500 auto-close.
const PHASE_TIMES = [0, 1000, 2000, 3000, 4500, 6000, 7500]

export default function ChampionChangeAnimation({ currentChampion, previousChampion, onClose }) {
  const reducedMotion = useMemo(prefersReducedMotion, [])
  const [phase, setPhase] = useState(0)
  const [scale, setScale] = useState(1)
  const timers = useRef([])
  const closedRef = useRef(false)

  useEffect(() => {
    const calc = () => setScale(Math.min(1, (window.innerWidth - 32) / 460))
    calc()
    window.addEventListener('resize', calc)
    return () => window.removeEventListener('resize', calc)
  }, [])

  useEffect(() => {
    if (reducedMotion) return
    timers.current = PHASE_TIMES.slice(1).map((t, i) =>
      setTimeout(() => setPhase(i + 1), t)
    )
    const autoClose = setTimeout(() => handleClose(), PHASE_TIMES[PHASE_TIMES.length - 1])
    timers.current.push(autoClose)
    return () => { timers.current.forEach(clearTimeout); timers.current = [] }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reducedMotion])

  const handleClose = () => {
    if (closedRef.current) return
    closedRef.current = true
    timers.current.forEach(clearTimeout)
    onClose && onClose()
  }

  const animationEnded = reducedMotion || phase >= 5

  const currentName = currentChampion?.name || 'New Champion'
  const previousName = previousChampion?.name || 'Last Month\'s Champion'
  const currentGender = currentChampion?.gender === 'female' ? 'female' : 'male'
  const previousGender = previousChampion?.gender === 'female' ? 'female' : 'male'

  const CurrentChampionSprite = currentGender === 'female' ? ChampionFemale : ChampionMale
  const PreviousChampionSprite = previousGender === 'female' ? ChampionFemale : ChampionMale

  if (reducedMotion) {
    return (
      <div
        role="dialog"
        aria-label="New champion celebration"
        onClick={handleClose}
        style={overlayStyle}
      >
        <button aria-label="Skip" onClick={(e) => { e.stopPropagation(); handleClose() }} style={skipBtnStyle}>Skip ✕</button>
        <div onClick={(e) => e.stopPropagation()} style={{ background: '#fff', borderRadius: 16, padding: '28px 32px', textAlign: 'center', maxWidth: 320, boxShadow: '0 10px 40px rgba(0,0,0,0.3)' }}>
          <Trophy style={{ margin: '0 auto 12px' }} />
          <div style={{ fontSize: 20, fontWeight: 800, color: '#111827', marginBottom: 6 }}>🏆 New Champion: {currentName}!</div>
          <div style={{ fontSize: 13.5, color: '#6b7280' }}>Dethroned {previousName} — rematch next month? 😄</div>
          <button onClick={handleClose} style={{ marginTop: 16, padding: '8px 18px', borderRadius: 8, border: 'none', background: '#185FA5', color: '#fff', fontWeight: 600, cursor: 'pointer' }}>Nice!</button>
        </div>
      </div>
    )
  }

  return (
    <div
      role="dialog"
      aria-label="New champion celebration"
      onClick={() => { if (animationEnded) handleClose() }}
      style={overlayStyle}
    >
      <style>{CHAMP_ANIM_CSS}</style>
      <button aria-label="Skip" onClick={(e) => { e.stopPropagation(); handleClose() }} style={skipBtnStyle}>Skip ✕</button>

      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', width: '100%', height: '100%' }}>
        <div
          style={{ position: 'relative', width: 460, height: 380, transform: `scale(${scale})`, transformOrigin: 'center center' }}
        >
          {phase >= 3 && <Confetti />}
          {phase >= 3 && (
            <div className="champ-glow" style={{ position: 'absolute', left: 189 - 70, bottom: 84 - 30, width: 220, height: 220 }} />
          )}

          <Podium style={{ position: 'absolute', left: 175, bottom: 0 }} />

          {/* trophy */}
          <Trophy
            style={{
              position: 'absolute',
              ...trophyPositionForPhase(phase),
            }}
          />

          {/* previous champion */}
          <PreviousChampionSprite
            pose={phase < 2 ? 'trophy' : phase === 2 ? 'flying' : 'landed'}
            className={
              phase === 0 ? 'champ-pop-in' :
              phase === 2 ? 'champ-fly-off' :
              phase >= 3 ? 'champ-landed' : ''
            }
            style={{ position: 'absolute', ...prevPositionForPhase(phase) }}
          />
          {phase >= 3 && (
            <div className="champ-land-cushion" style={{ position: 'absolute', left: 356, bottom: 24, width: 60, height: 18 }} />
          )}
          {phase === 2 && (
            <div className="champ-dizzy" style={{ position: 'absolute', left: 372, bottom: 96 }}>💫</div>
          )}
          {phase >= 3 && (
            <div className="champ-thumbsup" style={{ position: 'absolute', left: 396, bottom: 60, fontSize: 20 }}>👍</div>
          )}

          {/* new champion */}
          <CurrentChampionSprite
            pose={phase === 2 ? 'bounce' : phase >= 3 ? 'lift' : 'angry'}
            className={phase >= 1 ? (phase === 1 ? 'champ-male-move champ-march-in' : 'champ-male-move') : ''}
            style={{ position: 'absolute', ...newChampPositionForPhase(phase) }}
          />
          {phase === 1 && (
            <div className="champ-puff" style={{ position: 'absolute', left: 60, bottom: 100 }}>😤</div>
          )}
          {phase === 2 && (
            <div className="champ-boing" style={{ position: 'absolute', left: 150, bottom: 110 }}>💥 BOING!</div>
          )}

          {phase >= 4 && (
            <div className="champ-banner" style={{ position: 'absolute', left: 0, right: 0, bottom: -70, textAlign: 'center' }}>
              <div style={{ display: 'inline-block', background: 'linear-gradient(135deg,#F2C94C,#F2994A)', borderRadius: 14, padding: '10px 22px', boxShadow: '0 8px 24px rgba(0,0,0,0.35)' }}>
                <div style={{ fontSize: 19, fontWeight: 800, color: '#3B2416' }}>🏆 New Champion: {currentName}!</div>
                <div style={{ fontSize: 12.5, fontWeight: 600, color: '#5C3A17', marginTop: 2 }}>Dethroned {previousName} — rematch next month? 😄</div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Per-phase absolute position helpers (left/bottom in the 460×380 stage) ──
function prevPositionForPhase(phase) {
  if (phase < 2) return { left: 193, bottom: 84 }
  return { left: 372, bottom: 46 }
}
function newChampPositionForPhase(phase) {
  if (phase === 0) return { left: -100, bottom: 14, opacity: 0 }
  if (phase === 1) return { left: 40, bottom: 14, opacity: 1 }
  if (phase === 2) return { left: 108, bottom: 14, opacity: 1 }
  return { left: 189, bottom: 84, opacity: 1 }
}
function trophyPositionForPhase(phase) {
  if (phase < 2) return { left: 213, bottom: 168, transition: 'none' }
  if (phase === 2) return { left: 260, bottom: 250, transition: 'left 0.9s ease-out, bottom 0.9s ease-out' }
  return { left: 209, bottom: 200, transition: 'left 0.9s ease-in, bottom 0.9s ease-in' }
}

const overlayStyle = {
  position: 'fixed',
  inset: 0,
  zIndex: 999999,
  background: 'rgba(10,12,20,0.72)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
}

const skipBtnStyle = {
  position: 'absolute',
  top: 16,
  right: 16,
  zIndex: 1,
  padding: '8px 14px',
  borderRadius: 20,
  border: '1px solid rgba(255,255,255,0.3)',
  background: 'rgba(255,255,255,0.12)',
  color: '#fff',
  fontWeight: 700,
  fontSize: 13,
  cursor: 'pointer',
}

const CHAMP_ANIM_CSS = `
@keyframes champPopIn { from{ opacity:0; transform:scale(0.7); } to{ opacity:1; transform:scale(1); } }
.champ-pop-in { animation: champPopIn 0.5s cubic-bezier(.34,1.56,.64,1) both; }

@keyframes champMarchIn {
  0%   { transform: translateY(0) rotate(0deg); }
  20%  { transform: translateY(-9px) rotate(-5deg); }
  40%  { transform: translateY(0) rotate(5deg); }
  60%  { transform: translateY(-7px) rotate(-4deg); }
  80%  { transform: translateY(0) rotate(3deg); }
  100% { transform: translateY(0) rotate(0deg); }
}
.champ-male-move { transition: left 0.7s ease, bottom 0.7s ease; }
.champ-march-in { animation: champMarchIn 1s ease-in-out both; transition: left 1s ease-in-out; }

@keyframes champFlyOff {
  0%   { opacity:1; }
  100% { opacity:1; }
}
.champ-fly-off { transition: left 0.9s cubic-bezier(.34,1.2,.4,1), bottom 0.9s cubic-bezier(.34,1.2,.4,1); animation: champSpin 0.9s ease-out both; }
@keyframes champSpin { from{ transform:rotate(0deg) scale(1); } to{ transform:rotate(480deg) scale(0.85); } }

.champ-landed { transform: rotate(480deg) scale(0.85); transition: left 0.4s ease, bottom 0.4s ease; }

@keyframes champDizzy { from{ transform:rotate(0deg) translateX(0); } to{ transform:rotate(360deg) translateX(0); } }
.champ-dizzy { font-size: 20px; animation: champDizzy 1s linear infinite; }

@keyframes champBoingPop {
  0%   { opacity:0; transform:scale(0.4) rotate(-8deg); }
  30%  { opacity:1; transform:scale(1.2) rotate(4deg); }
  60%  { opacity:1; transform:scale(1) rotate(-2deg); }
  100% { opacity:0; transform:scale(1) rotate(0deg); }
}
.champ-boing { font-weight:800; font-size:20px; color:#fff; text-shadow:0 2px 6px rgba(0,0,0,0.5); animation: champBoingPop 0.9s ease-out both; white-space:nowrap; }

@keyframes champPuff {
  0%   { opacity:0; transform:translateY(6px) scale(0.6); }
  40%  { opacity:1; transform:translateY(-6px) scale(1.1); }
  100% { opacity:0; transform:translateY(-16px) scale(1); }
}
.champ-puff { font-size:22px; animation: champPuff 1s ease-out both; }

.champ-glow {
  background: radial-gradient(circle, rgba(242,201,76,0.55) 0%, rgba(242,201,76,0) 70%);
  animation: champGlowPulse 1.6s ease-in-out infinite;
  border-radius: 50%;
}
@keyframes champGlowPulse { 0%,100% { opacity:0.6; } 50% { opacity:1; } }

.champ-land-cushion { background:#9B51E0; border-radius:50%; opacity:0.85; }

@keyframes champBannerIn { from{ opacity:0; transform:translateY(24px); } to{ opacity:1; transform:translateY(0); } }
.champ-banner { animation: champBannerIn 0.6s cubic-bezier(.34,1.2,.4,1) both; }

@keyframes champConfettiFall {
  0%   { transform: translateY(-20px) rotate(0deg); opacity:1; }
  100% { transform: translateY(420px) rotate(360deg); opacity:0.9; }
}
.champ-confetti-piece { position:absolute; top:-10px; border-radius:1px; animation-name: champConfettiFall; animation-timing-function: ease-in; animation-fill-mode: both; }

@media (prefers-reduced-motion: reduce) {
  .champ-pop-in, .champ-march-in, .champ-fly-off, .champ-landed, .champ-dizzy, .champ-boing, .champ-puff, .champ-glow, .champ-banner, .champ-confetti-piece {
    animation: none !important;
    transition: none !important;
  }
}
`
