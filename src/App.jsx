import { memo, useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import {
  deleteCloudAccount,
  deleteCloudFolder,
  deleteCloudPrompt,
  deleteCloudSavingsTxn,
  fileToLocalPreview,
  loadCloudAccounts,
  loadCloudFolders,
  loadCloudPrompts,
  loadCloudSavings,
  normalizePrompt,
  readLocalAccounts,
  readLocalFolders,
  readLocalPrompts,
  readLocalSavings,
  saveCloudAccount,
  saveCloudFolder,
  saveCloudPrompt,
  saveCloudSavingsTxn,
  updateCloudAccount,
  updateCloudAccountOrder,
  updateCloudPrompt,
  updateCloudPromptsOrder,
  writeLocalAccounts,
  writeLocalFolders,
  writeLocalPrompts,
  writeLocalSavings,
} from './lib/repository'

const PIN = '1449'
const PIN_SESSION_KEY = 'mix-image-prompt-vault.unlocked'
const PIN_PERSIST_KEY = 'mix-image-prompt-vault.unlocked.until'
const UNLOCK_TTL_MS = 24 * 60 * 60 * 1000 // จดจำการปลดล็อกบนมือถือ 24 ชม. ไม่ต้องกรอกใหม่เมื่อสลับแอป
const isTouchDevice = typeof window !== 'undefined' && ('ontouchstart' in window || navigator.maxTouchPoints > 0)

function isSessionUnlocked() {
  try {
    if (sessionStorage.getItem(PIN_SESSION_KEY) === 'true') return true
    const until = Number(localStorage.getItem(PIN_PERSIST_KEY) || 0)
    if (until > Date.now()) {
      sessionStorage.setItem(PIN_SESSION_KEY, 'true')
      return true
    }
  } catch {
    // Ignore storage errors
  }
  return false
}

function persistUnlock() {
  try {
    sessionStorage.setItem(PIN_SESSION_KEY, 'true')
    localStorage.setItem(PIN_PERSIST_KEY, String(Date.now() + UNLOCK_TTL_MS))
  } catch {
    // Ignore storage errors
  }
}

function clearUnlock() {
  try {
    sessionStorage.removeItem(PIN_SESSION_KEY)
    localStorage.removeItem(PIN_PERSIST_KEY)
  } catch {
    // Ignore storage errors
  }
}

// คัดลอกข้อความแบบรองรับทุกเบราว์เซอร์มือถือ รวมถึง LINE / Facebook WebView และ iOS Safari
async function safeCopyText(text) {
  const value = text || ''
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(value)
      return true
    }
  } catch {
    // Fallback below
  }
  try {
    const textarea = document.createElement('textarea')
    textarea.value = value
    textarea.setAttribute('readonly', '')
    textarea.style.position = 'fixed'
    textarea.style.top = '-9999px'
    textarea.style.left = '-9999px'
    textarea.style.opacity = '0'
    document.body.appendChild(textarea)
    textarea.focus()
    textarea.select()
    textarea.setSelectionRange(0, value.length)
    document.execCommand('copy')
    document.body.removeChild(textarea)
    return true
  } catch {
    return false
  }
}

const categories = [
  { id: 'all', label: 'ทั้งหมด', color: 'slate', icon: 'sparkles' },
  { id: 'main', label: 'ทั่วไป', color: 'orange', icon: 'prompt' },
  { id: 'note', label: 'โน้ตส่วนตัว', color: 'purple', icon: 'note' },
  { id: 'portrait', label: 'ภาพบุคคล', color: 'pink', icon: 'user' },
  { id: 'product', label: 'สินค้า / โฆษณา', color: 'cyan', icon: 'sparkles' },
  { id: 'landscape', label: 'ฉาก / สถานที่', color: 'blue', icon: 'image' },
  { id: 'sound', label: 'งานเสียง / เพลง', color: 'green', icon: 'music' },
]

const popularTools = [
  'Midjourney',
  'GPT-Image 2.5',
  'FLUX.1',
  'Suno AI',
  'Stable Diffusion',
  'Ideogram',
]

// รายการลิงก์เว็บในเครือ MIX-IMAGE เรียงลำดับจาก "ล่างขึ้นบน" ตามที่ผู้ใช้กำหนด (#1 ล่างสุด -> #10 บนสุด)
const externalLinksBottomToTop = [
  { id: 'shop', label: 'miximage.shop', sub: 'MIXIMAGE SHOP', url: 'https://miximage.shop/', color: 'orange' },
  { id: 'one', label: 'miximage.one', sub: 'MIXIMAGE ONE', url: 'https://miximage.one/', color: 'cyan' },
  { id: 'art', label: 'miximageart.netlify.app', sub: 'MIXIMAGE ART', url: 'https://miximageart.netlify.app/', color: 'purple' },
  { id: 'card', label: 'miximagecard.netlify.app', sub: 'MIXIMAGE CARD', url: 'https://miximagecard.netlify.app/', color: 'blue' },
  { id: 'id-house', label: 'id-house.netlify.app', sub: 'ID-HOUSE STUDIO', url: 'https://id-house.netlify.app/', color: 'green' },
  { id: 'lyric', label: 'miximage-lyric.netlify.app', sub: 'MIXIMAGE LYRIC', url: 'https://miximage-lyric.netlify.app/', color: 'orange' },
  { id: 'music', label: 'mix-music.netlify.app', sub: 'MIX-MUSIC AI', url: 'https://mix-music.netlify.app/', color: 'purple' },
  { id: 'zeroday-gh', label: 'woon-miximage.github.io/zeroday-mastering', sub: 'ZERODAY (GITHUB)', url: 'https://woon-miximage.github.io/zeroday-mastering/', color: 'cyan' },
  { id: 'zeroday-net', label: 'zeroday-mastering.netlify.app', sub: 'ZERODAY MASTERING', url: 'https://zeroday-mastering.netlify.app/', color: 'blue' },
  { id: 'ai-online', label: 'miximageai.online', sub: 'MIXIMAGE AI ONLINE', url: 'https://miximageai.online/', color: 'green' },
]

// แสดงผลจากบนลงล่าง โดยให้รายการสุดท้ายอยู่บนสุด และรายการแรกอยู่ล่างสุด (เรียงล่างขึ้นบน)
const externalLinksTopToBottom = [...externalLinksBottomToTop].reverse()


const emptyForm = {
  title: '',
  promptText: '',
  negativePrompt: '',
  category: 'main',
  folder: '',
  tags: '',
  notes: '',
  tool: '',
  imageUrls: [],
  imagePath: '',
  favorite: false,
}

// สร้างตัวจัดรูปแบบวันที่/เวลาเพียงครั้งเดียวที่ระดับโมดูล ลดภาระ CPU ทุกวินาที
const timeFullFmt = new Intl.DateTimeFormat('th-TH', {
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
})
const timeShortFmt = new Intl.DateTimeFormat('th-TH', {
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
})
const dateFullFmt = new Intl.DateTimeFormat('th-TH', {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  year: 'numeric',
})
const dateShortFmt = new Intl.DateTimeFormat('th-TH', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
})

// Hook สำหรับวันที่และเวลาเรียลไทม์ (ใช้เฉพาะใน Leaf Component เพื่อไม่ให้ทั้งแอป Re-render)
function useRealtimeClock() {
  const [now, setNow] = useState(() => new Date())

  useEffect(() => {
    const timer = setInterval(() => {
      setNow(new Date())
    }, 1000)
    return () => clearInterval(timer)
  }, [])

  return {
    timeString: timeFullFmt.format(now),
    timeShort: timeShortFmt.format(now),
    dateString: dateFullFmt.format(now),
    dateShort: dateShortFmt.format(now),
  }
}

const TopbarClockPill = memo(function TopbarClockPill() {
  const { dateShort, timeString } = useRealtimeClock()
  return (
    <div className="realtime-clock-pill" title="วันที่และเวลาเรียลไทม์">
      <span className="live-dot" />
      <span>{dateShort}</span>
      <span className="dot-divider">•</span>
      <strong className="live-time-str">{timeString}</strong>
    </div>
  )
})

const HeroClockBadge = memo(function HeroClockBadge() {
  const { dateString, timeString } = useRealtimeClock()
  return (
    <div className="hero-live-badge">
      <span className="live-dot" />
      <span>{dateString} • {timeString}</span>
    </div>
  )
})

const PhoneStatusClock = memo(function PhoneStatusClock() {
  const { timeShort, timeString } = useRealtimeClock()
  return (
    <span className="phone-clock-text" title={`เวลาเรียลไทม์: ${timeString}`}>
      {timeShort}
    </span>
  )
})

const PhoneLivePill = memo(function PhoneLivePill() {
  const { dateShort, timeString } = useRealtimeClock()
  return (
    <div className="phone-live-pill">
      <span className="live-blink-dot" />
      <span>{dateShort} • {timeString}</span>
    </div>
  )
})

const PhoneFooterDate = memo(function PhoneFooterDate() {
  const { dateString } = useRealtimeClock()
  return <p className="phone-footer-note">{dateString}</p>
})

// Crisp inline SVG Icons
function Icon({ name, className = '', filled = false }) {
  const baseClass = `svg-icon icon-${name} ${className}`
  switch (name) {
    case 'home':
      return (
        <svg className={baseClass} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
          <polyline points="9 22 9 12 15 12 15 22" />
        </svg>
      )
    case 'prompt':
      return (
        <svg className={baseClass} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polygon points="12 2 2 7 12 12 22 7 12 2" />
          <polyline points="2 17 12 22 22 17" />
          <polyline points="2 12 12 17 22 12" />
        </svg>
      )
    case 'add':
      return (
        <svg className={baseClass} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
          <line x1="12" y1="5" x2="12" y2="19" />
          <line x1="5" y1="12" x2="19" y2="12" />
        </svg>
      )
    case 'note':
      return (
        <svg className={baseClass} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
          <polyline points="14 2 14 8 20 8" />
          <line x1="16" y1="13" x2="8" y2="13" />
          <line x1="16" y1="17" x2="8" y2="17" />
        </svg>
      )
    case 'user':
      return (
        <svg className={baseClass} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
          <circle cx="12" cy="7" r="4" />
        </svg>
      )
    case 'search':
      return (
        <svg className={baseClass} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="11" cy="11" r="8" />
          <line x1="21" y1="21" x2="16.65" y2="16.65" />
        </svg>
      )
    case 'filter':
      return (
        <svg className={baseClass} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" />
        </svg>
      )
    case 'cloud':
      return (
        <svg className={baseClass} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z" />
        </svg>
      )
    case 'copy':
      return (
        <svg className={baseClass} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
          <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
        </svg>
      )
    case 'check':
      return (
        <svg className={baseClass} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="20 6 9 17 4 12" />
        </svg>
      )
    case 'edit':
      return (
        <svg className={baseClass} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
          <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
        </svg>
      )
    case 'trash':
      return (
        <svg className={baseClass} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="3 6 5 6 21 6" />
          <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
          <line x1="10" y1="11" x2="10" y2="17" />
          <line x1="14" y1="11" x2="14" y2="17" />
        </svg>
      )
    case 'star':
      return (
        <svg className={baseClass} viewBox="0 0 24 24" fill={filled ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
        </svg>
      )
    case 'close':
      return (
        <svg className={baseClass} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <line x1="18" y1="6" x2="6" y2="18" />
          <line x1="6" y1="6" x2="18" y2="18" />
        </svg>
      )
    case 'sparkles':
      return (
        <svg className={baseClass} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z" />
        </svg>
      )
    case 'image':
      return (
        <svg className={baseClass} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
          <circle cx="8.5" cy="8.5" r="1.5" />
          <polyline points="21 15 16 10 5 21" />
        </svg>
      )
    case 'music':
      return (
        <svg className={baseClass} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M9 18V5l12-2v13" />
          <circle cx="6" cy="18" r="3" />
          <circle cx="18" cy="16" r="3" />
        </svg>
      )
    case 'tag':
      return (
        <svg className={baseClass} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z" />
          <line x1="7" y1="7" x2="7.01" y2="7" />
        </svg>
      )
    case 'zoom':
      return (
        <svg className={baseClass} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="11" cy="11" r="8" />
          <line x1="21" y1="21" x2="16.65" y2="16.65" />
          <line x1="11" y1="8" x2="11" y2="14" />
          <line x1="8" y1="11" x2="14" y2="11" />
        </svg>
      )
    case 'logout':
      return (
        <svg className={baseClass} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
          <polyline points="16 17 21 12 16 7" />
          <line x1="21" y1="12" x2="9" y2="12" />
        </svg>
      )
    case 'sync':
      return (
        <svg className={baseClass} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="23 4 23 10 17 10" />
          <polyline points="1 20 1 14 7 14" />
          <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
        </svg>
      )
    case 'fingerprint':
      return (
        <svg className={baseClass} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M2 12C2 6.5 6.5 2 12 2a10 10 0 0 1 8 4" />
          <path d="M5 19.5C5.5 18 6 15 6 12a6 6 0 0 1 12 0c0 1 0 3 .5 5" />
          <path d="M12 10a2 2 0 0 1 2 2c0 2-1 4-2 6" />
          <path d="M9 13a4.5 4.5 0 0 0 6 0" />
          <path d="M10 20c1 .5 3 .5 4 0" />
        </svg>
      )
    case 'folder':
      return (
        <svg className={baseClass} viewBox="0 0 24 24" fill={filled ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
        </svg>
      )
    case 'folder-plus':
      return (
        <svg className={baseClass} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
          <line x1="12" y1="11" x2="12" y2="17" />
          <line x1="9" y1="14" x2="15" y2="14" />
        </svg>
      )
    case 'grip':
      return (
        <svg className={baseClass} viewBox="0 0 24 24" fill="currentColor" stroke="none">
          <circle cx="9" cy="6" r="1.7" />
          <circle cx="15" cy="6" r="1.7" />
          <circle cx="9" cy="12" r="1.7" />
          <circle cx="15" cy="12" r="1.7" />
          <circle cx="9" cy="18" r="1.7" />
          <circle cx="15" cy="18" r="1.7" />
        </svg>
      )
    case 'arrow-left':
      return (
        <svg className={baseClass} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="15 18 9 12 15 6" />
        </svg>
      )
    case 'arrow-right':
      return (
        <svg className={baseClass} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="9 18 15 12 9 6" />
        </svg>
      )
    case 'external':
      return (
        <svg className={baseClass} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
          <polyline points="15 3 21 3 21 9" />
          <line x1="10" y1="14" x2="21" y2="3" />
        </svg>
      )
    case 'globe':
      return (
        <svg className={baseClass} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="10" />
          <line x1="2" y1="12" x2="22" y2="12" />
          <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
        </svg>
      )
    case 'calendar':
      return (
        <svg className={baseClass} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
          <line x1="16" y1="2" x2="16" y2="6" />
          <line x1="8" y1="2" x2="8" y2="6" />
          <line x1="3" y1="10" x2="21" y2="10" />
        </svg>
      )
    case 'calculator':
      return (
        <svg className={baseClass} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="4" y="2" width="16" height="20" rx="2" />
          <rect x="7" y="5" width="10" height="4" rx="1" />
          <line x1="8" y1="13" x2="8" y2="13" />
          <line x1="12" y1="13" x2="12" y2="13" />
          <line x1="16" y1="13" x2="16" y2="13" />
          <line x1="8" y1="17" x2="8" y2="17" />
          <line x1="12" y1="17" x2="12" y2="17" />
          <line x1="16" y1="17" x2="16" y2="17" />
        </svg>
      )
    case 'lock':
      return (
        <svg className={baseClass} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
          <path d="M7 11V7a5 5 0 0 1 10 0v4" />
        </svg>
      )
    case 'unlock':
      return (
        <svg className={baseClass} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
          <path d="M7 11V7a5 5 0 0 1 9.9-1" />
        </svg>
      )
    case 'key':
      return (
        <svg className={baseClass} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="7.5" cy="15.5" r="4.5" />
          <path d="m21 3-9.5 9.5" />
          <path d="m15.5 7.5 3 3" />
        </svg>
      )
    case 'pin':
      return (
        <svg className={baseClass} viewBox="0 0 24 24" fill={filled ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <line x1="12" y1="17" x2="12" y2="22" />
          <path d="M5 17h14v-1.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V6a2 2 0 0 0-2-2h-2a2 2 0 0 0-2 2v4.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24z" />
        </svg>
      )
    case 'palette':
      return (
        <svg className={baseClass} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="13.5" cy="6.5" r=".5" fill="currentColor" />
          <circle cx="17.5" cy="10.5" r=".5" fill="currentColor" />
          <circle cx="8.5" cy="7.5" r=".5" fill="currentColor" />
          <circle cx="6.5" cy="12.5" r=".5" fill="currentColor" />
          <path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.926 0 1.648-.746 1.648-1.688 0-.437-.18-.835-.437-1.125-.29-.289-.438-.652-.438-1.125a1.64 1.64 0 0 1 1.668-1.668h1.996c3.051 0 5.563-2.512 5.563-5.563C22 6.5 17.5 2 12 2z" />
        </svg>
      )
    case 'sun':
      return (
        <svg className={baseClass} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="5" />
          <line x1="12" y1="1" x2="12" y2="3" />
          <line x1="12" y1="21" x2="12" y2="23" />
          <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
          <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
          <line x1="1" y1="12" x2="3" y2="12" />
          <line x1="21" y1="12" x2="23" y2="12" />
          <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
          <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
        </svg>
      )
    case 'cloud-rain':
      return (
        <svg className={baseClass} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <line x1="16" y1="13" x2="16" y2="21" />
          <line x1="8" y1="13" x2="8" y2="21" />
          <line x1="12" y1="15" x2="12" y2="23" />
          <path d="M20 16.58A5 5 0 0 0 18 7h-1.26A8 8 0 1 0 4 15.25" />
        </svg>
      )
    case 'gps':
      return (
        <svg className={baseClass} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="10" />
          <line x1="22" y1="12" x2="18" y2="12" />
          <line x1="6" y1="12" x2="2" y2="12" />
          <line x1="12" y1="6" x2="12" y2="2" />
          <line x1="12" y1="22" x2="12" y2="18" />
          <circle cx="12" cy="12" r="3" />
        </svg>
      )
    case 'radar':
      return (
        <svg className={baseClass} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="9" />
          <circle cx="12" cy="12" r="5" />
          <circle cx="12" cy="12" r="1.5" />
          <line x1="12" y1="12" x2="19" y2="5" />
        </svg>
      )
    case 'download':
      return (
        <svg className={baseClass} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
          <polyline points="7 10 12 15 17 10" />
          <line x1="12" y1="15" x2="12" y2="3" />
        </svg>
      )
    case 'windows':
      return (
        <svg className={baseClass} viewBox="0 0 24 24" fill="currentColor">
          <path d="M0 3.449L9.75 2.1v9.451H0m10.949-9.602L24 0v11.4H10.949M0 12.6h9.75v9.451L0 20.699M10.949 12.6H24V24l-12.9-1.801" />
        </svg>
      )
    case 'android':
      return (
        <svg className={baseClass} viewBox="0 0 24 24" fill="currentColor">
          <path d="M17.523 15.3414c-.5511 0-.9993-.4486-.9993-.9997s.4482-.9993.9993-.9993c.551 0 .9993.4482.9993.9993.0001.5511-.4482.9997-.9993.9997m-11.046 0c-.5511 0-.9993-.4486-.9993-.9997s.4482-.9993.9993-.9993c.5511 0 .9993.4482.9993.9993 0 .5511-.4482.9997-.9993.9997m11.4045-6.02l1.9973-3.4592a.416.416 0 00-.1521-.5676.416.416 0 00-.5676.1521l-2.0223 3.503C15.5902 8.4116 13.8533 8.0838 12 8.0838c-1.8533 0-3.5902.3278-5.1368.8659L4.8409 5.4467a.4161.4161 0 00-.5677-.1521.4157.4157 0 00-.1521.5676l1.9973 3.4592C2.6889 11.1867.3432 14.6589 0 18.761h24c-.3432-4.1021-2.6889-7.5743-6.1185-9.4396" />
        </svg>
      )
    case 'desktop':
      return (
        <svg className={baseClass} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="2" y="3" width="20" height="14" rx="2" ry="2" />
          <line x1="8" y1="21" x2="16" y2="21" />
          <line x1="12" y1="17" x2="12" y2="21" />
        </svg>
      )
    case 'smartphone':
      return (
        <svg className={baseClass} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="5" y="2" width="14" height="20" rx="2" ry="2" />
          <line x1="12" y1="18" x2="12.01" y2="18" />
        </svg>
      )
    case 'settings':
      return (
        <svg className={baseClass} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
        </svg>
      )
    case 'info':
      return (
        <svg className={baseClass} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="10" />
          <line x1="12" y1="16" x2="12" y2="12" />
          <line x1="12" y1="8" x2="12.01" y2="8" />
        </svg>
      )
    case 'chevron-right':
      return (
        <svg className={baseClass} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="9 18 15 12 9 6" />
        </svg>
      )
    case 'wallet':
      return (
        <svg className={baseClass} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="2" y="5" width="20" height="16" rx="2" />
          <path d="M2 10h20" />
          <path d="M16 14h.01" />
        </svg>
      )
    case 'plus-circle':
      return (
        <svg className={baseClass} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="10" />
          <line x1="12" y1="8" x2="12" y2="16" />
          <line x1="8" y1="12" x2="16" y2="12" />
        </svg>
      )
    case 'minus-circle':
      return (
        <svg className={baseClass} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="10" />
          <line x1="8" y1="12" x2="16" y2="12" />
        </svg>
      )
    case 'trending-up':
      return (
        <svg className={baseClass} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="23 6 13.5 15.5 8.5 10.5 1 18" />
          <polyline points="17 6 23 6 23 12" />
        </svg>
      )
    case 'trending-down':
      return (
        <svg className={baseClass} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="23 18 13.5 8.5 8.5 13.5 1 6" />
          <polyline points="17 18 23 18 23 12" />
        </svg>
      )
    case 'card':
      return (
        <svg className={baseClass} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="1" y="4" width="22" height="16" rx="2" ry="2" />
          <line x1="1" y1="10" x2="23" y2="10" />
        </svg>
      )
    case 'bank':
      return (
        <svg className={baseClass} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polygon points="12 2 2 7 22 7 12 2" />
          <line x1="4" y1="7" x2="4" y2="18" />
          <line x1="8" y1="7" x2="8" y2="18" />
          <line x1="12" y1="7" x2="12" y2="18" />
          <line x1="16" y1="7" x2="16" y2="18" />
          <line x1="20" y1="7" x2="20" y2="18" />
          <line x1="2" y1="18" x2="22" y2="18" />
          <line x1="1" y1="22" x2="23" y2="22" />
        </svg>
      )
    case 'wifi':
      return (
        <svg className={baseClass} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M5 12.55a11 11 0 0 1 14.08 0" />
          <path d="M1.42 9a16 16 0 0 1 21.16 0" />
          <path d="M8.53 16.11a6 6 0 0 1 6.95 0" />
          <line x1="12" y1="20" x2="12.01" y2="20" strokeWidth="3" />
        </svg>
      )
    case 'eye':
      return (
        <svg className={baseClass} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
          <circle cx="12" cy="12" r="3" />
        </svg>
      )
    case 'eye-off':
      return (
        <svg className={baseClass} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
          <line x1="1" y1="1" x2="23" y2="23" />
        </svg>
      )
    case 'book':
      return (
        <svg className={baseClass} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
          <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
        </svg>
      )
    case 'qr':
      return (
        <svg className={baseClass} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="3" width="7" height="7" />
          <rect x="14" y="3" width="7" height="7" />
          <rect x="3" y="14" width="7" height="7" />
          <rect x="7" y="7" width="1" height="1" strokeWidth="2" />
          <rect x="17" y="7" width="1" height="1" strokeWidth="2" />
          <rect x="7" y="17" width="1" height="1" strokeWidth="2" />
          <line x1="14" y1="14" x2="14.01" y2="14" strokeWidth="3" />
          <line x1="17" y1="14" x2="21" y2="14" />
          <line x1="21" y1="17" x2="21" y2="21" />
          <line x1="14" y1="21" x2="17" y2="21" />
          <line x1="17" y1="17" x2="17.01" y2="17" strokeWidth="3" />
        </svg>
      )
    case 'promptpay':
      return (
        <svg className={baseClass} viewBox="0 0 24 24" fill="currentColor">
          <path d="M12 2L4 7v6c0 5.55 3.84 10.74 8 12 4.16-1.26 8-6.45 8-12V7l-8-5zm0 3.18l5 3.12v4.2c0 3.73-2.5 7.15-5 8.28-2.5-1.13-5-4.55-5-8.28V8.3l5-3.12z" />
        </svg>
      )
    case 'grid':
      return (
        <svg className={baseClass} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="3" width="7" height="7" rx="1" />
          <rect x="14" y="3" width="7" height="7" rx="1" />
          <rect x="14" y="14" width="7" height="7" rx="1" />
          <rect x="3" y="14" width="7" height="7" rx="1" />
        </svg>
      )
    case 'list':
      return (
        <svg className={baseClass} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <line x1="8" y1="6" x2="21" y2="6" />
          <line x1="8" y1="12" x2="21" y2="12" />
          <line x1="8" y1="18" x2="21" y2="18" />
          <line x1="3" y1="6" x2="3.01" y2="6" />
          <line x1="3" y1="12" x2="3.01" y2="12" />
          <line x1="3" y1="18" x2="3.01" y2="18" />
        </svg>
      )
    case 'sort':
      return (
        <svg className={baseClass} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="m3 16 4 4 4-4" />
          <path d="M7 20V4" />
          <path d="m21 8-4-4-4 4" />
          <path d="M17 4v16" />
        </svg>
      )
    case 'bell':
      return (
        <svg className={baseClass} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
          <path d="M13.73 21a2 2 0 0 1-3.46 0" />
        </svg>
      )
    case 'sidebar':
      return (
        <svg className={baseClass} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
          <line x1="9" y1="3" x2="9" y2="21" />
        </svg>
      )
    case 'wrench':
      return (
        <svg className={baseClass} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />
        </svg>
      )
    case 'chart':
      return (
        <svg className={baseClass} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <line x1="18" y1="20" x2="18" y2="10" />
          <line x1="12" y1="20" x2="12" y2="4" />
          <line x1="6" y1="20" x2="6" y2="14" />
        </svg>
      )
    case 'heart':
      return (
        <svg className={baseClass} viewBox="0 0 24 24" fill={filled ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
        </svg>
      )
    case 'rocket':
      return (
        <svg className={baseClass} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09z" />
          <path d="m12 15-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 0 1-4 2z" />
          <path d="M9 12H4s.55-3.03 2-4c1.62-1.08 5 0 5 0" />
          <path d="M12 15v5s3.03-.55 4-2c1.08-1.62 0-5 0-5" />
        </svg>
      )
    case 'more':
      return (
        <svg className={baseClass} viewBox="0 0 24 24" fill="currentColor">
          <circle cx="5" cy="12" r="2" />
          <circle cx="12" cy="12" r="2" />
          <circle cx="19" cy="12" r="2" />
        </svg>
      )
    default:
      return <span className="icon-fallback">•</span>
  }
}

function formatDate(value) {
  if (!value) return 'ยังไม่ระบุ'
  try {
    return dateShortFmt.format(new Date(value))
  } catch {
    return 'ยังไม่ระบุ'
  }
}

// PIN Gate หน้ารูปแบบโทรศัพท์เสมือนจริง พร้อมนาฬิกา & วันที่เรียลไทม์ (แยก Component นาฬิกาเพื่อความลื่นไหล)
function PinGate({ onUnlock }) {
  const [pin, setPin] = useState('')
  const [error, setError] = useState(false)

  const handleDigit = useCallback((digit) => {
    setError(false)
    setPin((prev) => {
      if (prev.length >= 4) return prev
      const nextPin = prev + digit
      if (nextPin.length === 4) {
        if (nextPin === PIN) {
          persistUnlock()
          setTimeout(() => onUnlock(), 0)
        } else {
          setError(true)
          setTimeout(() => {
            setPin('')
            setError(false)
          }, 650)
        }
      }
      return nextPin
    })
  }, [onUnlock])

  const handleDelete = useCallback(() => {
    setError(false)
    setPin((prev) => prev.slice(0, -1))
  }, [])

  const handleQuickUnlock = useCallback(() => {
    setPin(PIN)
    persistUnlock()
    setTimeout(() => {
      onUnlock()
    }, 80)
  }, [onUnlock])

  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key >= '0' && e.key <= '9') {
        handleDigit(e.key)
      } else if (e.key === 'Backspace') {
        handleDelete()
      } else if (e.key === 'Enter') {
        handleQuickUnlock()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [handleDigit, handleDelete, handleQuickUnlock])

  return (
    <main className="phone-gate-container">
      <div className="phone-ambient-orb orb-1" />
      <div className="phone-ambient-orb orb-2" />

      <div className="phone-mockup-frame">
        {/* Phone Top Status Bar พร้อมเวลาเรียลไทม์ */}
        <div className="phone-status-bar">
          <PhoneStatusClock />
          <div className="phone-punch-camera" />
          <div className="phone-status-icons">
            <span className="status-dot">●</span>
            <span className="status-dot">●</span>
            <span className="status-battery">▰</span>
          </div>
        </div>

        {/* Brand Card & New App Icon */}
        <div className="phone-brand-section">
          <div className="phone-logo-badge mascot-badge">
            <img src="./brand/jongjang-mascot.png" alt="จ๋องแจ๋ง ผู้ช่วย MIX-IMAGE" decoding="async" />
          </div>

          <h1 className="phone-brand-title">
            <span className="brand-text-dark">MIX </span>
            <span className="brand-text-gradient">Image</span>
          </h1>
          <p className="phone-brand-sub">JongJang Prompt Desk</p>
          <p className="phone-brand-desc">
            คลังรวมพรอมต์สร้างสรรค์ ภาพและเสียง ด้วย AI
          </p>

          <PhoneLivePill />
        </div>

        {/* PIN Input & Numeric Keypad */}
        <div className="phone-keypad-card">
          <p className="phone-pin-prompt">ใส่รหัส PIN 4 หลัก</p>

          <div className={`phone-dots-row ${error ? 'dots-shake' : ''}`}>
            {[0, 1, 2, 3].map((index) => (
              <span
                key={index}
                className={`phone-pin-dot ${index < pin.length ? 'filled' : ''} ${error ? 'error' : ''}`}
              />
            ))}
          </div>

          {error && <p className="phone-error-msg">รหัส PIN ไม่ถูกต้อง</p>}

          <div className="phone-keypad-grid">
            {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((digit) => (
              <button
                type="button"
                key={digit}
                className="phone-key-btn"
                onClick={() => handleDigit(digit)}
              >
                {digit}
              </button>
            ))}
            <button
              type="button"
              className="phone-key-btn phone-action-key phone-clear-btn"
              onClick={handleDelete}
              aria-label="ลบตัวเลข"
              title="ลบตัวเลข (Backspace)"
            >
              ⌫
            </button>
            <button
              type="button"
              className="phone-key-btn"
              onClick={() => handleDigit('0')}
            >
              0
            </button>
            <button
              type="button"
              className="phone-key-btn phone-action-key phone-unlock-btn"
              onClick={handleQuickUnlock}
              aria-label="ปลดล็อกเข้าสู่ระบบ"
              title="ปลดล็อกเข้าสู่ระบบ (1449)"
            >
              <Icon name="unlock" />
            </button>
          </div>
        </div>

        <PhoneFooterDate />
      </div>
    </main>
  )
}

const Sidebar = memo(function Sidebar({
  page,
  activeMenu,
  collapsed,
  onToggleCollapse,
  onSelectMenu,
  onAdd,
  onOpenDownload,
  totalCount,
  categoriesCount,
  foldersCount,
  favoritesCount,
  notesCount,
  cloudState,
}) {
  const nav = [
    { id: 'home', label: 'หน้าหลัก', icon: 'home', count: null },
    { id: 'prompts', label: 'คลังพรอมต์', icon: 'prompt', count: totalCount },
    { id: 'categories', label: 'หมวดหมู่', icon: 'tag', count: categoriesCount },
    { id: 'projects', label: 'โปรเจกต์', icon: 'folder', count: foldersCount },
    { id: 'favorites', label: 'รายการโปรด', icon: 'heart', count: favoritesCount },
    { id: 'notes', label: 'โน้ตส่วนตัว', icon: 'note', count: notesCount },
    { id: 'savings', label: 'เงินออม / บัญชี', icon: 'wallet', count: null },
    { id: 'ai-tools', label: 'เครื่องมือ AI', icon: 'wrench', count: null },
    { id: 'reports', label: 'รายงาน', icon: 'chart', count: null },
    { id: 'profile', label: 'ตั้งค่า', icon: 'settings', count: null },
  ]

  const storagePercent = Math.min(100, Math.max(12, Math.round((totalCount / 200) * 100)))

  return (
    <aside className={`sidebar ${collapsed ? 'is-collapsed' : ''}`}>
      <div className="brand-lockup-row">
        <div className="brand-lockup" onClick={() => onSelectMenu('home')} role="button" tabIndex={0}>
          <img src="./brand/jongjang-mascot.png" alt="จ๋องแจ๋ง ผู้ช่วย MIX-IMAGE" decoding="async" />
          {!collapsed && (
            <div>
              <strong>MIX Image</strong>
              <span>Prompt Archive</span>
            </div>
          )}
        </div>
        <button
          type="button"
          className="sidebar-collapse-btn"
          onClick={onToggleCollapse}
          title={collapsed ? 'ขยายแถบเมนูด้านซ้าย' : 'ย่อแถบเมนูด้านซ้าย'}
          aria-label="สลับขนาดแถบเมนู"
        >
          <Icon name="sidebar" />
        </button>
      </div>

      <nav className="side-nav" aria-label="เมนูหลัก">
        {nav.map((item) => {
          const isActive = (activeMenu || page) === item.id
          return (
            <button
              type="button"
              key={item.id}
              className={`nav-button ${isActive ? 'active' : ''}`}
              onClick={() => onSelectMenu(item.id)}
              title={item.label}
            >
              <Icon name={item.icon} filled={isActive && item.icon === 'heart'} />
              {!collapsed && <span className="nav-label">{item.label}</span>}
              {!collapsed && item.count !== null && item.count !== undefined && (
                <span className="nav-count-badge">{item.count}</span>
              )}
            </button>
          )
        })}
      </nav>

      <button
        type="button"
        className="sidebar-primary-add-btn"
        onClick={onAdd}
        title="เพิ่มพรอมต์ใหม่"
      >
        <Icon name="add" />
        {!collapsed && <span>เพิ่มพรอมต์</span>}
      </button>

      {!collapsed && (
        <>
          {/* ปุ่มลิงก์แอปและเว็บในเครือ MIX-IMAGE */}
          <div className="sidebar-links-section" aria-label="ลิงก์ที่เกี่ยวข้อง">
            <div className="sidebar-links-header">
              <span>ลิงก์ที่เกี่ยวข้อง</span>
            </div>
            <div className="sidebar-links-list">
              {externalLinksTopToBottom.map((link) => (
                <a
                  key={link.id}
                  href={link.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={`sidebar-link-btn accent-${link.color}`}
                  title={`เปิด ${link.url}`}
                >
                  <span className={`sidebar-link-dot dot-${link.color}`} />
                  <div className="sidebar-link-text">
                    <strong>{link.sub}</strong>
                    <span>{link.label}</span>
                  </div>
                  <Icon name="external" className="sidebar-link-arrow" />
                </a>
              ))}
            </div>
          </div>

          {/* พื้นที่เก็บข้อมูล & ปุ่มดาวน์โหลดแอป */}
          <div className="sidebar-storage-card">
            <div className="storage-card-header">
              <span>พื้นที่เก็บข้อมูล (Google Drive)</span>
              <button
                type="button"
                className="storage-dl-mini-btn"
                onClick={onOpenDownload}
                title="ดาวน์โหลดแอป Windows & Android"
              >
                <Icon name="download" /> แอป
              </button>
            </div>
            <div className="storage-progress-track">
              <div className="storage-progress-fill" style={{ width: `${Math.max(21, storagePercent)}%` }} />
            </div>
            <div className="storage-card-meta">
              <strong>42.8 GB / 200 GB (21%)</strong>
              <span>{totalCount} พรอมต์</span>
            </div>
          </div>
        </>
      )}
    </aside>
  )
})

const MobileNav = memo(function MobileNav({ page, activeMenu, onSelectMenu, onAdd }) {
  const nav = [
    ['home', 'หน้าหลัก', 'home'],
    ['prompts', 'คลังพรอมต์', 'prompt'],
    ['add', 'เพิ่ม', 'add'],
    ['favorites', 'โปรด', 'heart'],
    ['savings', 'เงินออม', 'wallet'],
    ['profile', 'ตั้งค่า', 'settings'],
  ]

  const current = activeMenu || page

  return (
    <nav className="mobile-nav" aria-label="แถบนำทางมือถือ">
      {nav.map(([id, label, icon]) => (
        <button
          type="button"
          key={id}
          className={`mobile-nav-btn ${current === id ? 'active' : ''} ${id === 'add' ? 'mobile-nav-add' : ''}`}
          onClick={() => id === 'add' ? onAdd() : onSelectMenu(id)}
        >
          <div className="mobile-nav-icon-wrap">
            <Icon name={icon} filled={current === id && icon === 'heart'} />
          </div>
          <span>{label}</span>
        </button>
      ))}
    </nav>
  )
})

const StatCard = memo(function StatCard({
  icon,
  label,
  value,
  tone,
  onClick,
  active,
  onDragOver,
  onDragLeave,
  onDrop,
  isDropActive,
}) {
  return (
    <button
      type="button"
      className={`stat-card ${active ? 'stat-active' : ''} ${isDropActive ? 'drop-target-active' : ''}`}
      onClick={onClick}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      title={`คลิกเพื่อดู${label}`}
    >
      <div className={`stat-icon ${tone}`}><Icon name={icon} /></div>
      <span>{label}</span>
      <strong>{value}</strong>
    </button>
  )
})

// การแสดงผลการ์ดที่รองรับคลิกค้างแล้วลากย้ายตำแหน่ง (Drag & Drop) + ย้ายเข้าโฟลเดอร์
const PromptCard = memo(function PromptCard({
  item,
  index,
  totalShown,
  folders = [],
  isDragging,
  isDragOver,
  onDragStart,
  onDragOver,
  onDragLeave,
  onDrop,
  onDragEnd,
  onMoveStep,
  onMoveToFolder,
  onCreateAndMoveFolder,
  onMoveToCategory,
  onFolderClick,
  onCopy,
  onEdit,
  onDelete,
  onFavorite,
  onOpen,
  onTagClick,
}) {
  const [copied, setCopied] = useState(false)
  const [showMoveMenu, setShowMoveMenu] = useState(false)
  const [moveTab, setMoveTab] = useState('folders')
  const [folderSearch, setFolderSearch] = useState('')
  const [quickNewFolder, setQuickNewFolder] = useState('')
  const moveMenuRef = useRef(null)

  useEffect(() => {
    if (!showMoveMenu) return
    const handleClickOutside = (e) => {
      // หากกำลังพิมพ์ชื่อโฟลเดอร์ใหม่หรือค้นหาอยู่ ห้ามยุบหน้าต่างเองเมื่อเผลอคลิกข้างนอก
      if (quickNewFolder.trim() || folderSearch.trim()) return
      if (moveMenuRef.current && !moveMenuRef.current.contains(e.target)) {
        setShowMoveMenu(false)
      }
    }
    document.addEventListener('click', handleClickOutside)
    return () => document.removeEventListener('click', handleClickOutside)
  }, [showMoveMenu, quickNewFolder, folderSearch])

  const handleCopy = (e) => {
    e.stopPropagation()
    onCopy(item)
    setCopied(true)
    setTimeout(() => setCopied(false), 1800)
  }

  const handleQuickCreateFolder = async (e) => {
    e.preventDefault()
    e.stopPropagation()
    const clean = quickNewFolder.trim()
    if (!clean) return
    await onCreateAndMoveFolder?.(item, clean)
    setQuickNewFolder('')
    setShowMoveMenu(false)
  }

  const filteredFolders = useMemo(() => {
    if (!folderSearch.trim()) return folders
    const q = folderSearch.trim().toLowerCase()
    return folders.filter((f) => f.name.toLowerCase().includes(q))
  }, [folders, folderSearch])

  const categoryInfo = categories.find((c) => c.id === item.category) || { label: item.category, color: 'slate' }

  return (
    <article
      className={`prompt-card ${isDragging ? 'is-dragging' : ''} ${isDragOver ? 'is-drag-over' : ''} ${showMoveMenu ? 'popover-open' : ''}`}
      draggable={!showMoveMenu && !isTouchDevice}
      onDragStart={(e) => !isTouchDevice && onDragStart?.(e, item)}
      onDragOver={(e) => !isTouchDevice && onDragOver?.(e, item)}
      onDragLeave={(e) => !isTouchDevice && onDragLeave?.(e, item)}
      onDrop={(e) => !isTouchDevice && onDrop?.(e, item)}
      onDragEnd={!isTouchDevice ? onDragEnd : undefined}
    >
      {/* แถบจับลากย้ายตำแหน่งด้านบนการ์ด */}
      <div className="card-drag-bar" title="คลิกค้างที่การ์ดเพื่อลากย้ายตำแหน่ง หรือลากไปวางในโฟลเดอร์">
        <span className="drag-grip-label">
          <Icon name="grip" />
          <span>ลากย้าย</span>
        </span>
        <div className="card-step-controls">
          <button
            type="button"
            className="step-move-btn"
            disabled={index <= 0}
            onClick={(e) => { e.stopPropagation(); onMoveStep?.(item, -1) }}
            title="ขยับขึ้น / ไปทางซ้าย"
            aria-label="ขยับไปก่อนหน้า"
          >
            <Icon name="arrow-left" />
          </button>
          <button
            type="button"
            className="step-move-btn"
            disabled={index >= totalShown - 1}
            onClick={(e) => { e.stopPropagation(); onMoveStep?.(item, 1) }}
            title="ขยับลง / ไปทางขวา"
            aria-label="ขยับไปถัดไป"
          >
            <Icon name="arrow-right" />
          </button>
        </div>
      </div>

      <div className="thumbnail-container">
        <button
          type="button"
          className="thumbnail-button"
          onClick={() => onOpen(item)}
          aria-label={`ดูรายละเอียดและภาพ ${item.title}`}
        >
          {item.imageUrls?.[0] ? (
            <div className="thumbnail-aspect-frame">
              {/* ภาพพื้นหลังเบลอแบบ Ambient เฉพาะบน PC ไม่โหลดบนมือถือเพื่อลดภาระ GPU */}
              {!isTouchDevice && (
                <img
                  className="thumbnail-img-blur"
                  src={item.imageUrls[0]}
                  alt=""
                  aria-hidden="true"
                  loading="lazy"
                  decoding="async"
                />
              )}
              {/* ภาพตัวอย่างหลักที่แสดงสัดส่วนเต็มทั้งภาพ ไม่ตัดขอบ ไม่ยืด (Contain Full View) */}
              <img
                className="thumbnail-img-main"
                src={item.imageUrls[0]}
                alt={item.title}
                loading="lazy"
                decoding="async"
                draggable={false}
              />
            </div>
          ) : (
            <div className="thumbnail-empty">
              <Icon name="image" />
              <span>ไม่มีภาพตัวอย่าง</span>
            </div>
          )}
        </button>

        {item.imageUrls?.length > 1 && (
          <span className="image-count-badge">
            <Icon name="image" /> {item.imageUrls.length} รูป
          </span>
        )}

        {item.tool && (
          <span className="tool-pill" title={`โมเดล: ${item.tool}`}>
            {item.tool}
          </span>
        )}

        <button
          type="button"
          className={`favorite-btn-overlay ${item.favorite ? 'is-favorite' : ''}`}
          onClick={(e) => { e.stopPropagation(); onFavorite(item) }}
          aria-label={item.favorite ? 'ลบออกจากรายการโปรด' : 'เพิ่มเป็นรายการโปรด'}
        >
          <Icon name="star" filled={item.favorite} />
        </button>
      </div>

      <div className="prompt-card-body">
        <div className="card-heading-row">
          <div className="card-badges-left">
            {/* ปุ่มย้ายหมวดหมู่ หรือย้ายเข้าโฟลเดอร์ */}
            <div className="move-menu-anchor" ref={moveMenuRef}>
              <button
                type="button"
                className={`category-pill category-pill-btn ${categoryInfo.color}`}
                onClick={(e) => {
                  e.stopPropagation()
                  setMoveTab('categories')
                  setShowMoveMenu((prev) => !prev)
                }}
                title={`คลิกเพื่อย้ายหมวดหมู่ (ปัจจุบัน: ${categoryInfo.label})`}
              >
                <span>{categoryInfo.label}</span>
                <span className="category-arrow-down">▾</span>
              </button>

              <button
                type="button"
                className={`folder-chip-btn ${item.folder ? 'has-folder' : ''}`}
                onClick={(e) => {
                  e.stopPropagation()
                  setMoveTab('folders')
                  setShowMoveMenu((prev) => !prev)
                }}
                title="คลิกเพื่อย้ายเข้าโฟลเดอร์ หรือจัดกลุ่ม"
              >
                <Icon name="folder" filled={Boolean(item.folder)} />
                <span>{item.folder || 'ใส่โฟลเดอร์'}</span>
              </button>

              {showMoveMenu && (
                <div className="card-move-popover" onClick={(e) => e.stopPropagation()}>
                  <div className="popover-header">
                    <div className="popover-header-title">
                      <Icon name={moveTab === 'folders' ? 'folder' : 'tag'} />
                      <strong>{moveTab === 'folders' ? 'ย้ายเข้าโฟลเดอร์' : 'เปลี่ยนหมวดหมู่'}</strong>
                    </div>
                    <button
                      type="button"
                      className="popover-close"
                      onClick={() => setShowMoveMenu(false)}
                      aria-label="ปิดเมนูย้าย"
                    >
                      <Icon name="close" />
                    </button>
                  </div>

                  {/* แท็บสลับระหว่าง โฟลเดอร์ (ทั้งหมด) กับ หมวดหมู่ */}
                  <div className="popover-tabs">
                    <button
                      type="button"
                      className={`popover-tab-btn ${moveTab === 'folders' ? 'active' : ''}`}
                      onClick={() => setMoveTab('folders')}
                    >
                      <Icon name="folder" />
                      <span>โฟลเดอร์ ({folders.length})</span>
                    </button>
                    <button
                      type="button"
                      className={`popover-tab-btn ${moveTab === 'categories' ? 'active' : ''}`}
                      onClick={() => setMoveTab('categories')}
                    >
                      <Icon name="tag" />
                      <span>หมวดหมู่</span>
                    </button>
                  </div>

                  {moveTab === 'folders' ? (
                    <div className="popover-tab-content">
                      {folders.length > 4 && (
                        <input
                          type="text"
                          className="popover-search-input"
                          placeholder="🔍 ค้นหาโฟลเดอร์..."
                          value={folderSearch}
                          onChange={(e) => setFolderSearch(e.target.value)}
                          onClick={(e) => e.stopPropagation()}
                        />
                      )}

                      <div className="popover-folder-scroll-list">
                        {item.folder && (
                          <button
                            type="button"
                            className="popover-folder-item remove-folder-item"
                            onClick={() => {
                              onMoveToFolder?.(item, '')
                              setShowMoveMenu(false)
                            }}
                          >
                            <Icon name="close" />
                            <span>นำออกจากโฟลเดอร์ “{item.folder}”</span>
                          </button>
                        )}

                        {filteredFolders.length > 0 ? (
                          filteredFolders.map((f) => (
                            <button
                              type="button"
                              key={f.name}
                              className={`popover-folder-item ${item.folder === f.name ? 'active' : ''}`}
                              onClick={() => {
                                onMoveToFolder?.(item, f.name)
                                setShowMoveMenu(false)
                              }}
                            >
                              <Icon name="folder" filled={item.folder === f.name} />
                              <span className="popover-folder-name">{f.name}</span>
                              {item.folder === f.name && <Icon name="check" className="check-icon" />}
                            </button>
                          ))
                        ) : (
                          <p className="popover-empty">
                            {folderSearch.trim() ? 'ไม่พบโฟลเดอร์ที่ค้นหา' : 'ยังไม่มีโฟลเดอร์ สร้างใหม่ด้านล่างได้เลย'}
                          </p>
                        )}
                      </div>

                      <form className="popover-create-form" onSubmit={handleQuickCreateFolder}>
                        <div className="folder-quick-input-row">
                          <input
                            value={quickNewFolder}
                            onChange={(e) => setQuickNewFolder(e.target.value)}
                            placeholder="ชื่อโฟลเดอร์ใหม่..."
                            onClick={(e) => e.stopPropagation()}
                          />
                          <button type="submit" className="popover-create-btn" disabled={!quickNewFolder.trim()}>
                            <Icon name="add" /> สร้าง
                          </button>
                        </div>
                      </form>
                    </div>
                  ) : (
                    <div className="popover-tab-content">
                      <div className="popover-category-list">
                        {categories.filter((c) => c.id !== 'all').map((cat) => (
                          <button
                            type="button"
                            key={cat.id}
                            className={`popover-category-item ${item.category === cat.id ? 'active' : ''}`}
                            onClick={() => {
                              onMoveToCategory?.(item, cat.id)
                              setShowMoveMenu(false)
                            }}
                          >
                            <span className={`category-mini-dot ${cat.color}`} />
                            <Icon name={cat.icon} />
                            <span className="popover-cat-label">{cat.label}</span>
                            {item.category === cat.id && <Icon name="check" className="check-icon" />}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

        <div className="card-badges-right">
          {item.notes && (
            <span className="note-badge-indicator" title="มีบันทึกโน้ต/เทคนิคส่วนตัว">
              <Icon name="note" /> โน้ต
            </span>
          )}
          {item.negativePrompt && (
            <span className="negative-badge" title="มี Negative Prompt กำหนดไว้">
              Neg ✓
            </span>
          )}
        </div>
      </div>

        <h3 onClick={() => onOpen(item)} className="card-title" title={item.title}>
          {item.title}
        </h3>

        <p className="prompt-excerpt" onClick={() => onOpen(item)}>
          {item.promptText || 'ยังไม่มีข้อความพรอมต์'}
        </p>

        {item.tags?.length > 0 && (
          <div className="tag-row">
            {item.tags.slice(0, 3).map((tag) => (
              <button
                type="button"
                className="tag-btn"
                key={tag}
                onClick={(e) => { e.stopPropagation(); onTagClick?.(tag) }}
                title={`ค้นหา #${tag}`}
              >
                #{tag}
              </button>
            ))}
          </div>
        )}

        <div className="card-footer-row" title={`อัปเดตเมื่อ ${formatDate(item.updatedAt)}`}>
          <div className="card-stats-strip">
            <span className="card-stat-pill" onClick={() => onOpen(item)} title="คลิกเพื่อเปิดดูพรอมต์">
              <Icon name="eye" />
              <span>{120 + ((index * 37 + (item.title?.length || 5) * 11) % 240)}</span>
            </span>
            <button
              type="button"
              className={`card-stat-pill stat-heart-btn ${item.favorite ? 'is-liked' : ''}`}
              onClick={(e) => { e.stopPropagation(); onFavorite(item) }}
              title={item.favorite ? 'รายการโปรด' : 'กดถูกใจ / รายการโปรด'}
            >
              <Icon name="heart" filled={item.favorite} />
              <span>{(item.favorite ? 18 : 9) + ((index * 7) % 25)}</span>
            </button>
          </div>
          <div className="card-actions">
            <button
              type="button"
              className={`action-btn copy-action-btn ${copied ? 'action-copied' : ''}`}
              onClick={handleCopy}
              aria-label="คัดลอกพรอมต์"
              title="คัดลอกพรอมต์"
            >
              <Icon name={copied ? 'check' : 'copy'} />
              <span>{copied ? 'คัดลอกแล้ว' : 'คัดลอก'}</span>
            </button>
            <button
              type="button"
              className="action-btn move-action-btn"
              onClick={(e) => {
                e.stopPropagation()
                setMoveTab('folders')
                setShowMoveMenu((prev) => !prev)
              }}
              aria-label="ย้ายโฟลเดอร์หรือหมวดหมู่"
              title="กดย้ายเพื่อเลือกโฟลเดอร์ทั้งหมด หรือเปลี่ยนหมวดหมู่"
            >
              <Icon name="sync" />
              <span>ย้าย</span>
            </button>
            <button
              type="button"
              className="action-btn icon-only-btn"
              onClick={(e) => { e.stopPropagation(); onEdit(item) }}
              aria-label="แก้ไข"
              title="แก้ไข"
            >
              <Icon name="edit" />
            </button>
            <button
              type="button"
              className="action-btn icon-only-btn danger-action"
              onClick={(e) => { e.stopPropagation(); onDelete(item) }}
              aria-label="ลบ"
              title="ลบ"
            >
              <Icon name="trash" />
            </button>
          </div>
        </div>
      </div>
    </article>
  )
})

const PROMPT_DRAFT_KEY = 'mix-image-prompt-vault.prompt-editor-draft.v1'

function PromptEditor({ item, folders = [], defaultCategory = 'main', defaultFolder = '', onClose, onSave }) {
  const isEditing = Boolean(item?.id)
  const [form, setForm] = useState(() => {
    const initialCategory = item?.category || defaultCategory || 'main'
    const initialFolder = (item?.folder || defaultFolder || '').trim()
    if (!isEditing) {
      try {
        const savedDraft = sessionStorage.getItem(PROMPT_DRAFT_KEY)
        if (savedDraft) {
          const parsed = JSON.parse(savedDraft)
          if (parsed && typeof parsed === 'object') {
            return {
              ...emptyForm,
              category: initialCategory,
              folder: initialFolder,
              ...parsed,
            }
          }
        }
      } catch {
        // ignore draft parse errors
      }
    }
    return {
      ...emptyForm,
      category: initialCategory,
      folder: initialFolder,
      ...(item || {}),
      tags: Array.isArray(item?.tags) ? item.tags.join(', ') : (item?.tags || ''),
    }
  })
  const [imageFile, setImageFile] = useState(null)
  const [imagePreview, setImagePreview] = useState(() => {
    if (item?.imageUrls?.[0]) return item.imageUrls[0]
    if (!isEditing) {
      try {
        const savedDraft = sessionStorage.getItem(PROMPT_DRAFT_KEY)
        if (savedDraft) {
          const parsed = JSON.parse(savedDraft)
          if (parsed?.imagePreview) return parsed.imagePreview
        }
      } catch {
        // ignore
      }
    }
    return ''
  })
  const [isDragOver, setIsDragOver] = useState(false)
  const [saving, setSaving] = useState(false)
  const fileInputRef = useRef(null)

  // บันทึกร่างอัตโนมัติ (Auto-save Draft) ขณะพิมพ์เพิ่มพรอมต์ใหม่ ป้องกันข้อมูลหายหากเผลอกดผิด
  useEffect(() => {
    if (isEditing) return
    try {
      sessionStorage.setItem(
        PROMPT_DRAFT_KEY,
        JSON.stringify({
          ...form,
          imagePreview: imagePreview && imagePreview.startsWith('data:') ? imagePreview : '',
        })
      )
    } catch {
      // ignore quota error
    }
  }, [form, imagePreview, isEditing])

  const clearDraftAndClose = () => {
    if (!isEditing) {
      try {
        sessionStorage.removeItem(PROMPT_DRAFT_KEY)
      } catch {
        // ignore
      }
    }
    onClose()
  }

  const update = (key, value) => setForm((current) => ({ ...current, [key]: value }))
  // โฟลเดอร์ที่เลือกได้ = เฉพาะของห้อง (หมวดหมู่) ที่เลือกอยู่ในฟอร์ม
  const scopedFolders = folders.filter((f) => f.category === form.category)

  const handleFileChange = async (file) => {
    if (!file || !file.type.startsWith('image/')) return
    setImageFile(file)
    try {
      // บีบอัดภาพทันทีที่เลือก (ลดขนาดรูป 12MP–48MP จากกล้องมือถือให้เหลือ ~30KB ในหน่วยความจำ)
      const compressedDataUrl = await fileToLocalPreview(file, 760)
      setImagePreview(compressedDataUrl)
    } catch {
      setImagePreview(URL.createObjectURL(file))
    }
  }

  const handleDrop = (e) => {
    e.preventDefault()
    setIsDragOver(false)
    const file = e.dataTransfer.files?.[0]
    if (file) handleFileChange(file)
  }

  const handleRemoveImage = (e) => {
    e.preventDefault()
    e.stopPropagation()
    setImageFile(null)
    setImagePreview('')
    update('imageUrls', [])
    update('imagePath', '')
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  const submit = async (event) => {
    event.preventDefault()
    if (!form.title.trim() || !form.promptText.trim()) return
    setSaving(true)
    try {
      await onSave({
        ...form,
        folder: (form.folder || '').trim(),
        tags: form.tags
          ? form.tags.split(',').map((tag) => tag.trim()).filter(Boolean)
          : [],
        imageUrls: imagePreview ? (imageFile ? [imagePreview] : form.imageUrls) : [],
        imageFile,
        precompressedPreview: imageFile && imagePreview.startsWith('data:') ? imagePreview : '',
      })
      if (!isEditing) {
        try {
          sessionStorage.removeItem(PROMPT_DRAFT_KEY)
        } catch {
          // ignore
        }
      }
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="modal-backdrop" role="presentation">
      <section
        className="editor-modal glass-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="editor-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-header">
          <div>
            <p className="eyebrow">PROMPT VAULT • ล็อคหน้าต่างป้องกันข้อมูลหาย</p>
            <h2 id="editor-title">{isEditing ? 'แก้ไขข้อมูลพรอมต์' : 'เพิ่มพรอมต์ใหม่'}</h2>
          </div>
          <button type="button" className="icon-button close-button" onClick={clearDraftAndClose} aria-label="ยกเลิกและปิด" title="ยกเลิกและปิดหน้าต่าง">
            <Icon name="close" />
          </button>
        </div>

        <form className="editor-form" onSubmit={submit}>
          <div className="editor-grid">
            <div className="editor-fields">
              <label>
                <span>ชื่อพรอมต์ <strong className="required-star">*</strong></span>
                <input
                  value={form.title}
                  onChange={(event) => update('title', event.target.value)}
                  placeholder="เช่น Dark Cinematic Neon Portrait"
                  required
                />
              </label>

              <label>
                <span>พรอมต์หลัก (Positive Prompt) <strong className="required-star">*</strong></span>
                <textarea
                  value={form.promptText}
                  onChange={(event) => update('promptText', event.target.value)}
                  rows="6"
                  placeholder="วางพรอมต์ต้นฉบับภาษาอังกฤษหรือไทยที่นี่..."
                  required
                />
              </label>

              <label>
                <span>Negative Prompt (สิ่งที่ไม่ต้องการ)</span>
                <textarea
                  value={form.negativePrompt}
                  onChange={(event) => update('negativePrompt', event.target.value)}
                  rows="3"
                  placeholder="เช่น blurry, bad anatomy, deformed, watermark, low quality"
                />
              </label>

              <div className="form-two-col">
                <label>
                  <span>หมวดหมู่</span>
                  <select
                    value={form.category}
                    onChange={(event) => update('category', event.target.value)}
                  >
                    {categories.filter((c) => c.id !== 'all').map((category) => (
                      <option value={category.id} key={category.id}>
                        {category.label}
                      </option>
                    ))}
                  </select>
                </label>

                <label>
                  <span>โฟลเดอร์ / กลุ่มย่อย (Folder)</span>
                  <input
                    value={form.folder || ''}
                    onChange={(event) => update('folder', event.target.value)}
                    placeholder="เช่น รูปวีซ่า, ชุดนักเรียน, ชุดสูทสุภาพ"
                  />
                </label>
              </div>

              {scopedFolders.length > 0 && (
                <div className="tool-quick-row">
                  <span className="tool-quick-label">เลือกโฟลเดอร์ (เฉพาะห้องนี้):</span>
                  <button
                    type="button"
                    className={`tool-quick-btn ${!form.folder ? 'active' : ''}`}
                    onClick={() => update('folder', '')}
                  >
                    ไม่ระบุโฟลเดอร์
                  </button>
                  {scopedFolders.map((f) => (
                    <button
                      type="button"
                      key={f.name}
                      className={`tool-quick-btn ${form.folder === f.name ? 'active' : ''}`}
                      onClick={() => update('folder', f.name)}
                    >
                      📁 {f.name}
                    </button>
                  ))}
                </div>
              )}

              <label>
                <span>เครื่องมือ / AI Model</span>
                <input
                  value={form.tool}
                  onChange={(event) => update('tool', event.target.value)}
                  placeholder="เช่น Midjourney, GPT-Image, Suno"
                />
              </label>

              {/* Quick tool selector tags */}
              <div className="tool-quick-row">
                <span className="tool-quick-label">เลือกด่วน:</span>
                {popularTools.map((t) => (
                  <button
                    type="button"
                    key={t}
                    className={`tool-quick-btn ${form.tool === t ? 'active' : ''}`}
                    onClick={() => update('tool', t)}
                  >
                    {t}
                  </button>
                ))}
              </div>

              <label>
                <span>แท็ก (คั่นด้วยเครื่องหมายจุลภาค)</span>
                <input
                  value={form.tags}
                  onChange={(event) => update('tags', event.target.value)}
                  placeholder="portrait, cinematic, luxury, neon, client"
                />
              </label>

              <label>
                <span>โน้ตส่วนตัว (Notes & Workflow)</span>
                <textarea
                  value={form.notes}
                  onChange={(event) => update('notes', event.target.value)}
                  rows="3"
                  placeholder="บันทึกเทคนิค ค่า seed หรือข้อสังเกตสำหรับการใช้งาน..."
                />
              </label>
            </div>

            <div className="image-upload-column">
              <label className="field-label">ภาพตัวอย่างผลงาน</label>
              <div
                className={`image-dropzone ${isDragOver ? 'drag-over' : ''} ${imagePreview ? 'has-image' : ''}`}
                onDragOver={(e) => { e.preventDefault(); setIsDragOver(true) }}
                onDragLeave={() => setIsDragOver(false)}
                onDrop={handleDrop}
                onClick={() => fileInputRef.current?.click()}
              >
                {imagePreview ? (
                  <div className="preview-container">
                    <img className="preview-img-contain" src={imagePreview} alt="ตัวอย่างภาพพรอมต์" />
                    <div className="preview-overlay">
                      <button
                        type="button"
                        className="dropzone-btn change-btn"
                        onClick={(e) => { e.stopPropagation(); fileInputRef.current?.click() }}
                      >
                        <Icon name="image" /> เปลี่ยนรูป
                      </button>
                      <button
                        type="button"
                        className="dropzone-btn remove-btn"
                        onClick={handleRemoveImage}
                      >
                        <Icon name="trash" /> ลบรูป
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="dropzone-empty">
                    <div className="upload-plus">
                      <Icon name="add" />
                    </div>
                    <strong>ลากรูปภาพมาวางที่นี่</strong>
                    <span>หรือคลิกเพื่อเลือกไฟล์รูปตัวอย่าง</span>
                    <small>ระบบจะบีบอัดอัตโนมัติให้เหมาะสำหรับการแสดงผล Preview</small>
                  </div>
                )}
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  style={{ display: 'none' }}
                  onChange={(e) => {
                    const file = e.target.files?.[0]
                    if (file) handleFileChange(file)
                  }}
                />
              </div>
              <p className="helper-text">
                ระบบจะบีบอัดไฟล์ให้อยู่ในขนาดที่โหลดไว และจัดเก็บเป็นภาพตัวอย่างโดยเฉพาะ
              </p>
            </div>
          </div>

          <div className="modal-actions">
            <button type="button" className="secondary-button" onClick={clearDraftAndClose}>
              ยกเลิก
            </button>
            <button type="submit" className="primary-button" disabled={saving}>
              {saving ? 'กำลังบันทึก...' : 'บันทึกพรอมต์'}
            </button>
          </div>
        </form>
      </section>
    </div>
  )
}

function DetailModal({
  item,
  folders = [],
  onClose,
  onCopy,
  onEdit,
  onDelete,
  onLightbox,
  onMoveToCategory,
  onMoveToFolder,
}) {
  const [activeTab, setActiveTab] = useState('positive')
  const [copiedType, setCopiedType] = useState('')

  const handleCopy = (text, type) => {
    onCopy(text)
    setCopiedType(type)
    setTimeout(() => setCopiedType(''), 1800)
  }

  const categoryInfo = categories.find((c) => c.id === item.category) || { label: item.category, color: 'slate' }

  return (
    <div className="modal-backdrop" role="presentation">
      <section
        className="detail-modal glass-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="detail-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-header">
          <div>
            <div className="detail-badges">
              <span className={`category-pill ${categoryInfo.color}`}>{categoryInfo.label}</span>
              {item.folder && (
                <span className="folder-chip-btn has-folder">
                  <Icon name="folder" filled /> {item.folder}
                </span>
              )}
              {item.tool && <span className="tool-pill">{item.tool}</span>}
            </div>
            <h2 id="detail-title">{item.title}</h2>

            {/* แถบย้ายหมวดหมู่ด่วน เช่น ย้ายจากทั่วไป ไปโน้ตส่วนตัว หรือหมวดอื่น */}
            <div className="detail-category-switcher">
              <span className="switcher-label">ย้ายหมวดหมู่:</span>
              <div className="switcher-pills-row">
                {categories.filter((c) => c.id !== 'all').map((cat) => (
                  <button
                    type="button"
                    key={cat.id}
                    className={`detail-move-pill ${item.category === cat.id ? 'active ' + cat.color : ''}`}
                    onClick={() => onMoveToCategory?.(item, cat.id)}
                    title={`ย้ายไปหมวด ${cat.label}`}
                  >
                    <Icon name={cat.icon} />
                    <span>{cat.label}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* แถบย้ายโฟลเดอร์ด่วน */}
            {folders.length > 0 && (
              <div className="detail-folder-switcher">
                <span className="switcher-label">โฟลเดอร์:</span>
                <div className="switcher-pills-row">
                  <button
                    type="button"
                    className={`detail-move-pill ${!item.folder ? 'active folder-active' : ''}`}
                    onClick={() => onMoveToFolder?.(item, '')}
                    title="ไม่จัดโฟลเดอร์"
                  >
                    <Icon name="folder" />
                    <span>ไม่ระบุ</span>
                  </button>
                  {folders.map((f) => (
                    <button
                      type="button"
                      key={f.name}
                      className={`detail-move-pill ${item.folder === f.name ? 'active folder-active' : ''}`}
                      onClick={() => onMoveToFolder?.(item, f.name)}
                      title={`ย้ายเข้าโฟลเดอร์ ${f.name}`}
                    >
                      <Icon name="folder" filled={item.folder === f.name} />
                      <span>{f.name}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
          <button type="button" className="icon-button close-button" onClick={onClose} aria-label="ปิด">
            <Icon name="close" />
          </button>
        </div>

        {item.imageUrls?.[0] && (
          <div className="detail-image-wrap" onClick={() => onLightbox(item.imageUrls[0])} title="คลิกเพื่อดูภาพขนาดเต็ม">
            <img className="detail-img-main" src={item.imageUrls[0]} alt={item.title} decoding="async" />
            <div className="detail-image-hint">
              <Icon name="zoom" /> ดูภาพขนาดเต็ม
            </div>
          </div>
        )}

        <div className="detail-tabs">
          <button
            type="button"
            className={`detail-tab ${activeTab === 'positive' ? 'active' : ''}`}
            onClick={() => setActiveTab('positive')}
          >
            พรอมต์หลัก
          </button>
          {item.negativePrompt && (
            <button
              type="button"
              className={`detail-tab ${activeTab === 'negative' ? 'active' : ''}`}
              onClick={() => setActiveTab('negative')}
            >
              Negative Prompt
            </button>
          )}
          {item.notes && (
            <button
              type="button"
              className={`detail-tab ${activeTab === 'notes' ? 'active' : ''}`}
              onClick={() => setActiveTab('notes')}
            >
              โน้ตส่วนตัว
            </button>
          )}
        </div>

        <div className="detail-tab-body">
          {activeTab === 'positive' && (
            <div className="code-block-wrap">
              <div className="code-block-header">
                <span>Positive Prompt</span>
                <button
                  type="button"
                  className="copy-chip"
                  onClick={() => handleCopy(item.promptText, 'positive')}
                >
                  <Icon name={copiedType === 'positive' ? 'check' : 'copy'} />
                  {copiedType === 'positive' ? 'คัดลอกแล้ว' : 'คัดลอก'}
                </button>
              </div>
              <pre>{item.promptText}</pre>
            </div>
          )}

          {activeTab === 'negative' && item.negativePrompt && (
            <div className="code-block-wrap">
              <div className="code-block-header">
                <span>Negative Prompt</span>
                <button
                  type="button"
                  className="copy-chip"
                  onClick={() => handleCopy(item.negativePrompt, 'negative')}
                >
                  <Icon name={copiedType === 'negative' ? 'check' : 'copy'} />
                  {copiedType === 'negative' ? 'คัดลอกแล้ว' : 'คัดลอก'}
                </button>
              </div>
              <pre>{item.negativePrompt}</pre>
            </div>
          )}

          {activeTab === 'notes' && item.notes && (
            <div className="notes-box">
              <p>{item.notes}</p>
            </div>
          )}
        </div>

        {item.tags?.length > 0 && (
          <div className="detail-tags-row">
            {item.tags.map((tag) => (
              <span className="tag-pill" key={tag}>#{tag}</span>
            ))}
          </div>
        )}

        <div className="modal-actions detail-actions">
          <div className="detail-meta-left">
            <span>อัปเดตเมื่อ: {formatDate(item.updatedAt)}</span>
          </div>
          <div className="detail-buttons-right">
            {onDelete && (
              <button
                type="button"
                className="danger-button"
                onClick={() => {
                  onDelete(item)
                }}
                title="ลบพรอมต์นี้"
              >
                <Icon name="trash" /> ลบ
              </button>
            )}
            <button
              type="button"
              className="secondary-button"
              onClick={() => { onClose(); onEdit(item) }}
            >
              <Icon name="edit" /> แก้ไข
            </button>
            <button
              type="button"
              className="primary-button"
              onClick={() => handleCopy(item.promptText, 'main')}
            >
              <Icon name={copiedType === 'main' ? 'check' : 'copy'} />
              {copiedType === 'main' ? 'คัดลอกแล้ว' : 'คัดลอกพรอมต์'}
            </button>
          </div>
        </div>
      </section>
    </div>
  )
}

function Lightbox({ imageUrl, onClose }) {
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onClose])

  return (
    <div className="lightbox-backdrop" onClick={onClose}>
      <button type="button" className="lightbox-close" onClick={onClose} aria-label="ปิด">
        <Icon name="close" />
      </button>
      <div className="lightbox-image-wrap" onClick={(e) => e.stopPropagation()}>
        <img src={imageUrl} alt="ภาพขนาดเต็ม" />
      </div>
    </div>
  )
}

const THAI_MONTHS_FULL = [
  'มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน',
  'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม',
]
const THAI_MONTHS_SHORT = [
  'ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.',
  'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.',
]
const THAI_DAYS_SHORT = ['อา', 'จ', 'อ', 'พ', 'พฤ', 'ศ', 'ส']

function isSameDay(d1, d2) {
  if (!d1 || !d2) return false
  const a = new Date(d1)
  const b = new Date(d2)
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  )
}

function formatThaiDateFull(dateVal) {
  if (!dateVal) return ''
  try {
    const d = new Date(dateVal)
    return `${d.getDate()} ${THAI_MONTHS_FULL[d.getMonth()]} ${d.getFullYear() + 543}`
  } catch {
    return ''
  }
}

function formatThaiDateShort(dateVal) {
  if (!dateVal) return ''
  try {
    const d = new Date(dateVal)
    return `${d.getDate()} ${THAI_MONTHS_SHORT[d.getMonth()]}`
  } catch {
    return ''
  }
}

const KEEP_COLORS = [
  { id: 'default', label: 'ค่าเริ่มต้น', bg: '#1e2433', border: 'rgba(255,255,255,0.12)' },
  { id: 'coral', label: 'แดงปะการัง', bg: '#5c2b29', border: '#f87171' },
  { id: 'peach', label: 'ส้มพีช', bg: '#614a19', border: '#fb923c' },
  { id: 'sand', label: 'เหลืองทราย', bg: '#635d19', border: '#facc15' },
  { id: 'mint', label: 'เขียวมิ้นท์', bg: '#345920', border: '#4ade80' },
  { id: 'sage', label: 'เขียวเซจ', bg: '#16504b', border: '#2dd4bf' },
  { id: 'fog', label: 'ฟ้าหมอก', bg: '#2d555e', border: '#38bdf8' },
  { id: 'storm', label: 'ครามสตอร์ม', bg: '#1e3a5f', border: '#60a5fa' },
  { id: 'dusk', label: 'ม่วงสนธยา', bg: '#42275e', border: '#c084fc' },
  { id: 'blossom', label: 'ชมพูบลอสซัม', bg: '#5b2245', border: '#f472b6' },
  { id: 'clay', label: 'น้ำตาลดินเผา', bg: '#442f19', border: '#fbbf24' },
]

function getWeatherCondition(code) {
  if (code === 0) return { label: 'ท้องฟ้าแจ่มใส', icon: 'sun', emoji: '☀️' }
  if (code === 1 || code === 2) return { label: 'มีเมฆบางส่วน', icon: 'cloud', emoji: '🌤️' }
  if (code === 3) return { label: 'มีเมฆเป็นส่วนมาก', icon: 'cloud', emoji: '⛅' }
  if (code === 45 || code === 48) return { label: 'มีหมอกหนา', icon: 'cloud', emoji: '🌫️' }
  if (code >= 51 && code <= 55) return { label: 'ฝนตกปรอยๆ', icon: 'cloud-rain', emoji: '🌦️' }
  if (code >= 61 && code <= 65) return { label: 'ฝนตกต่อเนื่อง', icon: 'cloud-rain', emoji: '🌧️' }
  if (code >= 80 && code <= 82) return { label: 'ฝนตกหนัก', icon: 'cloud-rain', emoji: '🌧️' }
  if (code >= 95) return { label: 'พายุฝนฟ้าคะนอง', icon: 'cloud-rain', emoji: '⛈️' }
  return { label: 'อากาศทั่วไป', icon: 'sun', emoji: '🌤️' }
}

const KEEP_NOTE_DRAFT_KEY = 'mix-image-prompt-vault.keep-note-draft.v1'

// 1. เครื่องมือเขียนโน๊ต กดแล้วขยายเหมือน Google Keep รองรับแนบรูปภาพพร้อมบีบอัดความเร็วสูง
function QuickKeepNoteWidget({ onSaveNote }) {
  const [expanded, setExpanded] = useState(false)
  const [title, setTitle] = useState(() => {
    try {
      const saved = localStorage.getItem(KEEP_NOTE_DRAFT_KEY)
      return saved ? JSON.parse(saved)?.title || '' : ''
    } catch {
      return ''
    }
  })
  const [notes, setNotes] = useState(() => {
    try {
      const saved = localStorage.getItem(KEEP_NOTE_DRAFT_KEY)
      return saved ? JSON.parse(saved)?.notes || '' : ''
    } catch {
      return ''
    }
  })
  const [pinned, setPinned] = useState(() => {
    try {
      const saved = localStorage.getItem(KEEP_NOTE_DRAFT_KEY)
      return saved ? Boolean(JSON.parse(saved)?.pinned) : false
    } catch {
      return false
    }
  })
  const [color, setColor] = useState(() => {
    try {
      const saved = localStorage.getItem(KEEP_NOTE_DRAFT_KEY)
      const colorId = saved ? JSON.parse(saved)?.colorId : null
      return KEEP_COLORS.find((c) => c.id === colorId) || KEEP_COLORS[0]
    } catch {
      return KEEP_COLORS[0]
    }
  })
  const [imagePreview, setImagePreview] = useState('')
  const [isCompressing, setIsCompressing] = useState(false)
  const [showPalette, setShowPalette] = useState(false)
  const fileInputRef = useRef(null)

  // บันทึกร่างโน้ตอัตโนมัติ ป้องกันข้อความหาย
  useEffect(() => {
    try {
      localStorage.setItem(
        KEEP_NOTE_DRAFT_KEY,
        JSON.stringify({
          title,
          notes,
          pinned,
          colorId: color.id,
        })
      )
    } catch {
      // ignore
    }
  }, [title, notes, pinned, color])

  const handleImageChange = async (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    setIsCompressing(true)
    try {
      const preview = await fileToLocalPreview(file, 960)
      setImagePreview(preview)
    } catch (err) {
      console.warn('Image compression warning:', err)
    } finally {
      setIsCompressing(false)
    }
  }

  const clearNoteForm = () => {
    setTitle('')
    setNotes('')
    setImagePreview('')
    setPinned(false)
    setColor(KEEP_COLORS[0])
    setShowPalette(false)
    try {
      localStorage.removeItem(KEEP_NOTE_DRAFT_KEY)
    } catch {
      // ignore
    }
  }

  const handleSave = () => {
    if (!title.trim() && !notes.trim() && !imagePreview) {
      setExpanded(false)
      return
    }
    const finalTitle =
      title.trim() ||
      `โน้ตด่วน (${new Date().toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' })})`
    onSaveNote({
      title: finalTitle,
      promptText: notes.trim() || finalTitle,
      negativePrompt: '',
      notes: notes.trim(),
      category: 'note',
      folder: '',
      tags: ['GoogleKeep', 'QuickNote'],
      favorite: pinned,
      tool: 'Google Keep',
      imageUrls: imagePreview ? [imagePreview] : [],
      precompressedPreview: imagePreview || '',
      color: color.bg,
    })
    clearNoteForm()
    setExpanded(false)
  }

  const handleCancel = () => {
    clearNoteForm()
    setExpanded(false)
  }

  return (
    <>
      <button
        type="button"
        className="top-widget-btn keep-note-pill"
        onClick={() => setExpanded(true)}
        title="จดโน้ตด่วน ขยายแบบ Google Keep รองรับรูปภาพ"
      >
        <Icon name="note" />
        <span>จดโน้ต (Keep)</span>
        <span className="keep-badge-dot">📝</span>
      </button>

      {expanded && (
        <div className="keep-modal-backdrop">
          <div
            className="keep-card animate-scale-in"
            style={{ backgroundColor: color.bg, borderColor: color.border }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header: Title + Pin */}
            <div className="keep-card-header">
              <input
                type="text"
                className="keep-title-input"
                placeholder="ชื่อเรื่อง"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                autoFocus
              />
              <button
                type="button"
                className={`keep-pin-btn ${pinned ? 'pinned' : ''}`}
                title={pinned ? 'ยกเลิกการปักหมุด' : 'ปักหมุดโน้ต'}
                onClick={() => setPinned(!pinned)}
              >
                <Icon name="pin" filled={pinned} />
              </button>
            </div>

            {/* Note text content */}
            <textarea
              className="keep-body-textarea"
              placeholder="จดบันทึก..."
              rows={4}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />

            {/* Image preview */}
            {imagePreview && (
              <div className="keep-preview-wrap">
                <img src={imagePreview} alt="ภาพประกอบโน้ต" />
                <button
                  type="button"
                  className="keep-remove-img"
                  title="ลบรูป"
                  onClick={() => setImagePreview('')}
                >
                  <Icon name="close" />
                </button>
              </div>
            )}

            {isCompressing && (
              <div className="keep-compressing-notice">
                <Icon name="sync" className="spin-icon" /> กำลังประมวลผลและบีบอัดภาพเพื่อความเร็ว...
              </div>
            )}

            {/* Card Footer Toolbar */}
            <div className="keep-card-footer">
              <div className="keep-tools-left">
                {/* Palette */}
                <div className="keep-palette-container">
                  <button
                    type="button"
                    className={`keep-tool-btn ${showPalette ? 'active' : ''}`}
                    title="สีพื้นหลังโน้ต"
                    onClick={() => setShowPalette(!showPalette)}
                  >
                    <Icon name="palette" />
                  </button>
                  {showPalette && (
                    <div className="keep-palette-popover">
                      {KEEP_COLORS.map((c) => (
                        <button
                          key={c.id}
                          type="button"
                          className={`keep-color-circle ${color.id === c.id ? 'active' : ''}`}
                          style={{ backgroundColor: c.bg, borderColor: c.border }}
                          title={c.label}
                          onClick={() => {
                            setColor(c)
                            setShowPalette(false)
                          }}
                        />
                      ))}
                    </div>
                  )}
                </div>

                {/* Image upload */}
                <button
                  type="button"
                  className="keep-tool-btn"
                  title="เพิ่มรูปภาพ"
                  onClick={() => fileInputRef.current?.click()}
                >
                  <Icon name="image" />
                </button>
                <input
                  type="file"
                  ref={fileInputRef}
                  accept="image/*"
                  style={{ display: 'none' }}
                  onChange={handleImageChange}
                />

                <span className="keep-category-badge">
                  <Icon name="sparkles" /> โน้ตส่วนตัว
                </span>
              </div>

              <div className="keep-tools-right">
                <button
                  type="button"
                  className="keep-btn-close"
                  onClick={handleCancel}
                  title="ยกเลิกและปิดหน้าต่าง"
                >
                  ยกเลิก
                </button>
                <button
                  type="button"
                  className="keep-btn-save"
                  onClick={handleSave}
                  disabled={!title.trim() && !notes.trim() && !imagePreview}
                >
                  บันทึกโน้ต
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

// เครื่องคิดเลขด่วนสำหรับคำนวณราคา จำนวนภาพ และต้นทุนงาน โดยทำงานในเบราว์เซอร์ทันที
function CalculatorWidget() {
  const [isOpen, setIsOpen] = useState(false)
  const [display, setDisplay] = useState('0')
  const [storedValue, setStoredValue] = useState(null)
  const [pendingOperation, setPendingOperation] = useState(null)
  const [waitingForOperand, setWaitingForOperand] = useState(false)
  const [error, setError] = useState('')

  const resetCalculator = () => {
    setDisplay('0')
    setStoredValue(null)
    setPendingOperation(null)
    setWaitingForOperand(false)
    setError('')
  }

  const calculate = (first, second, operation) => {
    if (operation === '+') return first + second
    if (operation === '−') return first - second
    if (operation === '×') return first * second
    if (operation === '÷') return second === 0 ? null : first / second
    return second
  }

  const formatResult = (value) => {
    if (!Number.isFinite(value)) return '0'
    const rounded = Math.round((value + Number.EPSILON) * 1e10) / 1e10
    return String(rounded)
  }

  const inputDigit = (digit) => {
    setError('')
    if (waitingForOperand || display === '0' || display === 'หารด้วยศูนย์ไม่ได้') {
      setDisplay(digit)
      setWaitingForOperand(false)
      return
    }
    if (display.replace('-', '').replace('.', '').length < 14) {
      setDisplay(`${display}${digit}`)
    }
  }

  const inputDecimal = () => {
    setError('')
    if (waitingForOperand) {
      setDisplay('0.')
      setWaitingForOperand(false)
      return
    }
    if (!display.includes('.')) setDisplay(`${display}.`)
  }

  const chooseOperation = (operation) => {
    setError('')
    const inputValue = Number(display)
    if (storedValue === null) {
      setStoredValue(inputValue)
    } else if (pendingOperation && !waitingForOperand) {
      const result = calculate(storedValue, inputValue, pendingOperation)
      if (result === null) {
        setDisplay('หารด้วยศูนย์ไม่ได้')
        setError('หารด้วยศูนย์ไม่ได้')
        setStoredValue(null)
        setPendingOperation(null)
        setWaitingForOperand(true)
        return
      }
      setDisplay(formatResult(result))
      setStoredValue(result)
    }
    setPendingOperation(operation)
    setWaitingForOperand(true)
  }

  const handleEquals = () => {
    if (storedValue === null || !pendingOperation) return
    const result = calculate(storedValue, Number(display), pendingOperation)
    if (result === null) {
      setDisplay('หารด้วยศูนย์ไม่ได้')
      setError('หารด้วยศูนย์ไม่ได้')
    } else {
      setDisplay(formatResult(result))
    }
    setStoredValue(null)
    setPendingOperation(null)
    setWaitingForOperand(true)
  }

  const handlePercent = () => {
    setError('')
    const value = Number(display)
    setDisplay(formatResult(value / 100))
    setWaitingForOperand(false)
  }

  const handleSign = () => {
    if (display === '0' || display === 'หารด้วยศูนย์ไม่ได้') return
    setDisplay(display.startsWith('-') ? display.slice(1) : `-${display}`)
  }

  useEffect(() => {
    if (!isOpen) return
    const handleKeyDown = (event) => {
      if (/^[0-9]$/.test(event.key)) inputDigit(event.key)
      else if (event.key === '.') inputDecimal()
      else if (event.key === '+') chooseOperation('+')
      else if (event.key === '-') chooseOperation('−')
      else if (event.key === '*') chooseOperation('×')
      else if (event.key === '/') chooseOperation('÷')
      else if (event.key === 'Enter' || event.key === '=') handleEquals()
      else if (event.key === 'Backspace') setDisplay((current) => current.length > 1 ? current.slice(0, -1) : '0')
      else return
      event.preventDefault()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  })

  return (
    <>
      <button
        type="button"
        className="top-widget-btn calculator-pill"
        onClick={() => setIsOpen(true)}
        title="เปิดเครื่องคิดเลข"
      >
        <Icon name="calculator" />
        <span>เครื่องคิดเลข</span>
      </button>

      {isOpen && (
        <div className="calculator-modal-backdrop">
          <div className="calculator-card animate-scale-in" onClick={(event) => event.stopPropagation()}>
            <div className="calculator-header">
              <div>
                <span className="calculator-kicker">QUICK TOOL</span>
                <h3>เครื่องคิดเลข</h3>
              </div>
              <button type="button" className="calculator-close-btn" onClick={() => setIsOpen(false)} aria-label="ปิดเครื่องคิดเลข">
                <Icon name="close" />
              </button>
            </div>

            <div className={`calculator-display ${error ? 'has-error' : ''}`} aria-live="polite">
              {display}
            </div>
            {error && <p className="calculator-error">{error}</p>}

            <div className="calculator-keypad">
              <button type="button" className="calculator-key muted" onClick={resetCalculator}>AC</button>
              <button type="button" className="calculator-key muted" onClick={handleSign}>±</button>
              <button type="button" className="calculator-key muted" onClick={handlePercent}>%</button>
              <button type="button" className="calculator-key operation" onClick={() => chooseOperation('÷')}>÷</button>
              {['7', '8', '9'].map((digit) => <button key={digit} type="button" className="calculator-key" onClick={() => inputDigit(digit)}>{digit}</button>)}
              <button type="button" className="calculator-key operation" onClick={() => chooseOperation('×')}>×</button>
              {['4', '5', '6'].map((digit) => <button key={digit} type="button" className="calculator-key" onClick={() => inputDigit(digit)}>{digit}</button>)}
              <button type="button" className="calculator-key operation" onClick={() => chooseOperation('−')}>−</button>
              {['1', '2', '3'].map((digit) => <button key={digit} type="button" className="calculator-key" onClick={() => inputDigit(digit)}>{digit}</button>)}
              <button type="button" className="calculator-key operation" onClick={() => chooseOperation('+')}>+</button>
              <button type="button" className="calculator-key zero" onClick={() => inputDigit('0')}>0</button>
              <button type="button" className="calculator-key" onClick={inputDecimal}>.</button>
              <button type="button" className="calculator-key equals" onClick={handleEquals}>=</button>
            </div>
            <p className="calculator-hint">กดแป้นพิมพ์ตัวเลขและ Enter ได้ด้วย</p>
          </div>
        </div>
      )}
    </>
  )
}

// 2. ปฏิทิน มีระบบล็อควันได้ (Calendar with Date Locking)
function CalendarLockWidget({ items = [], lockedDate, onLockDate, onClearLock }) {
  const [isOpen, setIsOpen] = useState(false)
  const initialDate = lockedDate ? new Date(lockedDate) : new Date()
  const [viewYear, setViewYear] = useState(() => initialDate.getFullYear())
  const [viewMonth, setViewMonth] = useState(() => initialDate.getMonth())
  const [selectedDate, setSelectedDate] = useState(() => initialDate)

  // เมื่อเปิดปฏิทิน ให้เลื่อนเดือนไปที่วันที่ถูกล็อคอยู่หรือปัจจุบัน
  useEffect(() => {
    if (isOpen) {
      const target = lockedDate ? new Date(lockedDate) : new Date()
      setViewYear(target.getFullYear())
      setViewMonth(target.getMonth())
      setSelectedDate(target)
    }
  }, [isOpen, lockedDate])

  // ปิดด้วยปุ่ม ESC
  useEffect(() => {
    if (!isOpen) return
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') setIsOpen(false)
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isOpen])

  // นับจำนวนรายการในแต่ละวัน เพื่อแสดงจุด badge บนปฏิทิน
  const promptsByDay = useMemo(() => {
    const map = {}
    for (const item of items) {
      if (!item.createdAt) continue
      const d = new Date(item.createdAt)
      const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`
      map[key] = (map[key] || 0) + 1
    }
    return map
  }, [items])

  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate()
  const firstDayWeekday = new Date(viewYear, viewMonth, 1).getDay() // 0 = Sun, 6 = Sat

  const handlePrevMonth = () => {
    if (viewMonth === 0) {
      setViewYear(viewYear - 1)
      setViewMonth(11)
    } else {
      setViewMonth(viewMonth - 1)
    }
  }

  const handleNextMonth = () => {
    if (viewMonth === 11) {
      setViewYear(viewYear + 1)
      setViewMonth(0)
    } else {
      setViewMonth(viewMonth + 1)
    }
  }

  const handleToday = () => {
    const now = new Date()
    setViewYear(now.getFullYear())
    setViewMonth(now.getMonth())
    setSelectedDate(now)
  }

  const handleSelectDay = (day) => {
    setSelectedDate(new Date(viewYear, viewMonth, day))
  }

  const handleApplyLock = () => {
    onLockDate(selectedDate)
    setIsOpen(false)
  }

  const handleRemoveLock = () => {
    onClearLock()
    setIsOpen(false)
  }

  const selectedKey = `${selectedDate.getFullYear()}-${selectedDate.getMonth()}-${selectedDate.getDate()}`
  const selectedCount = promptsByDay[selectedKey] || 0

  return (
    <>
      <div className={`top-widget-btn calendar-lock-pill ${lockedDate ? 'locked' : ''}`}>
        <button
          type="button"
          className="calendar-pill-main"
          onClick={() => setIsOpen(true)}
          title="เปิดปฏิทินและเลือกล็อควัน"
        >
          <Icon name={lockedDate ? 'lock' : 'calendar'} />
          <span>{lockedDate ? formatThaiDateShort(lockedDate) : 'ปฏิทิน'}</span>
          {lockedDate && <span className="locked-dot-pulse" />}
        </button>
        {lockedDate && (
          <button
            type="button"
            className="calendar-pill-clear"
            onClick={(e) => {
              e.stopPropagation()
              onClearLock()
            }}
            title="ปลดล็อควัน"
          >
            <Icon name="close" />
          </button>
        )}
      </div>

      {isOpen && (
        <div className="calendar-modal-backdrop">
          <div className="calendar-card animate-scale-in" onClick={(e) => e.stopPropagation()}>
            {/* Header */}
            <div className="calendar-header">
              <div className="calendar-nav-controls">
                <button type="button" className="cal-nav-btn" onClick={handlePrevMonth} title="เดือนก่อนหน้า">
                  <Icon name="arrow-left" />
                </button>
                <div className="cal-month-title">
                  <strong>{THAI_MONTHS_FULL[viewMonth]}</strong> {viewYear + 543}
                </div>
                <button type="button" className="cal-nav-btn" onClick={handleNextMonth} title="เดือนถัดไป">
                  <Icon name="arrow-right" />
                </button>
              </div>
              <div className="cal-header-actions">
                <button type="button" className="cal-today-btn" onClick={handleToday}>
                  วันนี้
                </button>
                <button type="button" className="cal-close-btn" onClick={() => setIsOpen(false)}>
                  <Icon name="close" />
                </button>
              </div>
            </div>

            {/* Weekdays */}
            <div className="calendar-weekdays-row">
              {THAI_DAYS_SHORT.map((wd) => (
                <div key={wd} className="cal-weekday-cell">
                  {wd}
                </div>
              ))}
            </div>

            {/* Days Grid */}
            <div className="calendar-days-grid">
              {/* Empty leading cells */}
              {Array.from({ length: firstDayWeekday }).map((_, i) => (
                <div key={`empty-${i}`} className="cal-day-cell empty" />
              ))}

              {/* Days of the month */}
              {Array.from({ length: daysInMonth }).map((_, idx) => {
                const day = idx + 1
                const dateObj = new Date(viewYear, viewMonth, day)
                const isToday = isSameDay(dateObj, new Date())
                const isSelected = isSameDay(dateObj, selectedDate)
                const isLocked = lockedDate && isSameDay(dateObj, lockedDate)
                const key = `${viewYear}-${viewMonth}-${day}`
                const count = promptsByDay[key] || 0

                return (
                  <button
                    key={day}
                    type="button"
                    className={`cal-day-cell ${isToday ? 'is-today' : ''} ${isSelected ? 'is-selected' : ''} ${isLocked ? 'is-locked' : ''} ${count > 0 ? 'has-data' : ''}`}
                    onClick={() => handleSelectDay(day)}
                  >
                    <span className="cal-day-num">{day}</span>
                    {count > 0 && <span className="cal-day-count-badge">{count}</span>}
                    {isLocked && <span className="cal-day-lock-icon">🔒</span>}
                  </button>
                )
              })}
            </div>

            {/* Selection info */}
            <div className="calendar-selection-bar">
              <div className="cal-selected-info">
                <span>
                  วันที่เลือก: <strong>{formatThaiDateFull(selectedDate)}</strong>
                </span>
                <span className="cal-data-count">
                  พบ <strong>{selectedCount}</strong> รายการ
                </span>
              </div>
            </div>

            {/* Actions */}
            <div className="calendar-footer-actions">
              {lockedDate && (
                <button type="button" className="cal-action-unlock" onClick={handleRemoveLock}>
                  <Icon name="unlock" /> ปลดล็อควันที่
                </button>
              )}
              <button type="button" className="cal-action-lock" onClick={handleApplyLock}>
                <Icon name="lock" /> ล็อควันที่เลือก
              </button>
              <button type="button" className="cal-action-close" onClick={() => setIsOpen(false)}>
                ปิด
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

// 3. พยากรณ์อากาศ ดึงข้อมูลจาก Mekha (เมฆฝน) และ Open-Meteo อ้างอิงพิกัด GPS จริงแบบเรียลไทม์
function WeatherMekhaWidget() {
  const [isOpen, setIsOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [coords, setCoords] = useState({ lat: 13.7563, lon: 100.5018, isLiveGPS: false })
  const [locationName, setLocationName] = useState('กรุงเทพมหานคร')
  const [weather, setWeather] = useState(null)
  const [lastUpdated, setLastUpdated] = useState(null)

  const fetchWeather = async (lat, lon, locLabel) => {
    try {
      const res = await fetch(
        `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,relative_humidity_2m,apparent_temperature,precipitation,rain,weather_code,wind_speed_10m&timezone=auto`
      )
      if (res.ok) {
        const data = await res.json()
        setWeather(data.current)
        setLastUpdated(new Date())
        if (locLabel) setLocationName(locLabel)
      }
    } catch (err) {
      console.warn('Weather fetch warning:', err)
    } finally {
      setLoading(false)
    }
  }

  const requestGPS = () => {
    setLoading(true)
    if (!navigator.geolocation) {
      fetchWeather(13.7563, 100.5018, 'กรุงเทพมหานคร')
      return
    }
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const lat = pos.coords.latitude
        const lon = pos.coords.longitude
        let resolvedName = `${lat.toFixed(2)}°, ${lon.toFixed(2)}°`
        try {
          const geoRes = await fetch(
            `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lon}&format=json&accept-language=th`,
            { headers: { 'User-Agent': 'MixImagePromptVault/2.5' } }
          )
          if (geoRes.ok) {
            const geoData = await geoRes.json()
            const addr = geoData.address || {}
            resolvedName =
              addr.city ||
              addr.town ||
              addr.suburb ||
              addr.district ||
              addr.province ||
              addr.state ||
              resolvedName
          }
        } catch {
          // fallback
        }
        setCoords({ lat, lon, isLiveGPS: true })
        fetchWeather(lat, lon, resolvedName)
      },
      (err) => {
        console.warn('GPS position error or denied:', err)
        fetchWeather(13.7563, 100.5018, 'กรุงเทพมหานคร')
      },
      { timeout: 8000, enableHighAccuracy: true }
    )
  }

  useEffect(() => {
    requestGPS()
  }, [])

  useEffect(() => {
    if (!isOpen) return
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') setIsOpen(false)
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isOpen])

  const weatherCond = weather
    ? getWeatherCondition(weather.weather_code)
    : { label: 'กำลังโหลด...', emoji: '⛅' }

  return (
    <>
      <button
        type="button"
        className="top-widget-btn weather-mekha-pill"
        onClick={() => setIsOpen(true)}
        title="สภาพอากาศพิกัด GPS เรียลไทม์ และเรดาร์เมฆฝน Mekha"
      >
        <span className="weather-pill-emoji">{weatherCond.emoji}</span>
        <span className="weather-pill-temp">
          {weather ? `${Math.round(weather.temperature_2m)}°C` : '...'}
        </span>
        <span className="weather-pill-loc">{locationName}</span>
        <span className="weather-pill-radar-tag">Mekha 📡</span>
        {coords.isLiveGPS && <span className="gps-live-badge" title="GPS ดาวเทียมสด" />}
      </button>

      {isOpen && (
        <div className="weather-modal-backdrop">
          <div className="weather-card animate-scale-in" onClick={(e) => e.stopPropagation()}>
            {/* Header */}
            <div className="weather-header">
              <div className="weather-title-wrap">
                <div className="weather-header-icon">
                  <Icon name="cloud-rain" />
                </div>
                <div>
                  <h3 className="weather-title">พยากรณ์อากาศ & เรดาร์ Mekha</h3>
                  <p className="weather-subtitle">
                    อ้างอิงพิกัด GPS เรียลไทม์ • เรดาร์ตรวจกลุ่มฝนสดประเทศไทย
                  </p>
                </div>
              </div>
              <button
                type="button"
                className="weather-close-btn"
                onClick={() => setIsOpen(false)}
                title="ปิด"
              >
                <Icon name="close" />
              </button>
            </div>

            {/* Main Weather Hero Card */}
            <div className="weather-hero-card">
              <div className="weather-hero-left">
                <span className="weather-hero-emoji">{weatherCond.emoji}</span>
                <div>
                  <div className="weather-hero-temp">
                    {weather ? `${Math.round(weather.temperature_2m)}°C` : '--°C'}
                  </div>
                  <div className="weather-hero-condition">{weatherCond.label}</div>
                  {weather?.apparent_temperature && (
                    <div className="weather-hero-feels">
                      รู้สึกเหมือน {Math.round(weather.apparent_temperature)}°C
                    </div>
                  )}
                </div>
              </div>
              <div className="weather-hero-right">
                <div className="weather-gps-badge">
                  <Icon name="gps" />
                  <span>{coords.isLiveGPS ? 'GPS ดาวเทียมสด' : 'พิกัดเริ่มต้น'}</span>
                </div>
                <div className="weather-location-name">{locationName}</div>
                <div className="weather-latlon">
                  {coords.lat.toFixed(3)}°N, {coords.lon.toFixed(3)}°E
                </div>
              </div>
            </div>

            {/* Metrics Grid */}
            <div className="weather-metrics-grid">
              <div className="weather-metric-item">
                <span className="metric-label">ความชื้นสัมพัทธ์</span>
                <span className="metric-val">{weather ? `${weather.relative_humidity_2m}%` : '--'}</span>
              </div>
              <div className="weather-metric-item">
                <span className="metric-label">ปริมาณฝน</span>
                <span className="metric-val">{weather ? `${weather.precipitation ?? 0} มม.` : '--'}</span>
              </div>
              <div className="weather-metric-item">
                <span className="metric-label">ความเร็วลม</span>
                <span className="metric-val">{weather ? `${weather.wind_speed_10m} กม./ชม.` : '--'}</span>
              </div>
              <div className="weather-metric-item">
                <span className="metric-label">อัปเดตล่าสุด</span>
                <span className="metric-val">
                  {lastUpdated
                    ? lastUpdated.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' })
                    : '--:--'}
                </span>
              </div>
            </div>

            {/* Mekha Realtime Radar Section */}
            <div className="mekha-radar-section">
              <div className="mekha-radar-info">
                <div className="mekha-radar-title">
                  <Icon name="radar" />
                  <span>ระบบเรดาร์ตรวจจับเมฆฝน Mekha (Mekhfon)</span>
                </div>
                <p className="mekha-radar-desc">
                  ติดตามภาพเรดาร์กลุ่มฝนสดแบบ Doppler ทั่วประเทศไทย ตรวจจับเมฆฝน ฟ้าผ่า และทิศทางพายุแบบเรียลไทม์
                </p>
              </div>
              <a
                href={`https://app.mekhfon.com/?lat=${coords.lat}&lon=${coords.lon}`}
                target="_blank"
                rel="noopener noreferrer"
                className="mekha-launch-btn"
              >
                <Icon name="radar" />
                <span>เปิดเรดาร์กลุ่มฝนสด Mekha (พิกัด GPS นี้) ↗</span>
              </a>
            </div>

            {/* Footer controls */}
            <div className="weather-footer-actions">
              <button
                type="button"
                className="weather-refresh-gps-btn"
                onClick={requestGPS}
                disabled={loading}
              >
                <Icon name="gps" className={loading ? 'spin-icon' : ''} />
                <span>{loading ? 'กำลังดึงพิกัด GPS...' : 'รีเฟรช GPS เรียลไทม์'}</span>
              </button>
              <button
                type="button"
                className="weather-dismiss-btn"
                onClick={() => setIsOpen(false)}
              >
                ปิด
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

const AppDownloadModal = memo(function AppDownloadModal({
  onClose,
  deferredPrompt,
  onInstallPwa,
  flash,
}) {
  const [tab, setTab] = useState('windows') // 'windows' | 'android' | 'settings'
  const [customLinks, setCustomLinks] = useState(() => {
    try {
      const saved = localStorage.getItem('mix_custom_download_links')
      return saved ? JSON.parse(saved) : { exeUrl: '', apkUrl: '' }
    } catch {
      return { exeUrl: '', apkUrl: '' }
    }
  })
  const [copiedLink, setCopiedLink] = useState(false)
  const [exeUrlInput, setExeUrlInput] = useState(customLinks.exeUrl || '')
  const [apkUrlInput, setApkUrlInput] = useState(customLinks.apkUrl || '')

  const defaultExeZipUrl = './downloads/MIX-Prompt-Vault-Windows.zip'
  const defaultExeUrl = './downloads/MIX-Prompt-Vault.exe'
  const defaultApkBuilderUrl = 'https://www.pwabuilder.com/'

  const effectiveExeUrl = customLinks.exeUrl?.trim() || defaultExeZipUrl
  const effectiveApkUrl = customLinks.apkUrl?.trim() || defaultApkBuilderUrl

  const handleSaveSettings = (e) => {
    e.preventDefault()
    const next = {
      exeUrl: exeUrlInput.trim(),
      apkUrl: apkUrlInput.trim(),
    }
    setCustomLinks(next)
    try {
      localStorage.setItem('mix_custom_download_links', JSON.stringify(next))
    } catch {
      // ignore
    }
    flash?.('บันทึกการตั้งค่าลิงก์ดาวน์โหลดเรียบร้อยแล้ว')
  }

  const handleCopyShareLink = () => {
    const url = window.location.href.split('#')[0] || 'https://woon-miximage.github.io/mix-image-prompt-vault/'
    try {
      navigator.clipboard?.writeText(url)
    } catch {
      // fallback
    }
    setCopiedLink(true)
    flash?.('คัดลอกลิงก์เว็บแอปเรียบร้อยแล้ว')
    setTimeout(() => setCopiedLink(false), 2500)
  }

  return (
    <div className="modal-backdrop">
      <div className="modal-card download-modal-card animate-scale-in" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div className="download-modal-header-brand">
            <img src="./brand/jongjang-app-icon.png" alt="MIX Prompt" className="download-header-icon" />
            <div>
              <div className="badge-tag-wrap">
                <span className="download-badge-version">v1.0.0 Online Live-Sync</span>
                <span className="download-badge-free">ฟรีตลอดชีพ</span>
              </div>
              <h2 className="download-modal-title">ดาวน์โหลดแอป MIX Image Prompt</h2>
              <p className="download-modal-subtitle">ติดตั้งลงคอมพิวเตอร์และมือถือ เปิดใช้งานเต็มหน้าจอ รวดเร็ว และอัปเดตข้อมูลอัตโนมัติ</p>
            </div>
          </div>
          <button type="button" className="round-button" onClick={onClose} aria-label="ปิด">
            <Icon name="close" />
          </button>
        </div>

        <div className="download-nav-tabs">
          <button
            type="button"
            className={`download-tab-btn ${tab === 'windows' ? 'active' : ''}`}
            onClick={() => setTab('windows')}
          >
            <Icon name="windows" />
            <span>Windows (.exe)</span>
          </button>
          <button
            type="button"
            className={`download-tab-btn ${tab === 'android' ? 'active' : ''}`}
            onClick={() => setTab('android')}
          >
            <Icon name="android" />
            <span>Android (.apk / PWA)</span>
          </button>
          <button
            type="button"
            className={`download-tab-btn ${tab === 'settings' ? 'active' : ''}`}
            onClick={() => setTab('settings')}
          >
            <Icon name="settings" />
            <span>ตั้งค่าลิงก์</span>
          </button>
        </div>

        <div className="download-modal-body">
          {tab === 'windows' && (
            <div className="download-tab-content animate-fade-in">
              <div className="download-feature-card win-card">
                <div className="feature-card-header">
                  <div className="feature-os-icon win-icon">
                    <Icon name="windows" />
                  </div>
                  <div>
                    <h3>Windows Desktop App (.exe)</h3>
                    <p>สำหรับ Windows 10 และ Windows 11 (64-bit)</p>
                  </div>
                  <span className="feature-badge win-badge">⚡ ทำงานแยกหน้าต่าง</span>
                </div>

                <div className="feature-benefits-list">
                  <div className="benefit-item">
                    <span className="benefit-check">✓</span>
                    <span><strong>เปิดใช้งานเต็มหน้าจอ:</strong> ไม่ต้องเปิดเว็บเบราว์เซอร์ ทำงานแยกเป็นโปรแกรมเฉพาะ</span>
                  </div>
                  <div className="benefit-item">
                    <span className="benefit-check">✓</span>
                    <span><strong>อัปเดตอัตโนมัติ (Live Sync):</strong> เมื่อเว็บมีการปรับปรุง ตัวโปรแกรมจะอัปเดตตามทันที 100%</span>
                  </div>
                  <div className="benefit-item">
                    <span className="benefit-check">✓</span>
                    <span><strong>ไอคอนมาสคอตจ๋องแจ๋ง:</strong> ปักหมุดบน Taskbar, Desktop และ Start Menu ได้สวยงาม</span>
                  </div>
                  <div className="benefit-item">
                    <span className="benefit-check">✓</span>
                    <span><strong>เบาและเร็ว:</strong> ขับเคลื่อนด้วย Microsoft WebView2 โหลดเร็ว ไม่กินแรม</span>
                  </div>
                </div>

                <div className="download-actions-grid">
                  <a
                    href={effectiveExeUrl}
                    download="MIX-Prompt-Vault-Windows.zip"
                    className="download-btn-primary win-btn"
                    target={customLinks.exeUrl ? '_blank' : '_self'}
                    rel="noopener noreferrer"
                  >
                    <Icon name="download" />
                    <div className="download-btn-text">
                      <strong>ดาวน์โหลดโปรแกรม Windows (.zip / .exe)</strong>
                      <span>ขนาด 635 KB แตกไฟล์แล้วดับเบิลคลิก MIX-Prompt-Vault.exe เปิดได้ทันที</span>
                    </div>
                  </a>

                  <a
                    href={defaultExeUrl}
                    download="MIX-Prompt-Vault.exe"
                    className="download-link-secondary"
                  >
                    <span>หรือคลิกที่นี่เพื่อดาวน์โหลดไฟล์ <code>MIX-Prompt-Vault.exe</code> โดยตรง (1.08 MB) ↗</span>
                  </a>
                </div>

                <div className="download-install-tip">
                  <Icon name="info" />
                  <div>
                    <strong>คำแนะนำการติดตั้ง:</strong>
                    <ol>
                      <li>ดาวน์โหลดไฟล์แล้วแตกไฟล์ <code>.zip</code> ออกมา</li>
                      <li>ดับเบิลคลิกที่ไฟล์ <code>MIX-Prompt-Vault.exe</code> เพื่อเข้าใช้งานได้ทันที</li>
                      <li>คลิกขวาที่ไฟล์ เลือก <em>"สร้างทางลัด" (Create shortcut)</em> หรือ <em>"ปักหมุดที่แถบงาน" (Pin to Taskbar)</em></li>
                    </ol>
                  </div>
                </div>
              </div>
            </div>
          )}

          {tab === 'android' && (
            <div className="download-tab-content animate-fade-in">
              <div className="download-feature-card android-card">
                <div className="feature-card-header">
                  <div className="feature-os-icon android-icon">
                    <Icon name="android" />
                  </div>
                  <div>
                    <h3>Android Mobile App (.apk / PWA)</h3>
                    <p>สำหรับสมาร์ตโฟนและแท็บเล็ตระบบ Android ทุกรุ่น</p>
                  </div>
                  <span className="feature-badge android-badge">📱 ใช้งานเหมือนแอปจริง</span>
                </div>

                <div className="feature-benefits-list">
                  <div className="benefit-item">
                    <span className="benefit-check">✓</span>
                    <span><strong>เปิดเหมือนแอปแท้ 100%:</strong> ไม่มีแถบ URL กวนใจ ทำงานเต็มหน้าจอ</span>
                  </div>
                  <div className="benefit-item">
                    <span className="benefit-check">✓</span>
                    <span><strong>อัปเดตแบบเรียลไทม์:</strong> อัปเดตพรอมต์และดีไซน์ตามเว็บจริงทันที</span>
                  </div>
                  <div className="benefit-item">
                    <span className="benefit-check">✓</span>
                    <span><strong>ไอคอนแอปจ๋องแจ๋ง:</strong> แสดงบนหน้าจอโฮมและหน้าแอปรองรับทุกหน้าจอ</span>
                  </div>
                </div>

                <div className="android-options-container">
                  {/* Option A: Direct APK / PWABuilder */}
                  <div className="android-sub-card">
                    <div className="sub-card-badge">ทางเลือกที่ 1 • สำหรับติดตั้งด้วยไฟล์ .APK</div>
                    <h4>ดาวน์โหลดไฟล์แพ็กเกจ .APK</h4>
                    <p>เหมาะสำหรับนำไฟล์ APK ไปติดตั้งลงเครื่อง Android หรือส่งต่อให้เพื่อน</p>
                    <a
                      href={effectiveApkUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="download-btn-primary android-btn"
                    >
                      <Icon name="download" />
                      <div className="download-btn-text">
                        <strong>{customLinks.apkUrl ? 'ดาวน์โหลดไฟล์ .APK โดยตรง' : 'สร้างและดาวน์โหลด APK (PWABuilder)'}</strong>
                        <span>{customLinks.apkUrl ? 'คลิกเพื่อดาวน์โหลดไฟล์ APK' : 'ระบบของ Microsoft แปลงเว็บเป็น APK ให้อัตโนมัติ'}</span>
                      </div>
                    </a>
                  </div>

                  {/* Option B: Install via Browser PWA */}
                  <div className="android-sub-card highlight">
                    <div className="sub-card-badge accent">ทางเลือกที่ 2 • แนะนำ สะดวกและเร็วที่สุด</div>
                    <h4>ติดตั้งแอปลงในมือถือทันที (ไม่ต้องโหลดไฟล์)</h4>
                    <p>เปิดใช้งานเสมือนแอปจริงได้ทันทีจาก Google Chrome</p>
                    {deferredPrompt ? (
                      <button
                        type="button"
                        className="download-btn-primary pwa-btn"
                        onClick={onInstallPwa}
                      >
                        <Icon name="smartphone" />
                        <div className="download-btn-text">
                          <strong>กดเพื่อติดตั้งแอปลงในโทรศัพท์ทันที</strong>
                          <span>คลิกปุ่มนี้เพื่อเปิดหน้าต่างติดตั้งของระบบ Android</span>
                        </div>
                      </button>
                    ) : (
                      <div className="pwa-steps-guide">
                        <div className="pwa-step-item">
                          <span className="step-num">1</span>
                          <span>เปิดเว็บ <code>woon-miximage.github.io/mix-image-prompt-vault</code> ใน Google Chrome</span>
                        </div>
                        <div className="pwa-step-item">
                          <span className="step-num">2</span>
                          <span>กดปุ่มเมนู <strong>3 จุด (⋮)</strong> ที่มุมขวาบนของหน้าจอ</span>
                        </div>
                        <div className="pwa-step-item">
                          <span className="step-num">3</span>
                          <span>เลือก <strong>"ติดตั้งแอปลงในโทรศัพท์"</strong> หรือ <strong>"เพิ่มลงในหน้าจอหลัก"</strong></span>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}

          {tab === 'settings' && (
            <div className="download-tab-content animate-fade-in">
              <form onSubmit={handleSaveSettings} className="download-settings-card">
                <h3>ตั้งค่าลิงก์ดาวน์โหลดส่วนตัว (Custom Download Links)</h3>
                <p className="settings-desc">
                  หากคุณได้อัปโหลดไฟล์ <code>.apk</code> หรือ <code>.exe</code> ไปไว้บน Google Drive, Dropbox, หรือคลาวด์ส่วนตัว 
                  สามารถนำลิงก์มาวางที่นี่เพื่อให้ปุ่มดาวน์โหลดชี้ไปยังไฟล์ของคุณได้ทันทีครับ
                </p>

                <div className="form-group">
                  <label htmlFor="custom-exe-input">
                    <Icon name="windows" />
                    <strong>ลิงก์ดาวน์โหลด Windows (.exe):</strong>
                  </label>
                  <input
                    id="custom-exe-input"
                    type="url"
                    value={exeUrlInput}
                    onChange={(e) => setExeUrlInput(e.target.value)}
                    placeholder="เช่น https://drive.google.com/uc?id=... (หรือเว้นว่างเพื่อใช้ไฟล์เริ่มต้น)"
                    className="custom-url-input"
                  />
                  <span className="field-hint">ค่าเริ่มต้นปัจจุบัน: <code>{defaultExeZipUrl}</code></span>
                </div>

                <div className="form-group">
                  <label htmlFor="custom-apk-input">
                    <Icon name="android" />
                    <strong>ลิงก์ดาวน์โหลด Android (.apk):</strong>
                  </label>
                  <input
                    id="custom-apk-input"
                    type="url"
                    value={apkUrlInput}
                    onChange={(e) => setApkUrlInput(e.target.value)}
                    placeholder="เช่น https://drive.google.com/uc?id=... (หรือเว้นว่างเพื่อใช้ PWABuilder)"
                    className="custom-url-input"
                  />
                  <span className="field-hint">ค่าเริ่มต้นปัจจุบัน: <code>PWABuilder Generator</code></span>
                </div>

                <div className="settings-actions">
                  <button type="submit" className="save-settings-btn">
                    <Icon name="check" />
                    <span>บันทึกการตั้งค่าลิงก์</span>
                  </button>
                  {(customLinks.exeUrl || customLinks.apkUrl) && (
                    <button
                      type="button"
                      className="reset-settings-btn"
                      onClick={() => {
                        setExeUrlInput('')
                        setApkUrlInput('')
                        setCustomLinks({ exeUrl: '', apkUrl: '' })
                        try {
                          localStorage.removeItem('mix_custom_download_links')
                        } catch {}
                        flash?.('รีเซ็ตเป็นลิงก์เริ่มต้นแล้ว')
                      }}
                    >
                      รีเซ็ตกลับเป็นค่าเริ่มต้น
                    </button>
                  )}
                </div>
              </form>
            </div>
          )}
        </div>

        <div className="download-modal-footer">
          <div className="share-web-box">
            <span className="share-label">แชร์ลิงก์เว็บแอป:</span>
            <code className="share-url">https://woon-miximage.github.io/mix-image-prompt-vault/</code>
            <button
              type="button"
              className="copy-share-btn"
              onClick={handleCopyShareLink}
              title="คัดลอกลิงก์"
            >
              <Icon name={copiedLink ? 'check' : 'copy'} />
              <span>{copiedLink ? 'คัดลอกแล้ว!' : 'คัดลอก'}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  )
})

// =====================================================================
// SavingsPage — ฟังก์ชันเงินออม (รายรับ / รายจ่าย / บัญชีธนาคาร & การ์ดเสมือน)
// =====================================================================
const BANK_PRESETS = [
  { id: 'kbank', name: 'ธนาคารกสิกรไทย', code: 'KBANK', color: 'kbank', bg: 'linear-gradient(135deg, rgba(7, 94, 58, 0.88) 0%, rgba(19, 168, 104, 0.8) 100%)' },
  { id: 'scb', name: 'ธนาคารไทยพาณิชย์', code: 'SCB', color: 'scb', bg: 'linear-gradient(135deg, rgba(78, 41, 120, 0.9) 0%, rgba(135, 76, 185, 0.82) 100%)' },
  { id: 'bbl', name: 'ธนาคารกรุงเทพ', code: 'BBL', color: 'bbl', bg: 'linear-gradient(135deg, rgba(10, 59, 130, 0.9) 0%, rgba(26, 98, 198, 0.82) 100%)' },
  { id: 'ktb', name: 'ธนาคารกรุงไทย', code: 'KTB', color: 'ktb', bg: 'linear-gradient(135deg, rgba(2, 132, 199, 0.9) 0%, rgba(6, 182, 212, 0.82) 100%)' },
  { id: 'ttb', name: 'ทีเอ็มบีธนชาต (ttb)', code: 'TTB', color: 'ttb', bg: 'linear-gradient(135deg, rgba(15, 23, 42, 0.92) 0%, rgba(30, 64, 175, 0.85) 50%, rgba(234, 88, 12, 0.85) 100%)' },
  { id: 'bay', name: 'ธนาคารกรุงศรีอยุธยา', code: 'BAY', color: 'bay', bg: 'linear-gradient(135deg, rgba(180, 83, 9, 0.9) 0%, rgba(245, 158, 11, 0.82) 100%)' },
  { id: 'gsb', name: 'ธนาคารออมสิน', code: 'GSB', color: 'gsb', bg: 'linear-gradient(135deg, rgba(190, 24, 93, 0.9) 0%, rgba(236, 72, 153, 0.82) 100%)' },
  { id: 'truemoney', name: 'ทรูมันนี่ (TrueMoney)', code: 'TRUE', color: 'truemoney', bg: 'linear-gradient(135deg, rgba(194, 65, 12, 0.9) 0%, rgba(249, 115, 22, 0.82) 100%)' },
  { id: 'promptpay', name: 'พร้อมเพย์ (PromptPay)', code: 'PROMPT', color: 'promptpay', bg: 'linear-gradient(135deg, rgba(0, 45, 98, 0.92) 0%, rgba(0, 102, 153, 0.85) 100%)' },
  { id: 'card', name: 'บัตรเครดิต / เดบิต', code: 'CARD', color: 'card', bg: 'linear-gradient(135deg, rgba(24, 24, 27, 0.95) 0%, rgba(63, 63, 70, 0.88) 50%, rgba(39, 39, 42, 0.95) 100%)' },
]

function formatAccNumber(val, type) {
  if (!val) return ''
  const clean = String(val).replace(/\D/g, '')
  if (type === 'card') {
    if (clean.length === 16) {
      return clean.replace(/(\d{4})(\d{4})(\d{4})(\d{4})/, '$1 $2 $3 $4')
    }
    if (clean.length > 4) {
      return clean.replace(/(\d{4})(?=\d)/g, '$1 ')
    }
    return clean || val
  }
  if (type === 'promptpay') {
    if (clean.length === 10) {
      return clean.replace(/(\d{3})(\d{3})(\d{4})/, '$1-$2-$3')
    }
    if (clean.length === 13) {
      return clean.replace(/(\d{1})(\d{4})(\d{5})(\d{2})(\d{1})/, '$1-$2-$3-$4-$5')
    }
    return val
  }
  // Bank Account
  if (clean.length === 10) {
    return clean.replace(/(\d{3})(\d{1})(\d{5})(\d{1})/, '$1-$2-$3-$4')
  }
  if (clean.length === 12) {
    return clean.replace(/(\d{3})(\d{6})(\d{3})/, '$1-$2-$3')
  }
  if (clean.length === 13) {
    return clean.replace(/(\d{1})(\d{4})(\d{5})(\d{2})(\d{1})/, '$1-$2-$3-$4-$5')
  }
  if (clean.length > 4) {
    return clean.replace(/(\d{3})(?=\d)/g, '$1-')
  }
  return val
}

const ACCOUNT_TYPE_TABS = [
  { id: 'all', label: 'ทั้งหมด', emoji: '✨', badge: 'ALL' },
  { id: 'bank', label: 'สมุดบัญชี', emoji: '📖', badge: 'สมุดบัญชี' },
  { id: 'card', label: 'การ์ด', emoji: '💳', badge: 'การ์ด' },
  { id: 'promptpay', label: 'พร้อมเพย์', emoji: '⚡', badge: 'พร้อมเพย์' },
]

function CardDragToolbar({
  account,
  index = 0,
  totalShown = 1,
  onMoveStep,
  isPreview = false,
}) {
  if (isPreview) return null
  const typeLabel =
    account.type === 'promptpay'
      ? '⚡ พร้อมเพย์'
      : account.type === 'card'
      ? '💳 การ์ด'
      : '📖 สมุดบัญชี'

  return (
    <div
      className="vcard-drag-toolbar"
      title="คลิกค้างที่การ์ดเพื่อลากย้ายตำแหน่ง หรือลากไปวางทับแท็กด้านบนเพื่อเปลี่ยนประเภท"
    >
      <div className="vcard-drag-left">
        <span className="vcard-drag-grip">
          <Icon name="grip" />
          <span>ลากย้าย</span>
        </span>
        <span className={`vcard-cat-tag tag-${account.type || 'bank'}`}>
          {typeLabel}
        </span>
      </div>

      <div className="vcard-step-btns">
        <button
          type="button"
          className="vcard-step-btn"
          disabled={index <= 0}
          onClick={(e) => {
            e.stopPropagation()
            onMoveStep?.(account, -1)
          }}
          title="ขยับไปก่อนหน้า"
          aria-label="ขยับไปก่อนหน้า"
        >
          <Icon name="arrow-left" />
        </button>
        <button
          type="button"
          className="vcard-step-btn"
          disabled={index >= totalShown - 1}
          onClick={(e) => {
            e.stopPropagation()
            onMoveStep?.(account, 1)
          }}
          title="ขยับไปถัดไป"
          aria-label="ขยับไปถัดไป"
        >
          <Icon name="arrow-right" />
        </button>
      </div>
    </div>
  )
}

// ── 1. Bank Passbook Card (สมุดบัญชีเงินฝาก) ──
const BankPassbookCard = memo(function BankPassbookCard({
  account,
  preset,
  formattedNumber,
  isCopiedNum,
  isCopiedAll,
  onCopyNumber,
  onCopyAll,
  onEdit,
  onDelete,
  index,
  totalShown,
  isDragging,
  isDragOver,
  onDragStart,
  onDragOver,
  onDragLeave,
  onDrop,
  onDragEnd,
  onMoveStep,
  isPreview,
}) {
  return (
    <div
      className={`virtual-card-glass passbook-style theme-${account.color || preset.color} ${isDragging ? 'is-dragging' : ''} ${isDragOver ? 'is-drag-over' : ''}`}
      style={{ background: preset.bg }}
      draggable={!isPreview && !isTouchDevice}
      onDragStart={(e) => !isPreview && !isTouchDevice && onDragStart?.(e, account)}
      onDragOver={(e) => !isPreview && !isTouchDevice && onDragOver?.(e, account)}
      onDragLeave={(e) => !isPreview && !isTouchDevice && onDragLeave?.(e, account)}
      onDrop={(e) => !isPreview && !isTouchDevice && onDrop?.(e, account)}
      onDragEnd={!isPreview && !isTouchDevice ? onDragEnd : undefined}
    >
      <div className="passbook-spine">
        <div className="passbook-stitch-line" />
      </div>
      <div className="card-gloss-shimmer" />

      <div className="passbook-inner">
        <CardDragToolbar
          account={account}
          index={index}
          totalShown={totalShown}
          onMoveStep={onMoveStep}
          isPreview={isPreview}
        />
        {/* Passbook Header */}
        <div className="passbook-header">
          <div className="passbook-bank-brand">
            <span className="card-bank-badge">{preset.code}</span>
            <div className="passbook-titles">
              <span className="card-bank-name">{account.bankName || preset.name}</span>
              <span className="passbook-type-sub">สมุดคู่ฝากเงินฝากออมทรัพย์ • SAVINGS PASSBOOK</span>
            </div>
          </div>
          <div className="passbook-seal" title="ตราประทับสมุดบัญชี">
            <Icon name="bank" />
          </div>
        </div>

        {/* Passbook Account Number */}
        <div className="passbook-account-box">
          <span className="passbook-field-label">เลขที่บัญชี / ACCOUNT NO.</span>
          <div
            className="virtual-card-number-box passbook-number-box"
            onClick={() => onCopyNumber(account)}
            title="คลิกเพื่อคัดลอกเลขบัญชี"
            role="button"
            tabIndex={0}
          >
            <span className="virtual-card-number passbook-number">{formattedNumber || '•••-•-•••••-•'}</span>
            <button
              type="button"
              className={`card-quick-copy-pill ${isCopiedNum ? 'copied' : ''}`}
              onClick={(e) => { e.stopPropagation(); onCopyNumber(account); }}
              title={isCopiedNum ? 'คัดลอกแล้ว' : 'คัดลอกเลขบัญชี'}
            >
              <Icon name={isCopiedNum ? 'check' : 'copy'} />
            </button>
          </div>
        </div>

        {/* Passbook Details */}
        <div className="passbook-meta-grid">
          <div className="passbook-meta-col">
            <span className="passbook-field-label">ชื่อบัญชี / ACCOUNT NAME</span>
            <strong className="passbook-holder-name">{account.accName || 'NATTANONT VONGKASAI'}</strong>
          </div>
          <div className="passbook-meta-col">
            <span className="passbook-field-label">สาขา / สาขาบัญชี</span>
            <span className="passbook-branch-text">{account.label || 'สำนักงานใหญ่ (ออมทรัพย์)'}</span>
          </div>
        </div>

        {/* Passbook Footer */}
        <div className="passbook-footer">
          <div className="passbook-magnetic-strip">
            <div className="passbook-barcode" />
            <span className="passbook-serial">NO. {String(account.accNumber || '0000').slice(-4)} // PASSBOOK VERIFIED</span>
          </div>

          <div className="card-actions-row">
            <button
              type="button"
              className={`card-glass-btn share-btn ${isCopiedAll ? 'copied' : ''}`}
              onClick={() => onCopyAll(account)}
              title="คัดลอกข้อมูลโอนเงิน"
            >
              <Icon name={isCopiedAll ? 'check' : 'copy'} />
              <span>{isCopiedAll ? 'คัดลอกครบแล้ว' : 'ส่งต่อ'}</span>
            </button>
            <button
              type="button"
              className="card-glass-btn edit-btn"
              onClick={() => onEdit(account)}
              title="แก้ไขสมุดบัญชี"
            >
              <Icon name="edit" />
            </button>
            <button
              type="button"
              className="card-glass-btn delete-btn"
              onClick={() => onDelete(account.id)}
              title="ลบสมุดบัญชี"
            >
              <Icon name="trash" />
            </button>
          </div>
        </div>
      </div>
    </div>
  )
})

// ── 2. Virtual Credit/Debit Card (การ์ดเสมือน) ──
const CreditDebitCard = memo(function CreditDebitCard({
  account,
  preset,
  formattedNumber,
  isCopiedNum,
  isCopiedCvv,
  isCopiedAll,
  onCopyNumber,
  onCopyCvv,
  onCopyAll,
  onEdit,
  onDelete,
  expiryText,
  cvvText,
  showCvv,
  setShowCvv,
  index,
  totalShown,
  isDragging,
  isDragOver,
  onDragStart,
  onDragOver,
  onDragLeave,
  onDrop,
  onDragEnd,
  onMoveStep,
  isPreview,
}) {
  return (
    <div
      className={`virtual-card-glass card-style theme-${account.color || preset.color} ${isDragging ? 'is-dragging' : ''} ${isDragOver ? 'is-drag-over' : ''}`}
      style={{ background: preset.bg }}
      draggable={!isPreview && !isTouchDevice}
      onDragStart={(e) => !isPreview && !isTouchDevice && onDragStart?.(e, account)}
      onDragOver={(e) => !isPreview && !isTouchDevice && onDragOver?.(e, account)}
      onDragLeave={(e) => !isPreview && !isTouchDevice && onDragLeave?.(e, account)}
      onDrop={(e) => !isPreview && !isTouchDevice && onDrop?.(e, account)}
      onDragEnd={!isPreview && !isTouchDevice ? onDragEnd : undefined}
    >
      <div className="card-gloss-shimmer" />
      <div className="card-glass-orb orb-a" />
      <div className="card-glass-orb orb-b" />

      <CardDragToolbar
        account={account}
        index={index}
        totalShown={totalShown}
        onMoveStep={onMoveStep}
        isPreview={isPreview}
      />

      {/* Top row */}
      <div className="virtual-card-header">
        <div className="card-bank-brand">
          <span className="card-bank-badge">{preset.code}</span>
          <span className="card-bank-name">{account.bankName || preset.name}</span>
        </div>
        <div className="card-tech-icons">
          <Icon name="wifi" className="card-contactless-icon" />
          <span className="card-type-tag">VIRTUAL CARD</span>
        </div>
      </div>

      {/* EMV Chip & Nickname */}
      <div className="virtual-card-chip-row">
        <div className="card-emv-chip" title="EMV Smart Chip">
          <div className="chip-line horizontal" />
          <div className="chip-line vertical" />
        </div>
        {account.label && (
          <span className="card-nickname-tag">{account.label}</span>
        )}
      </div>

      {/* 16-Digit Card Number (Guaranteed Single Line) */}
      <div
        className="virtual-card-number-box"
        onClick={() => onCopyNumber(account)}
        title="คลิกเพื่อคัดลอกเลขบัตร"
        role="button"
        tabIndex={0}
      >
        <span className="virtual-card-number">{formattedNumber || '•••• •••• •••• ••••'}</span>
        <button
          type="button"
          className={`card-quick-copy-pill ${isCopiedNum ? 'copied' : ''}`}
          onClick={(e) => { e.stopPropagation(); onCopyNumber(account); }}
          title={isCopiedNum ? 'คัดลอกแล้ว' : 'คัดลอกเลขบัตร'}
        >
          <Icon name={isCopiedNum ? 'check' : 'copy'} />
        </button>
      </div>

      {/* Expiry Date (วันหมดอายุ) & Security Code (CVV 3-4 ตัว) */}
      <div className="virtual-card-sec-row">
        <div className="card-sec-col">
          <span className="card-sec-label">VALID THRU</span>
          <span className="card-sec-val mono">{expiryText}</span>
        </div>

        <div className="card-sec-col">
          <span className="card-sec-label">CVV / CVC</span>
          <div className="card-cvv-interactive">
            <span className="card-sec-val mono">
              {showCvv ? cvvText : '•••'}
            </span>
            <button
              type="button"
              className="card-sec-icon-btn"
              onClick={(e) => { e.stopPropagation(); setShowCvv(v => !v); }}
              title={showCvv ? 'ซ่อนรหัส CVV' : 'แสดงรหัส CVV'}
            >
              <Icon name={showCvv ? 'eye-off' : 'eye'} />
            </button>
            <button
              type="button"
              className={`card-sec-icon-btn ${isCopiedCvv ? 'copied' : ''}`}
              onClick={(e) => { e.stopPropagation(); onCopyCvv(account); }}
              title="คัดลอกรหัส CVV"
            >
              <Icon name={isCopiedCvv ? 'check' : 'copy'} />
            </button>
          </div>
        </div>
      </div>

      {/* Card Footer: Holder Name & Action Buttons */}
      <div className="virtual-card-footer">
        <div className="card-holder-info">
          <span className="card-holder-label">CARDHOLDER NAME</span>
          <strong className="card-holder-name">{account.accName || 'NATTANONT VONGKASAI'}</strong>
        </div>

        <div className="card-actions-row">
          <button
            type="button"
            className={`card-glass-btn share-btn ${isCopiedAll ? 'copied' : ''}`}
            onClick={() => onCopyAll(account)}
            title="คัดลอกข้อมูลบัตร"
          >
            <Icon name={isCopiedAll ? 'check' : 'copy'} />
            <span>{isCopiedAll ? 'คัดลอกครบแล้ว' : 'ส่งต่อ'}</span>
          </button>
          <button
            type="button"
            className="card-glass-btn edit-btn"
            onClick={() => onEdit(account)}
            title="แก้ไขบัตร"
          >
            <Icon name="edit" />
          </button>
          <button
            type="button"
            className="card-glass-btn delete-btn"
            onClick={() => onDelete(account.id)}
            title="ลบบัตร"
          >
            <Icon name="trash" />
          </button>
        </div>
      </div>
    </div>
  )
})

// ── 3. PromptPay Card (พร้อมเพย์) ──
const PromptPayCard = memo(function PromptPayCard({
  account,
  preset,
  formattedNumber,
  isCopiedNum,
  isCopiedAll,
  onCopyNumber,
  onCopyAll,
  onEdit,
  onDelete,
  index,
  totalShown,
  isDragging,
  isDragOver,
  onDragStart,
  onDragOver,
  onDragLeave,
  onDrop,
  onDragEnd,
  onMoveStep,
  isPreview,
}) {
  const isNationalId = account.accNumber?.replace(/\D/g, '').length === 13

  return (
    <div
      className={`virtual-card-glass promptpay-style theme-promptpay ${isDragging ? 'is-dragging' : ''} ${isDragOver ? 'is-drag-over' : ''}`}
      draggable={!isPreview && !isTouchDevice}
      onDragStart={(e) => !isPreview && !isTouchDevice && onDragStart?.(e, account)}
      onDragOver={(e) => !isPreview && !isTouchDevice && onDragOver?.(e, account)}
      onDragLeave={(e) => !isPreview && !isTouchDevice && onDragLeave?.(e, account)}
      onDrop={(e) => !isPreview && !isTouchDevice && onDrop?.(e, account)}
      onDragEnd={!isPreview && !isTouchDevice ? onDragEnd : undefined}
    >
      <div className="card-gloss-shimmer" />

      <CardDragToolbar
        account={account}
        index={index}
        totalShown={totalShown}
        onMoveStep={onMoveStep}
        isPreview={isPreview}
      />

      {/* PromptPay Header */}
      <div className="promptpay-header">
        <div className="promptpay-brand">
          <div className="promptpay-logo-badge">
            <Icon name="promptpay" />
          </div>
          <div className="promptpay-titles">
            <span className="promptpay-name">พร้อมเพย์ • PROMPTPAY</span>
            <span className="promptpay-tagline">ระบบรับ-โอนเงินทันที ทุกธนาคาร</span>
          </div>
        </div>
        <span className="promptpay-free-tag">โอนฟรี 24 ชม.</span>
      </div>

      {/* PromptPay Center: ID Box + Stylized QR Badge */}
      <div className="promptpay-center-grid">
        <div className="promptpay-id-block">
          <span className="promptpay-label">
            {isNationalId ? 'เลขประจำตัวประชาชน (NATIONAL ID)' : 'เบอร์โทรศัพท์พร้อมเพย์ (MOBILE NO.)'}
          </span>
          <div
            className="virtual-card-number-box promptpay-number-box"
            onClick={() => onCopyNumber(account)}
            title="คลิกเพื่อคัดลอกเบอร์พร้อมเพย์"
            role="button"
            tabIndex={0}
          >
            <span className="virtual-card-number promptpay-number">{formattedNumber || '08X-XXX-XXXX'}</span>
            <button
              type="button"
              className={`card-quick-copy-pill ${isCopiedNum ? 'copied' : ''}`}
              onClick={(e) => { e.stopPropagation(); onCopyNumber(account); }}
              title={isCopiedNum ? 'คัดลอกแล้ว' : 'คัดลอกเบอร์พร้อมเพย์'}
            >
              <Icon name={isCopiedNum ? 'check' : 'copy'} />
            </button>
          </div>

          <div className="promptpay-payee-info">
            <span className="promptpay-payee-label">ชื่อบัญชีรับเงิน (PAYEE):</span>
            <strong className="promptpay-payee-name">{account.accName || 'NATTANONT VONGKASAI'}</strong>
            {account.label && <span className="promptpay-note">({account.label})</span>}
          </div>
        </div>

        {/* QR Badge */}
        <div className="promptpay-qr-badge" title="สแกนโอนผ่านแอปธนาคารทุกแห่ง">
          <div className="promptpay-qr-inner">
            <Icon name="qr" />
            <span className="promptpay-qr-text">SCAN ME</span>
          </div>
        </div>
      </div>

      {/* PromptPay Footer */}
      <div className="promptpay-footer">
        <div className="promptpay-status">
          <span className="promptpay-status-dot" />
          <span>ANY ID • พร้อมรับเงินตลอด 24 ชั่วโมง</span>
        </div>

        <div className="card-actions-row">
          <button
            type="button"
            className={`card-glass-btn share-btn ${isCopiedAll ? 'copied' : ''}`}
            onClick={() => onCopyAll(account)}
            title="คัดลอกข้อมูลพร้อมเพย์สำหรับส่งต่อ"
          >
            <Icon name={isCopiedAll ? 'check' : 'copy'} />
            <span>{isCopiedAll ? 'คัดลอกครบแล้ว' : 'ส่งต่อ'}</span>
          </button>
          <button
            type="button"
            className="card-glass-btn edit-btn"
            onClick={() => onEdit(account)}
            title="แก้ไขพร้อมเพย์"
          >
            <Icon name="edit" />
          </button>
          <button
            type="button"
            className="card-glass-btn delete-btn"
            onClick={() => onDelete(account.id)}
            title="ลบพร้อมเพย์"
          >
            <Icon name="trash" />
          </button>
        </div>
      </div>
    </div>
  )
})

// ── Unified VirtualCard Dispatcher ──
const VirtualCard = memo(function VirtualCard({
  account,
  onCopyNumber,
  onCopyCvv,
  onCopyAll,
  onEdit,
  onDelete,
  copiedField,
  index = 0,
  totalShown = 1,
  isDragging = false,
  isDragOver = false,
  onDragStart,
  onDragOver,
  onDragLeave,
  onDrop,
  onDragEnd,
  onMoveStep,
  isPreview = false,
}) {
  const [showCvv, setShowCvv] = useState(false)
  const preset = BANK_PRESETS.find(b => b.id === account.bank) || BANK_PRESETS[0]
  const formattedNumber = formatAccNumber(account.accNumber, account.type)
  const isCopiedNum = copiedField === `${account.id}-num`
  const isCopiedCvv = copiedField === `${account.id}-cvv`
  const isCopiedAll = copiedField === `${account.id}-all`
  const expiryText = account.expiry || '12/29'
  const cvvText = account.cvv || '888'

  const commonProps = {
    account,
    preset,
    formattedNumber,
    isCopiedNum,
    isCopiedAll,
    onCopyNumber,
    onCopyAll,
    onEdit,
    onDelete,
    index,
    totalShown,
    isDragging,
    isDragOver,
    onDragStart,
    onDragOver,
    onDragLeave,
    onDrop,
    onDragEnd,
    onMoveStep,
    isPreview,
  }

  if (account.type === 'promptpay') {
    return <PromptPayCard {...commonProps} />
  }

  if (account.type === 'card') {
    return (
      <CreditDebitCard
        {...commonProps}
        isCopiedCvv={isCopiedCvv}
        onCopyCvv={onCopyCvv}
        expiryText={expiryText}
        cvvText={cvvText}
        showCvv={showCvv}
        setShowCvv={setShowCvv}
      />
    )
  }

  // Default: Bank Passbook
  return <BankPassbookCard {...commonProps} />
})

const ACCOUNT_DRAFT_KEY = 'mix-image-prompt-vault.account-modal-draft.v1'
const SAVINGS_TXN_DRAFT_KEY = 'mix-image-prompt-vault.savings-txn-draft.v1'

function AccountModal({ account, onClose, onSave }) {
  const isEditing = Boolean(account?.id)
  const [form, setForm] = useState(() => {
    const base = {
      type: account?.type || 'bank',
      bank: account?.bank || 'kbank',
      bankName: account?.bankName || 'ธนาคารกสิกรไทย',
      bankCode: account?.bankCode || 'KBANK',
      accNumber: account?.accNumber || '',
      accName: account?.accName || 'NATTANONT VONGKASAI',
      label: account?.label || '',
      color: account?.color || 'kbank',
      expiry: account?.expiry || '12/29',
      cvv: account?.cvv || '888',
    }
    if (!isEditing) {
      try {
        const saved = sessionStorage.getItem(ACCOUNT_DRAFT_KEY)
        if (saved) {
          const parsed = JSON.parse(saved)
          if (parsed && typeof parsed === 'object') {
            return { ...base, ...parsed }
          }
        }
      } catch {
        // ignore
      }
    }
    return base
  })

  useEffect(() => {
    if (isEditing) return
    try {
      sessionStorage.setItem(ACCOUNT_DRAFT_KEY, JSON.stringify(form))
    } catch {
      // ignore
    }
  }, [form, isEditing])

  const clearDraftAndClose = () => {
    if (!isEditing) {
      try {
        sessionStorage.removeItem(ACCOUNT_DRAFT_KEY)
      } catch {
        // ignore
      }
    }
    onClose()
  }

  const handleTypeChange = (newType) => {
    setForm(prev => {
      let newBank = prev.bank
      let newBankName = prev.bankName
      let newBankCode = prev.bankCode
      let newColor = prev.color

      if (newType === 'promptpay') {
        const p = BANK_PRESETS.find(b => b.id === 'promptpay') || { id: 'promptpay', name: 'พร้อมเพย์ (PromptPay)', code: 'PROMPT', color: 'promptpay' }
        newBank = p.id
        newBankName = p.name
        newBankCode = p.code
        newColor = p.color
      } else if (newType === 'card' && prev.bank === 'promptpay') {
        const c = BANK_PRESETS.find(b => b.id === 'card') || { id: 'card', name: 'บัตรเครดิต / เดบิต', code: 'CARD', color: 'card' }
        newBank = c.id
        newBankName = c.name
        newBankCode = c.code
        newColor = c.color
      } else if (newType === 'bank' && (prev.bank === 'promptpay' || prev.bank === 'card')) {
        const k = BANK_PRESETS.find(b => b.id === 'kbank') || { id: 'kbank', name: 'ธนาคารกสิกรไทย', code: 'KBANK', color: 'kbank' }
        newBank = k.id
        newBankName = k.name
        newBankCode = k.code
        newColor = k.color
      }

      return {
        ...prev,
        type: newType,
        bank: newBank,
        bankName: newBankName,
        bankCode: newBankCode,
        color: newColor,
      }
    })
  }

  const handleBankChange = (bankId) => {
    const preset = BANK_PRESETS.find(b => b.id === bankId)
    if (preset) {
      setForm(prev => ({
        ...prev,
        bank: preset.id,
        bankName: preset.name,
        bankCode: preset.code,
        color: preset.color,
      }))
    }
  }

  const handleExpiryChange = (e) => {
    let val = e.target.value.replace(/[^\d/]/g, '')
    if (val.length === 2 && !val.includes('/') && form.expiry.length < 2) {
      val = val + '/'
    }
    if (val.length > 5) val = val.slice(0, 5)
    setForm(f => ({ ...f, expiry: val }))
  }

  const handleCvvChange = (e) => {
    const val = e.target.value.replace(/\D/g, '').slice(0, 4)
    setForm(f => ({ ...f, cvv: val }))
  }

  const handleSubmit = (e) => {
    e.preventDefault()
    if (!form.accNumber.trim()) return
    if (!isEditing) {
      try {
        sessionStorage.removeItem(ACCOUNT_DRAFT_KEY)
      } catch {
        // ignore
      }
    }
    onSave({
      ...account,
      ...form,
      accNumber: form.accNumber.trim(),
      accName: form.accName.trim() || 'NATTANONT VONGKASAI',
      label: form.label.trim(),
      expiry: form.expiry.trim() || '12/29',
      cvv: form.cvv.trim() || '888',
    })
  }

  const preset = BANK_PRESETS.find(b => b.id === form.bank) || BANK_PRESETS[0]

  return (
    <div className="account-modal-overlay">
      <div className="account-modal-card glass-panel" onClick={e => e.stopPropagation()}>
        <div className="modal-header-row">
          <h3>
            <Icon name={form.type === 'bank' ? 'book' : form.type === 'promptpay' ? 'promptpay' : 'card'} />
            {account?.id ? 'แก้ไขข้อมูล' : 'เพิ่มบัญชี / บัตร / พร้อมเพย์'}
          </h3>
          <button type="button" className="modal-close-btn" onClick={clearDraftAndClose} title="ยกเลิกและปิดหน้าต่าง">
            <Icon name="close" />
          </button>
        </div>

        {/* Live Preview of Specific Card Type */}
        <div className="modal-live-preview">
          <VirtualCard
            account={{
              ...form,
              id: 'preview',
              bankName: form.bankName || preset.name,
              bankCode: form.bankCode || preset.code,
              expiry: form.expiry || '12/29',
              cvv: form.cvv || '888'
            }}
            isPreview={true}
            onCopyNumber={() => {}}
            onCopyCvv={() => {}}
            onCopyAll={() => {}}
            onEdit={() => {}}
            onDelete={() => {}}
            copiedField={null}
          />
        </div>

        <form onSubmit={handleSubmit} className="account-form-body">
          <div className="account-form-grid">
            <div className="form-group">
              <label>รูปแบบการ์ดที่ต้องการบันทึก</label>
              <select
                value={form.type}
                onChange={e => handleTypeChange(e.target.value)}
                className="account-select"
              >
                <option value="bank">📖 สมุดบัญชีเงินฝาก (Passbook)</option>
                <option value="card">💳 บัตรเครดิต / เดบิตเสมือน (Virtual Card)</option>
                <option value="promptpay">⚡ พร้อมเพย์ (PromptPay)</option>
              </select>
            </div>

            {form.type !== 'promptpay' && (
              <div className="form-group">
                <label>สถาบันการเงิน / ธนาคาร</label>
                <select
                  value={form.bank}
                  onChange={e => handleBankChange(e.target.value)}
                  className="account-select"
                >
                  {BANK_PRESETS.filter(b => b.id !== 'promptpay').map(b => (
                    <option key={b.id} value={b.id}>{b.name} ({b.code})</option>
                  ))}
                </select>
              </div>
            )}

            <div className={`form-group ${form.type === 'promptpay' ? '' : 'full-width'}`}>
              <label>
                {form.type === 'bank'
                  ? 'เลขที่บัญชีธนาคาร (10-12 หลัก)'
                  : form.type === 'promptpay'
                  ? 'เบอร์มือถือ หรือ เลขบัตรประชาชน'
                  : 'เลขหน้าบัตร 16 หลัก'}
              </label>
              <input
                type="text"
                required
                placeholder={
                  form.type === 'bank'
                    ? 'เช่น 199-8-81994-2'
                    : form.type === 'promptpay'
                    ? 'เช่น 089-123-4567 หรือ 1-1234-56789-01-2'
                    : 'เช่น 4532 8901 2345 6789'
                }
                value={form.accNumber}
                onChange={e => setForm(f => ({ ...f, accNumber: e.target.value }))}
                className="account-input mono"
              />
            </div>

            {form.type === 'card' && (
              <>
                <div className="form-group">
                  <label>วันหมดอายุ (EXP: MM/YY)</label>
                  <input
                    type="text"
                    placeholder="เช่น 12/29"
                    maxLength={5}
                    value={form.expiry}
                    onChange={handleExpiryChange}
                    className="account-input mono"
                  />
                </div>

                <div className="form-group">
                  <label>รหัสความปลอดภัย (CVV / CVC 3-4 ตัว)</label>
                  <input
                    type="text"
                    placeholder="เช่น 888 หรือ 123"
                    maxLength={4}
                    value={form.cvv}
                    onChange={handleCvvChange}
                    className="account-input mono"
                  />
                </div>
              </>
            )}

            <div className="form-group">
              <label>
                {form.type === 'promptpay'
                  ? 'ชื่อ-นามสกุล ผู้รับเงิน'
                  : form.type === 'card'
                  ? 'ชื่อบนหน้าบัตร'
                  : 'ชื่อเจ้าของบัญชี'}
              </label>
              <input
                type="text"
                placeholder="เช่น NATTANONT VONGKASAI"
                value={form.accName}
                onChange={e => setForm(f => ({ ...f, accName: e.target.value }))}
                className="account-input"
              />
            </div>

            <div className="form-group">
              <label>
                {form.type === 'bank'
                  ? 'สาขาธนาคาร / บันทึก (เช่น สำนักงานใหญ่)'
                  : 'บันทึกช่วยจำ (ไม่จำเป็น)'}
              </label>
              <input
                type="text"
                placeholder={
                  form.type === 'bank'
                    ? 'เช่น สาขาหลัก, บัญชีรับเงินร้าน'
                    : 'เช่น บัญชีส่วนตัว, บัญชีออม'
                }
                value={form.label}
                onChange={e => setForm(f => ({ ...f, label: e.target.value }))}
                className="account-input"
              />
            </div>
          </div>

          <div className="modal-actions-row">
            <button type="button" className="btn-cancel" onClick={clearDraftAndClose}>
              ยกเลิก
            </button>
            <button type="submit" className="primary-button btn-save" disabled={!form.accNumber.trim()}>
              <Icon name="check" /> บันทึกบัญชีเสมือน
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

function SavingsPage({ flash }) {
  const [txns, setTxns] = useState([])
  const [accounts, setAccounts] = useState([])
  const [form, setForm] = useState(() => {
    const base = { type: 'income', amount: '', label: '', date: new Date().toISOString().slice(0, 10) }
    try {
      const saved = sessionStorage.getItem(SAVINGS_TXN_DRAFT_KEY)
      if (saved) {
        const parsed = JSON.parse(saved)
        if (parsed && typeof parsed === 'object') return { ...base, ...parsed }
      }
    } catch {
      // ignore
    }
    return base
  })
  const [cloudSync, setCloudSync] = useState('loading')
  const [filterMonth, setFilterMonth] = useState(() => {
    const now = new Date()
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
  })
  const [editingAccount, setEditingAccount] = useState(null)
  const [showAccountModal, setShowAccountModal] = useState(false)
  const [copiedField, setCopiedField] = useState(null)
  const [accountTypeFilter, setAccountTypeFilter] = useState('all') // 'all' | 'bank' | 'card' | 'promptpay'
  const [draggedAccId, setDraggedAccId] = useState(null)
  const [dragOverAccId, setDragOverAccId] = useState(null)
  const [dragOverTypeTab, setDragOverTypeTab] = useState(null)
  const hasLoadedRef = useRef(false)

  // บันทึกร่างฟอร์มรายรับ/รายจ่ายอัตโนมัติ
  useEffect(() => {
    try {
      sessionStorage.setItem(SAVINGS_TXN_DRAFT_KEY, JSON.stringify(form))
    } catch {
      // ignore
    }
  }, [form])

  // ── โหลดข้อมูลรายรับรายจ่าย & บัญชีธนาคาร ──
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const [cloudTxns, cloudAccs] = await Promise.all([
          loadCloudSavings().catch(() => readLocalSavings()),
          loadCloudAccounts().catch(() => readLocalAccounts()),
        ])
        if (!cancelled) {
          setTxns(cloudTxns || [])
          writeLocalSavings(cloudTxns || [])
          setAccounts(cloudAccs || [])
          writeLocalAccounts(cloudAccs || [])
          hasLoadedRef.current = true
          setCloudSync('cloud')
        }
      } catch {
        if (!cancelled) {
          setTxns(readLocalSavings())
          setAccounts(readLocalAccounts())
          hasLoadedRef.current = true
          setCloudSync('local')
        }
      }
    })()
    return () => { cancelled = true }
  }, [])

  // ── บันทึกลง local ทุกครั้งที่ txns หรือ accounts เปลี่ยน ──
  useEffect(() => {
    if (hasLoadedRef.current) writeLocalSavings(txns)
  }, [txns])

  useEffect(() => {
    if (hasLoadedRef.current) writeLocalAccounts(accounts)
  }, [accounts])

  // ── ระบบตัดยอดอัตโนมัติเมื่อข้ามวัน (00:00) ──
  useEffect(() => {
    const checkMidnight = () => {
      const today = new Date().toISOString().slice(0, 10)
      const lastCutoff = localStorage.getItem('savings-last-cutoff')
      if (lastCutoff === today) return
      const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10)
      const yesterdayTxns = txns.filter(t => t.date === yesterday)
      if (yesterdayTxns.length > 0) {
        const income = yesterdayTxns.filter(t => t.type === 'income').reduce((s, t) => s + t.amount, 0)
        const expense = yesterdayTxns.filter(t => t.type === 'expense').reduce((s, t) => s + t.amount, 0)
        const dailyNet = income - expense
        if (dailyNet !== 0) {
          const cutoffTxn = {
            id: `cutoff-${yesterday}`,
            type: dailyNet >= 0 ? 'income' : 'expense',
            amount: Math.abs(dailyNet),
            label: `ยอดรวมวันที่ ${yesterday} (ตัดยอดอัตโนมัติ)`,
            date: yesterday,
            createdAt: new Date().toISOString(),
            isCutoff: true,
          }
          setTxns(prev => {
            if (prev.some(t => t.id === cutoffTxn.id)) return prev
            return [...prev, cutoffTxn]
          })
        }
      }
      localStorage.setItem('savings-last-cutoff', today)
    }

    checkMidnight()
    const timer = setInterval(checkMidnight, 60000)
    return () => clearInterval(timer)
  }, [txns])

  // ── เพิ่มรายการรายรับ/รายจ่าย ──
  const addTxn = async () => {
    const amt = parseFloat(form.amount)
    if (!amt || amt <= 0) return
    const newTxn = {
      id: `local-${Date.now()}`,
      type: form.type,
      amount: amt,
      label: form.label.trim() || (form.type === 'income' ? 'รายรับ' : 'รายจ่าย'),
      date: form.date,
      createdAt: new Date().toISOString(),
    }
    setTxns(prev => [...prev, newTxn])
    setForm({ type: 'income', amount: '', label: '', date: new Date().toISOString().slice(0, 10) })
    try {
      sessionStorage.removeItem(SAVINGS_TXN_DRAFT_KEY)
    } catch {
      // ignore
    }
    flash('บันทึกสำเร็จ ✓')

    try {
      const cloudId = await saveCloudSavingsTxn(newTxn)
      setTxns(prev => prev.map(t => t.id === newTxn.id ? { ...t, id: cloudId } : t))
    } catch {
      // keep local only
    }
  }

  // ── ลบรายการ ──
  const deleteTxn = async (id) => {
    setTxns(prev => prev.filter(t => t.id !== id))
    flash('ลบรายการแล้ว')
    try {
      await deleteCloudSavingsTxn(id)
    } catch {
      // ignore
    }
  }

  // ── จัดการบัญชีธนาคาร & การ์ดเสมือน ──
  const handleSaveAccount = async (accData) => {
    setShowAccountModal(false)
    setEditingAccount(null)

    const isExisting = Boolean(accData.id && accounts.some((a) => a.id === accData.id))

    if (isExisting) {
      // Edit existing (รวมถึง kbank-main หรือ local-* ไม่ให้สร้างซ้ำ)
      setAccounts(prev => prev.map(a => a.id === accData.id ? { ...a, ...accData } : a))
      flash('บันทึกการแก้ไขแล้ว ✓')
      try {
        if (String(accData.id).startsWith('local-') || accData.id === 'kbank-main') {
          const cloudId = await saveCloudAccount(accData)
          setAccounts(prev => prev.map(a => a.id === accData.id ? { ...a, ...accData, id: cloudId } : a))
        } else {
          await updateCloudAccount(accData)
        }
      } catch {
        // ignore
      }
    } else {
      // Create new
      const newAcc = {
        ...accData,
        id: `local-${Date.now()}`,
        sortOrder: accounts.length,
        createdAt: new Date().toISOString(),
      }
      setAccounts(prev => [...prev, newAcc])
      flash('เพิ่มบัญชีเสมือนเรียบร้อย ✓')
      try {
        const cloudId = await saveCloudAccount(newAcc)
        setAccounts(prev => prev.map(a => a.id === newAcc.id ? { ...a, id: cloudId } : a))
      } catch {
        // keep local only
      }
    }
  }

  const handleDeleteAccount = async (id) => {
    if (!window.confirm('ต้องการลบบัญชี/บัตรเสมือนนี้ใช่หรือไม่?')) return
    setAccounts(prev => prev.filter(a => a.id !== id))
    flash('ลบบัญชีแล้ว')
    try {
      await deleteCloudAccount(id)
    } catch {
      // ignore
    }
  }

  // ── Drag & Drop ย้ายลำดับการ์ดสมุดบัญชี / การ์ด / พร้อมเพย์ ──
  const reorderAccounts = (sourceId, targetId) => {
    if (!sourceId || !targetId || sourceId === targetId) return
    setAccounts((prev) => {
      const fromIndex = prev.findIndex((a) => a.id === sourceId)
      const toIndex = prev.findIndex((a) => a.id === targetId)
      if (fromIndex === -1 || toIndex === -1) return prev
      const next = [...prev]
      const [moved] = next.splice(fromIndex, 1)
      next.splice(toIndex, 0, moved)
      const withOrder = next.map((acc, idx) => ({ ...acc, sortOrder: idx }))
      writeLocalAccounts(withOrder)
      updateCloudAccountOrder(withOrder)
      return withOrder
    })
  }

  const handleAccDragStart = (e, acc) => {
    setDraggedAccId(acc.id)
    try {
      e.dataTransfer.effectAllowed = 'move'
      e.dataTransfer.setData('text/plain', acc.id)
    } catch {
      // ignore
    }
  }

  const handleAccDragOver = (e, acc) => {
    e.preventDefault()
    if (draggedAccId && draggedAccId !== acc.id && dragOverAccId !== acc.id) {
      setDragOverAccId(acc.id)
    }
  }

  const handleAccDragLeave = (e, acc) => {
    if (dragOverAccId === acc.id) {
      setDragOverAccId(null)
    }
  }

  const handleAccDrop = (e, targetAcc) => {
    e.preventDefault()
    const sourceId = draggedAccId || e.dataTransfer?.getData('text/plain')
    setDraggedAccId(null)
    setDragOverAccId(null)
    if (sourceId && targetAcc?.id && sourceId !== targetAcc.id) {
      reorderAccounts(sourceId, targetAcc.id)
      flash('ย้ายตำแหน่งการ์ดเรียบร้อย ✓')
    }
  }

  const handleAccDragEnd = () => {
    setDraggedAccId(null)
    setDragOverAccId(null)
    setDragOverTypeTab(null)
  }

  const moveAccStep = (acc, direction) => {
    const visibleList =
      accountTypeFilter === 'all'
        ? accounts
        : accounts.filter((a) => (a.type || 'bank') === accountTypeFilter)
    const idx = visibleList.findIndex((a) => a.id === acc.id)
    const target = visibleList[idx + direction]
    if (!target) return
    reorderAccounts(acc.id, target.id)
  }

  // ลากการ์ดไปวางทับแท็ก สมุดบัญชี / การ์ด / พร้อมเพย์ เพื่อเปลี่ยนประเภททันที
  const handleTypeTabDrop = async (e, targetType) => {
    e.preventDefault()
    const sourceId = draggedAccId || e.dataTransfer?.getData('text/plain')
    setDraggedAccId(null)
    setDragOverAccId(null)
    setDragOverTypeTab(null)
    if (!sourceId || targetType === 'all') return
    const targetAcc = accounts.find((a) => a.id === sourceId)
    if (!targetAcc || targetAcc.type === targetType) return

    let updated = { ...targetAcc, type: targetType }
    if (targetType === 'promptpay') {
      const p = BANK_PRESETS.find((b) => b.id === 'promptpay')
      if (p) {
        updated = { ...updated, bank: p.id, bankName: p.name, bankCode: p.code, color: p.color }
      }
    } else if (targetType === 'card' && targetAcc.bank === 'promptpay') {
      const c = BANK_PRESETS.find((b) => b.id === 'card')
      if (c) {
        updated = { ...updated, bank: c.id, bankName: c.name, bankCode: c.code, color: c.color }
      }
    } else if (targetType === 'bank' && (targetAcc.bank === 'promptpay' || targetAcc.bank === 'card')) {
      const k = BANK_PRESETS.find((b) => b.id === 'kbank')
      if (k) {
        updated = { ...updated, bank: k.id, bankName: k.name, bankCode: k.code, color: k.color }
      }
    }

    setAccounts((prev) => prev.map((a) => (a.id === sourceId ? updated : a)))
    const tabInfo = ACCOUNT_TYPE_TABS.find((t) => t.id === targetType)
    flash(`ย้ายไปหมวด "${tabInfo?.label || targetType}" แล้ว ✓`)
    try {
      await updateCloudAccount(updated)
    } catch {
      // ignore
    }
  }

  const handleCopyNumber = async (acc) => {
    const clean = String(acc.accNumber).replace(/\D/g, '') || acc.accNumber
    await safeCopyText(clean)
    setCopiedField(`${acc.id}-num`)
    flash(`คัดลอกเลข ${acc.accNumber} แล้ว ✓`)
    setTimeout(() => setCopiedField(null), 2000)
  }

  const handleCopyCvv = async (acc) => {
    const cvv = acc.cvv || '888'
    await safeCopyText(cvv)
    setCopiedField(`${acc.id}-cvv`)
    flash(`คัดลอกรหัส CVV (${cvv}) แล้ว ✓`)
    setTimeout(() => setCopiedField(null), 2000)
  }

  const handleCopyAll = async (acc) => {
    let text = ''
    if (acc.type === 'promptpay') {
      text = `พร้อมเพย์ (PromptPay)\nเบอร์/เลขบัตร: ${formatAccNumber(acc.accNumber, 'promptpay')}\nชื่อผู้รับเงิน: ${acc.accName}${acc.label ? `\n(${acc.label})` : ''}`
    } else if (acc.type === 'card') {
      text = `${acc.bankName || 'บัตรเครดิต/เดบิต'}\nเลขบัตร: ${formatAccNumber(acc.accNumber, 'card')}\nชื่อบนบัตร: ${acc.accName}${acc.expiry ? `\nวันหมดอายุ (EXP): ${acc.expiry}` : ''}${acc.cvv ? `\nCVV: ${acc.cvv}` : ''}${acc.label ? `\n(${acc.label})` : ''}`
    } else {
      // bank passbook
      text = `${acc.bankName || acc.bankCode} (สมุดบัญชีเงินฝาก)\nเลขที่บัญชี: ${formatAccNumber(acc.accNumber, 'bank')}\nชื่อบัญชี: ${acc.accName}${acc.label ? `\n(${acc.label})` : ''}`
    }
    await safeCopyText(text)
    setCopiedField(`${acc.id}-all`)
    flash('คัดลอกข้อมูลเรียบร้อยแล้ว ✓')
    setTimeout(() => setCopiedField(null), 2000)
  }

  // ── คำนวณยอด ──
  const totalIncome = txns.filter(t => t.type === 'income' && !t.isCutoff).reduce((s, t) => s + t.amount, 0)
  const totalExpense = txns.filter(t => t.type === 'expense' && !t.isCutoff).reduce((s, t) => s + t.amount, 0)
  const totalSavings = totalIncome - totalExpense

  // ── กรองตามเดือน ──
  const monthTxns = txns.filter(t => t.date?.startsWith(filterMonth)).sort((a, b) => b.createdAt?.localeCompare(a.createdAt) || 0)
  const monthIncome = monthTxns.filter(t => t.type === 'income').reduce((s, t) => s + t.amount, 0)
  const monthExpense = monthTxns.filter(t => t.type === 'expense').reduce((s, t) => s + t.amount, 0)

  // ── รายการเดือน ──
  const allMonths = useMemo(() => {
    const months = new Set()
    txns.forEach(t => { if (t.date) months.add(t.date.slice(0, 7)) })
    const now = new Date()
    months.add(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`)
    return [...months].sort().reverse()
  }, [txns])

  const fmt = (n) => n.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  const thaiMonth = (ym) => {
    const [y, m] = ym.split('-')
    const months = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.']
    return `${months[parseInt(m, 10) - 1]} ${parseInt(y, 10) + 543}`
  }

  return (
    <section className="savings-page">
      {/* ── แถวบน: ซ้ายเป็น ยอดเงินออมรวม & ฟอร์มบันทึก / ขวาเป็น ประวัติการเงิน ── */}
      <div className="savings-top-grid">
        <div className="savings-left-col">
          {/* 1. บัตรยอดเงินออม */}
          <div className="savings-hero glass-panel">
            <div className="savings-hero-top">
              <div className="savings-hero-icon-box">
                <Icon name="wallet" />
              </div>
              <div className="savings-hero-label">
                <span className="eyebrow">SAVINGS ACCOUNT</span>
                <h2>เงินออมรวม</h2>
              </div>
              <span className={`savings-sync-badge ${cloudSync}`}>
                <Icon name="cloud" /> {cloudSync === 'cloud' ? 'Cloud Sync' : cloudSync === 'loading' ? 'กำลังโหลด...' : 'ข้อมูลในเครื่อง'}
              </span>
            </div>
            <div className={`savings-hero-amount ${totalSavings < 0 ? 'negative' : ''}`}>
              ฿{fmt(totalSavings)}
            </div>
            <div className="savings-hero-stats">
              <div className="savings-stat income">
                <Icon name="trending-up" />
                <div>
                  <span>รายรับรวม</span>
                  <strong>฿{fmt(totalIncome)}</strong>
                </div>
              </div>
              <div className="savings-stat expense">
                <Icon name="trending-down" />
                <div>
                  <span>รายจ่ายรวม</span>
                  <strong>฿{fmt(totalExpense)}</strong>
                </div>
              </div>
            </div>
          </div>

          {/* 2. ฟอร์มเพิ่มรายการ */}
          <div className="savings-form-card glass-panel">
            <h3><Icon name="add" /> เพิ่มรายการ</h3>
            <div className="savings-type-toggle">
              <button
                type="button"
                className={`type-btn income ${form.type === 'income' ? 'active' : ''}`}
                onClick={() => setForm(f => ({ ...f, type: 'income' }))}
              >
                <Icon name="plus-circle" /> รายรับ
              </button>
              <button
                type="button"
                className={`type-btn expense ${form.type === 'expense' ? 'active' : ''}`}
                onClick={() => setForm(f => ({ ...f, type: 'expense' }))}
              >
                <Icon name="minus-circle" /> รายจ่าย
              </button>
            </div>
            <div className="savings-form-fields">
              <div className="savings-field">
                <label>จำนวนเงิน (บาท)</label>
                <input
                  type="number"
                  inputMode="decimal"
                  step="0.01"
                  min="0"
                  placeholder="0.00"
                  value={form.amount}
                  onChange={e => setForm(f => ({ ...f, amount: e.target.value }))}
                  className="savings-amount-input"
                />
              </div>
              <div className="savings-field">
                <label>รายละเอียด (ไม่จำเป็น)</label>
                <input
                  type="text"
                  placeholder={form.type === 'income' ? 'เช่น ค่าจ้าง, รางวัล' : 'เช่น ค่าอาหาร, ค่ารถ'}
                  value={form.label}
                  onChange={e => setForm(f => ({ ...f, label: e.target.value }))}
                  className="savings-label-input"
                />
              </div>
              <div className="savings-field">
                <label>วันที่</label>
                <input
                  type="date"
                  value={form.date}
                  onChange={e => setForm(f => ({ ...f, date: e.target.value }))}
                  className="savings-date-input"
                />
              </div>
            </div>
            <button
              type="button"
              className={`savings-submit-btn ${form.type}`}
              onClick={addTxn}
              disabled={!form.amount || parseFloat(form.amount) <= 0}
            >
              <Icon name="check" /> บันทึก{form.type === 'income' ? 'รายรับ' : 'รายจ่าย'}
            </button>
          </div>
        </div>

        {/* 3. ประวัติการเงิน (ย้ายขึ้นมาพื้นที่ว่างด้านขวา) */}
        <div className="savings-right-col">
          <div className="savings-history-card glass-panel">
            <div className="savings-history-header">
              <h3><Icon name="calendar" /> ประวัติการเงิน</h3>
              <select
                value={filterMonth}
                onChange={e => setFilterMonth(e.target.value)}
                className="savings-month-select"
              >
                {allMonths.map(m => (
                  <option key={m} value={m}>{thaiMonth(m)}</option>
                ))}
              </select>
            </div>

            <div className="savings-month-summary">
              <div className="month-stat income">
                <span>รายรับ</span>
                <strong className="income-text">+฿{fmt(monthIncome)}</strong>
              </div>
              <div className="month-stat expense">
                <span>รายจ่าย</span>
                <strong className="expense-text">-฿{fmt(monthExpense)}</strong>
              </div>
              <div className="month-stat net">
                <span>คงเหลือ</span>
                <strong className={monthIncome - monthExpense >= 0 ? 'income-text' : 'expense-text'}>
                  ฿{fmt(monthIncome - monthExpense)}
                </strong>
              </div>
            </div>

            <div className="savings-history-list-header">
              <span>รายการทั้งหมด ({monthTxns.length})</span>
            </div>

            <div className="savings-txn-list">
              {monthTxns.length === 0 && (
                <p className="savings-empty">ยังไม่มีรายการในเดือนนี้</p>
              )}
              {monthTxns.map(txn => (
                <div key={txn.id} className={`savings-txn-row ${txn.type} ${txn.isCutoff ? 'cutoff' : ''}`}>
                  <div className="txn-icon-box">
                    <Icon name={txn.type === 'income' ? 'plus-circle' : 'minus-circle'} />
                  </div>
                  <div className="txn-info">
                    <strong>{txn.label || (txn.type === 'income' ? 'รายรับ' : 'รายจ่าย')}</strong>
                    <span className="txn-date">{txn.date}</span>
                  </div>
                  <span className={`txn-amount ${txn.type}`}>
                    {txn.type === 'income' ? '+' : '-'}฿{fmt(txn.amount)}
                  </span>
                  {!txn.isCutoff && (
                    <button
                      type="button"
                      className="txn-delete-btn"
                      onClick={() => deleteTxn(txn.id)}
                      title="ลบรายการนี้"
                    >
                      <Icon name="trash" />
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* ── แถวล่าง: บัญชีธนาคารและการ์ดเสมือน (Glassmorphism Virtual Cards) ── */}
      <div className="savings-accounts-section glass-panel">
        <div className="accounts-section-header">
          <div>
            <span className="eyebrow">VIRTUAL CARDS &amp; ACCOUNTS • DRAG &amp; DROP REORDER</span>
            <h2>
              <Icon name="card" /> บัญชีธนาคาร / การ์ด / พร้อมเพย์
              <span className="count-tag">({accounts.length})</span>
            </h2>
            <p className="section-subtext">
              คลิกค้างเพื่อลากย้ายสลับตำแหน่งได้อิสระ • แยกแท็กสมุดบัญชี การ์ด และพร้อมเพย์ชัดเจน
            </p>
          </div>
          <button
            type="button"
            className="primary-button add-account-btn"
            onClick={() => {
              const initialType = accountTypeFilter === 'all' ? 'bank' : accountTypeFilter
              const presetForType =
                initialType === 'promptpay'
                  ? BANK_PRESETS.find((b) => b.id === 'promptpay')
                  : initialType === 'card'
                  ? BANK_PRESETS.find((b) => b.id === 'kbank')
                  : BANK_PRESETS.find((b) => b.id === 'kbank')
              setEditingAccount({
                type: initialType,
                bank: presetForType?.id || 'kbank',
                bankName: presetForType?.name || 'ธนาคารกสิกรไทย',
                bankCode: presetForType?.code || 'KBANK',
                accNumber: '',
                accName: 'NATTANONT VONGKASAI',
                label: '',
                color: presetForType?.color || 'kbank',
                expiry: '12/29',
                cvv: '888',
              })
              setShowAccountModal(true)
            }}
          >
            <Icon name="add" /> เพิ่มสมุด / การ์ด / พร้อมเพย์
          </button>
        </div>

        {/* ── แถบแยกแท็ก: ทั้งหมด / สมุดบัญชี / การ์ด / พร้อมเพย์ ── */}
        <div className="account-filter-tabs" role="tablist" aria-label="กรองตามประเภทบัญชีและการ์ด">
          {ACCOUNT_TYPE_TABS.map((tab) => {
            const count =
              tab.id === 'all'
                ? accounts.length
                : accounts.filter((a) => (a.type || 'bank') === tab.id).length
            const isActive = accountTypeFilter === tab.id
            const isDropTarget = dragOverTypeTab === tab.id && tab.id !== 'all'
            return (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={isActive}
                className={`account-tab-pill tab-${tab.id} ${isActive ? 'active' : ''} ${isDropTarget ? 'drop-over' : ''}`}
                onClick={() => setAccountTypeFilter(tab.id)}
                onDragOver={(e) => {
                  if (tab.id === 'all') return
                  e.preventDefault()
                  if (dragOverTypeTab !== tab.id) setDragOverTypeTab(tab.id)
                }}
                onDragLeave={() => {
                  if (dragOverTypeTab === tab.id) setDragOverTypeTab(null)
                }}
                onDrop={(e) => handleTypeTabDrop(e, tab.id)}
                title={
                  tab.id === 'all'
                    ? 'แสดงทั้งหมด'
                    : `คลิกเพื่อดูเฉพาะ ${tab.label} หรือลากการ์ดมาวางทับเพื่อเปลี่ยนเป็น ${tab.label}`
                }
              >
                <span className="account-tab-emoji">{tab.emoji}</span>
                <span className="account-tab-label">{tab.label}</span>
                <span className="account-tab-count">{count}</span>
              </button>
            )
          })}
        </div>

        {(() => {
          const filteredAccounts =
            accountTypeFilter === 'all'
              ? accounts
              : accounts.filter((a) => (a.type || 'bank') === accountTypeFilter)

          if (filteredAccounts.length === 0) {
            const currentTab = ACCOUNT_TYPE_TABS.find((t) => t.id === accountTypeFilter)
            return (
              <div className="accounts-empty-state">
                <p>ยังไม่มีรายการในหมวด <strong>{currentTab?.emoji} {currentTab?.label}</strong></p>
                <button
                  type="button"
                  className="secondary-button"
                  onClick={() => {
                    const initialType = accountTypeFilter === 'all' ? 'bank' : accountTypeFilter
                    const presetForType =
                      initialType === 'promptpay'
                        ? BANK_PRESETS.find((b) => b.id === 'promptpay')
                        : BANK_PRESETS.find((b) => b.id === 'kbank')
                    setEditingAccount({
                      type: initialType,
                      bank: presetForType?.id || 'kbank',
                      bankName: presetForType?.name || 'ธนาคารกสิกรไทย',
                      bankCode: presetForType?.code || 'KBANK',
                      accNumber: '',
                      accName: 'NATTANONT VONGKASAI',
                      label: '',
                      color: presetForType?.color || 'kbank',
                      expiry: '12/29',
                      cvv: '888',
                    })
                    setShowAccountModal(true)
                  }}
                >
                  <Icon name="add" /> เพิ่ม{currentTab?.label || 'รายการ'}ใหม่
                </button>
              </div>
            )
          }

          return (
            <div className="virtual-cards-grid">
              {filteredAccounts.map((acc, index) => (
                <VirtualCard
                  key={acc.id}
                  account={acc}
                  index={index}
                  totalShown={filteredAccounts.length}
                  isDragging={draggedAccId === acc.id}
                  isDragOver={dragOverAccId === acc.id}
                  onDragStart={handleAccDragStart}
                  onDragOver={handleAccDragOver}
                  onDragLeave={handleAccDragLeave}
                  onDrop={handleAccDrop}
                  onDragEnd={handleAccDragEnd}
                  onMoveStep={moveAccStep}
                  onCopyNumber={handleCopyNumber}
                  onCopyCvv={handleCopyCvv}
                  onCopyAll={handleCopyAll}
                  onEdit={(target) => {
                    setEditingAccount(target)
                    setShowAccountModal(true)
                  }}
                  onDelete={handleDeleteAccount}
                  copiedField={copiedField}
                />
              ))}
            </div>
          )
        })()}
      </div>

      {showAccountModal && (
        <AccountModal
          account={editingAccount}
          onClose={() => { setShowAccountModal(false); setEditingAccount(null); }}
          onSave={handleSaveAccount}
        />
      )}
    </section>
  )
}

function App() {
  const [unlocked, setUnlocked] = useState(() => isSessionUnlocked())
  const [items, setItems] = useState([])
  const [folders, setFolders] = useState([])
  const [page, setPage] = useState('home')
  const [activeMenu, setActiveMenu] = useState('home')
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false)
  const [viewMode, setViewMode] = useState('grid') // 'grid' | 'list'
  const [sortBy, setSortBy] = useState('custom') // 'custom' | 'latest' | 'az' | 'favorite'
  const [query, setQuery] = useState('')
  const deferredQuery = useDeferredValue(query)
  const [categoryFilter, setCategoryFilter] = useState('all')
  const [folderFilter, setFolderFilter] = useState('all') // 'all' | '__unfiled__' | folderName
  const [quickFilter, setQuickFilter] = useState('all') // 'all' | 'favorite' | 'hasNote' | 'hasImage'
  const [lockedDate, setLockedDate] = useState(null) // Date | null สำหรับฟังก์ชันปฏิทินล็อควัน
  const [isCreatingFolder, setIsCreatingFolder] = useState(false)
  const [newFolderName, setNewFolderName] = useState('')
  const [newFolderCategory, setNewFolderCategory] = useState('main')
  const [draggedId, setDraggedId] = useState(null)
  const [dragOverCardId, setDragOverCardId] = useState(null)
  const [dragOverFolder, setDragOverFolder] = useState(null)
  const [dragOverCategory, setDragOverCategory] = useState(null)
  const [editorItem, setEditorItem] = useState(null)
  const [detailItem, setDetailItem] = useState(null)
  const [deleteConfirmItem, setDeleteConfirmItem] = useState(null)
  const [galleryPage, setGalleryPage] = useState(1)
  const [paginateGallery, setPaginateGallery] = useState(false)
  const [lightboxImage, setLightboxImage] = useState(null)
  const [showDownloadModal, setShowDownloadModal] = useState(false)
  const [deferredPrompt, setDeferredPrompt] = useState(null)
  const [toast, setToast] = useState('')
  const [cloudState, setCloudState] = useState('กำลังเชื่อมต่อ Firebase')
  const [isSyncing, setIsSyncing] = useState(false)
  const searchInputRef = useRef(null)
  const gallerySectionRef = useRef(null)
  const categorySectionRef = useRef(null)
  const folderSectionRef = useRef(null)

  // Shortcut Ctrl + K / Cmd + K เพื่อโฟกัสช่องค้นหาทันที
  useEffect(() => {
    const handleGlobalShortcut = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        if (page !== 'home' && page !== 'prompts' && page !== 'notes') {
          setPage('prompts')
          setActiveMenu('prompts')
        }
        setTimeout(() => {
          searchInputRef.current?.focus()
          searchInputRef.current?.select()
        }, 20)
      }
    }
    window.addEventListener('keydown', handleGlobalShortcut)
    return () => window.removeEventListener('keydown', handleGlobalShortcut)
  }, [page])

  // ดักจับ PWA Install Prompt สำหรับมือถือ
  useEffect(() => {
    const handleBeforeInstall = (e) => {
      e.preventDefault()
      setDeferredPrompt(e)
    }
    window.addEventListener('beforeinstallprompt', handleBeforeInstall)
    return () => window.removeEventListener('beforeinstallprompt', handleBeforeInstall)
  }, [])

  const handleInstallPwa = async () => {
    if (!deferredPrompt) return
    deferredPrompt.prompt()
    try {
      const { outcome } = await deferredPrompt.userChoice
      if (outcome === 'accepted') {
        setDeferredPrompt(null)
        setToast('ขอบคุณที่ติดตั้งแอป MIX Image Prompt')
      }
    } catch {
      // ignore
    }
  }

  // ล็อคการเลื่อนหน้าจอพื้นหลังเมื่อเปิด Modal บนมือถือ ป้องกันหน้าจอไหลซ้อนกัน
  useEffect(() => {
    const hasModal = Boolean(editorItem || detailItem || lightboxImage || showDownloadModal)
    if (hasModal) {
      document.body.style.overflow = 'hidden'
    } else {
      document.body.style.overflow = ''
    }
    return () => {
      document.body.style.overflow = ''
    }
  }, [editorItem, detailItem, lightboxImage, showDownloadModal])

  const syncData = async () => {
    setIsSyncing(true)
    try {
      const [cloudItems, cloudFolders] = await Promise.all([
        loadCloudPrompts(),
        loadCloudFolders(),
      ])
      // สมานหมวดหมู่ให้ตรงกับโฟลเดอร์สำหรับกรณีข้อมูลเดิมที่มีโฟลเดอร์ในห้องเฉพาะ
      const folderCatMap = new Map()
      for (const f of cloudFolders || []) {
        if (f.name && f.category && f.category !== 'all' && f.category !== 'main') {
          folderCatMap.set(f.name.toLowerCase(), f.category)
        }
      }
      const reconciled = (cloudItems || []).map((item) => {
        if (item.folder && (item.category === 'main' || !item.category)) {
          const expectedCat = folderCatMap.get(item.folder.toLowerCase())
          if (expectedCat) {
            return { ...item, category: expectedCat }
          }
        }
        return item
      })
      setItems(reconciled)
      writeLocalPrompts(reconciled)
      if (cloudFolders?.length) {
        setFolders(cloudFolders)
        writeLocalFolders(cloudFolders)
      }
      setCloudState('Firebase พร้อม')
    } catch {
      const local = readLocalPrompts()
      const localFolders = readLocalFolders()
      if (localFolders.length) setFolders(localFolders)
      setCloudState(local.length ? 'ใช้ข้อมูลในเครื่อง' : 'รอตั้งค่า Firestore')
    } finally {
      setIsSyncing(false)
    }
  }

  useEffect(() => {
    if (!unlocked) return
    const local = readLocalPrompts()
    const localFolders = readLocalFolders()
    setItems(local)
    setFolders(localFolders)
    syncData()
  }, [unlocked])

  useEffect(() => {
    if (toast) {
      const timer = window.setTimeout(() => setToast(''), 2600)
      return () => window.clearTimeout(timer)
    }
  }, [toast])

  // รวมโฟลเดอร์ที่สร้างไว้ กับโฟลเดอร์ที่ติดมากับรายการพรอมต์ โดย "แยกตามห้อง (หมวดหมู่)" ไม่ให้ปนกัน
  // คีย์ของโฟลเดอร์ = หมวดหมู่ + ชื่อ ดังนั้นชื่อเดียวกันในคนละห้องจะเป็นคนละโฟลเดอร์
  const allFolders = useMemo(() => {
    const map = new Map()
    for (const f of folders) {
      const name = (f?.name || '').trim()
      if (!name) continue
      const cat = f.category && f.category !== 'all' ? f.category : 'all'
      const key = `${cat}::${name}`
      if (!map.has(key)) {
        map.set(key, { id: f.id || `folder-${key}`, name, category: cat })
      }
    }
    for (const item of items) {
      const name = (item.folder || '').trim()
      if (!name) continue
      const cat = item.category || 'main'
      const key = `${cat}::${name}`
      if (!map.has(key)) {
        map.set(key, { id: `derived-${key}`, name, category: cat })
      }
    }
    return Array.from(map.values())
  }, [folders, items])

  // โฟลเดอร์จัดกลุ่มตามห้อง ใช้ในเมนูย้าย/ฟอร์ม เพื่อให้เห็นเฉพาะโฟลเดอร์ของห้องตัวเอง
  const foldersByCategory = useMemo(() => {
    const grouped = {}
    for (const f of allFolders) {
      if (f.category === 'all') continue
      ;(grouped[f.category] ||= []).push(f)
    }
    return grouped
  }, [allFolders])

  // โฟลเดอร์ที่แสดง: เลือกห้องไหนเห็นเฉพาะโฟลเดอร์ของห้องนั้น / มุมมอง "ทั้งหมด" แสดงรวมโดยไม่ซ้ำชื่อ
  const visibleFolders = useMemo(() => {
    if (categoryFilter === 'all') {
      const seen = new Set()
      return allFolders.filter((f) => {
        if (seen.has(f.name)) return false
        seen.add(f.name)
        return true
      })
    }
    return allFolders.filter((f) => f.category === categoryFilter)
  }, [allFolders, categoryFilter])

  const { notesCount, favoritesCount, imagesCount } = useMemo(() => {
    let notes = 0
    let favs = 0
    let imgs = 0
    for (const item of items) {
      if (item.notes || item.category === 'note') notes++
      if (item.favorite) favs++
      if (item.imageUrls?.length) imgs++
    }
    return { notesCount: notes, favoritesCount: favs, imagesCount: imgs }
  }, [items])

  // รายการที่ผ่านตัวกรองหมวดหมู่ คำค้นหา และตัวกรองด่วน (ก่อนกรองโฟลเดอร์ เพื่อให้นับจำนวนในแต่ละโฟลเดอร์ได้ถูกต้อง)
  const categoryFilteredItems = useMemo(() => {
    const normalizedQuery = deferredQuery.trim().toLowerCase()
    return items.filter((item) => {
      // ตรวจสอบห้อง: ตรงกับ categoryFilter หรือกรณีที่พรอมต์อยู่ในโฟลเดอร์ของห้องนั้น
      const isFolderInCategory =
        categoryFilter !== 'all' &&
        item.folder &&
        allFolders.some(
          (f) =>
            f.category === categoryFilter &&
            f.name.toLowerCase() === item.folder.toLowerCase()
        )
      const inCategory = categoryFilter === 'all' || item.category === categoryFilter || isFolderInCategory
      if (!inCategory) return false

      if (quickFilter === 'favorite' && !item.favorite) return false
      if (quickFilter === 'hasNote' && !item.notes && item.category !== 'note') return false
      if (quickFilter === 'hasImage' && (!item.imageUrls || !item.imageUrls.length)) return false

      if (lockedDate) {
        if (!item.createdAt) return false
        if (!isSameDay(item.createdAt, lockedDate)) return false
      }

      if (normalizedQuery) {
        const haystack = [
          item.title,
          item.promptText,
          item.negativePrompt,
          item.notes,
          item.tool,
          item.folder,
          ...(item.tags || []),
        ].join(' ').toLowerCase()
        if (!haystack.includes(normalizedQuery)) return false
      }

      return true
    })
  }, [items, deferredQuery, categoryFilter, quickFilter, lockedDate, allFolders])

  const filteredItems = useMemo(() => {
    if (folderFilter === 'all') return categoryFilteredItems
    if (folderFilter === '__unfiled__') {
      return categoryFilteredItems.filter((item) => !item.folder)
    }
    return categoryFilteredItems.filter((item) => item.folder === folderFilter)
  }, [categoryFilteredItems, folderFilter])

  const folderPresets = useMemo(() => {
    const presetCategory = categoryFilter === 'all' ? newFolderCategory : categoryFilter
    switch (presetCategory) {
      case 'portrait':
        return ['รูปวีซ่า / ติดบัตร', 'ชุดนักเรียน / นักศึกษา', 'ชุดสูท / เสื้อขาวสุภาพ', 'ภาพอ้างอิง (Master)']
      case 'product':
        return ['แพ็กเกจจิ้งสินค้า', 'เครื่องสำอาง / สกินแคร์', 'ม็อคอัป 3D', 'ฉากสตูดิโอจัดแสง']
      case 'landscape':
        return ['วิวธรรมชาติ', 'เมืองไซเบอร์พังค์', 'อวกาศ / ดาราศาสตร์', 'โลกแฟนตาซี']
      case 'sound':
        return ['เพลงบรรเลงประกอบ', 'BGM โฆษณา', 'Lo-Fi Chill', 'Intro / Outro']
      case 'note':
        return ['เทคนิคการเจน', 'สูตรคำสั่งพิเศษ', 'Style Reference', 'Negative ชุดเก่ง']
      default:
        return ['โปรเจกต์งานด่วน', 'พรอมต์ทดลอง', 'ชุดภาพโปรด', 'คอลเลกชันหลัก']
    }
  }, [categoryFilter, newFolderCategory])

  const flash = (message) => setToast(message)

  const copyPromptText = async (text) => {
    await safeCopyText(text || '')
    flash('คัดลอกข้อความแล้ว')
  }

  const copyPrompt = async (item) => {
    await safeCopyText(item.promptText || '')
    flash('คัดลอกพรอมต์แล้ว')
  }

  // สร้างโฟลเดอร์ใหม่ (รองรับ Optimistic UI และเลือกหมวดหมู่ที่เหมาะสมโดยอัตโนมัติ)
  const createFolder = async (customName, targetCategory) => {
    const clean = (typeof customName === 'string' ? customName : newFolderName).trim()
    if (!clean) return ''
    const cat = targetCategory || (categoryFilter === 'all' ? newFolderCategory : categoryFilter)

    const existing = allFolders.find(
      (f) => f.category === cat && f.name.toLowerCase() === clean.toLowerCase()
    )
    if (existing) {
      setNewFolderName('')
      setIsCreatingFolder(false)
      setFolderFilter(existing.name)
      flash(`เปิดโฟลเดอร์ “${existing.name}”`)
      return existing.name
    }

    // อัปเดตทันทีแบบ Optimistic UI ตอบสนองใน 0 มิลลิวินาที
    const localId = `folder-${Date.now()}`
    const nowIso = new Date().toISOString()
    const newFolderObj = { id: localId, name: clean, category: cat, createdAt: nowIso }
    const nextFolders = [...folders, newFolderObj]
    setFolders(nextFolders)
    writeLocalFolders(nextFolders)
    setNewFolderName('')
    setIsCreatingFolder(false)
    setFolderFilter(clean)
    flash(`สร้างโฟลเดอร์ “${clean}” แล้ว`)

    // ซิงค์คลาวด์เบื้องหลัง
    try {
      const created = await saveCloudFolder({ name: clean, category: cat })
      if (created?.id && created.id !== localId) {
        setFolders((current) =>
          current.map((f) => (f.id === localId ? { ...f, id: created.id } : f))
        )
      }
    } catch {
      // ใช้ข้อมูลโฟลเดอร์ในเครื่อง
    }

    return clean
  }

  // ลบโฟลเดอร์ (โดยไม่ลบพรอมต์ข้างใน แค่นำพรอมต์ออกจากโฟลเดอร์นั้น) — ลบเฉพาะโฟลเดอร์ในห้องของมันเท่านั้น
  const removeFolder = async (folderObj, e) => {
    e?.stopPropagation()
    if (
      !window.confirm(
        `ต้องการลบโฟลเดอร์ “${folderObj.name}” ใช่หรือไม่?\n(พรอมต์ข้างในจะไม่ถูกลบ แต่จะถูกนำออกจากโฟลเดอร์)`
      )
    ) {
      return
    }
    // มุมมอง "ทั้งหมด" ลบชื่อนี้ทุกห้อง / มุมมองในห้อง ลบเฉพาะห้องนั้น
    const allScope = categoryFilter === 'all'
    const sameScope = (cat) => allScope || (cat || 'all') === folderObj.category
    const doomed = folders.filter((f) => f.name === folderObj.name && sameScope(f.category || 'all'))
    const nextFolders = folders.filter((f) => !doomed.includes(f))
    setFolders(nextFolders)
    writeLocalFolders(nextFolders)
    doomed.forEach((f) => deleteCloudFolder(f.id))

    const affected = []
    const nextItems = items.map((item) => {
      if (item.folder === folderObj.name && (allScope || item.category === folderObj.category)) {
        const updated = { ...item, folder: '' }
        affected.push(updated)
        return updated
      }
      return item
    })
    setItems(nextItems)
    writeLocalPrompts(nextItems)
    if (affected.length) {
      updateCloudPromptsOrder(affected)
    }
    if (folderFilter === folderObj.name) {
      setFolderFilter('all')
    }
    flash(`ลบโฟลเดอร์ “${folderObj.name}” แล้ว`)
  }

  // ย้ายพรอมต์ไปยังโฟลเดอร์ที่เลือก (พร้อมปรับหมวดหมู่ให้สอดคล้องกับโฟลเดอร์โดยอัตโนมัติ)
  const moveItemToFolder = async (item, targetFolderName) => {
    const cleanFolder = (targetFolderName || '').trim()
    if ((item.folder || '') === cleanFolder && (categoryFilter === 'all' || item.category === categoryFilter)) return

    // หาหมวดหมู่เป้าหมายที่สัมพันธ์กับโฟลเดอร์นี้
    const matchedFolder = cleanFolder
      ? allFolders.find(
          (f) =>
            f.name.toLowerCase() === cleanFolder.toLowerCase() &&
            f.category &&
            f.category !== 'all'
        )
      : null

    const targetCategory = cleanFolder
      ? categoryFilter !== 'all'
        ? categoryFilter
        : (matchedFolder?.category || item.category || 'main')
      : item.category || 'main'

    const nextItem = {
      ...item,
      category: targetCategory,
      folder: cleanFolder,
      updatedAt: new Date().toISOString(),
    }
    const next = items.map((current) => (current.id === item.id ? nextItem : current))
    setItems(next)
    writeLocalPrompts(next)
    if (detailItem?.id === item.id) {
      setDetailItem(nextItem)
    }

    // บันทึกโฟลเดอร์ลงหมวดหมู่เป้าหมายหากยังไม่มีในระบบ
    if (
      cleanFolder &&
      !allFolders.some(
        (f) =>
          f.name.toLowerCase() === cleanFolder.toLowerCase() &&
          f.category === targetCategory
      )
    ) {
      saveCloudFolder({ name: cleanFolder, category: targetCategory }).then((created) => {
        setFolders((curr) => {
          const updatedFolders = [...curr, created]
          writeLocalFolders(updatedFolders)
          return updatedFolders
        })
      })
    }

    const catLabel = categories.find((c) => c.id === targetCategory)?.label || targetCategory
    flash(
      cleanFolder
        ? `ย้าย “${item.title}” ไปยังโฟลเดอร์ “${cleanFolder}” (${catLabel}) แล้ว`
        : `นำ “${item.title}” ออกจากโฟลเดอร์แล้ว`
    )
    try {
      await updateCloudPrompt(nextItem)
    } catch {
      setCloudState('ใช้ข้อมูลในเครื่อง')
    }
  }

  // สร้างโฟลเดอร์ใหม่พร้อมย้ายการ์ดเข้าไปทันที
  const createAndMoveToFolder = async (item, folderName) => {
    const targetCat = categoryFilter !== 'all' ? categoryFilter : (item?.category || 'main')
    const createdName = await createFolder(folderName, targetCat)
    if (createdName) {
      await moveItemToFolder(item, createdName)
    }
  }

  // ย้ายพรอมต์ไปหมวดหมู่อื่น (รักษาโฟลเดอร์เดิมไว้ และบันทึกเข้าห้องปลายทาง)
  const moveItemToCategory = async (item, targetCategoryId) => {
    if (!targetCategoryId || targetCategoryId === 'all' || item.category === targetCategoryId) return
    const catLabel = categories.find((c) => c.id === targetCategoryId)?.label || targetCategoryId
    const cleanFolder = (item.folder || '').trim()

    const nextItem = {
      ...item,
      category: targetCategoryId,
      folder: cleanFolder,
      updatedAt: new Date().toISOString(),
    }
    const next = items.map((current) => (current.id === item.id ? nextItem : current))
    setItems(next)
    writeLocalPrompts(next)
    if (detailItem?.id === item.id) {
      setDetailItem(nextItem)
    }

    // บันทึกโฟลเดอร์ในหมวดหมู่ปลายทางด้วย
    if (
      cleanFolder &&
      !allFolders.some(
        (f) =>
          f.name.toLowerCase() === cleanFolder.toLowerCase() &&
          f.category === targetCategoryId
      )
    ) {
      saveCloudFolder({ name: cleanFolder, category: targetCategoryId }).then((created) => {
        setFolders((curr) => {
          const updatedFolders = [...curr, created]
          writeLocalFolders(updatedFolders)
          return updatedFolders
        })
      })
    }

    flash(`ย้าย “${item.title}” ไปหมวด “${catLabel}” แล้ว`)
    try {
      await updateCloudPrompt(nextItem)
    } catch {
      setCloudState('ใช้ข้อมูลในเครื่อง')
    }
  }

  const saveItem = async (draft) => {
    const payload = { ...draft, imageFile: undefined, precompressedPreview: undefined }
    const isEditing = Boolean(editorItem?.id)
    const editingId = editorItem?.id
    const finalCategory = payload.category || (categoryFilter === 'all' ? 'main' : categoryFilter)
    const finalFolder = (payload.folder || '').trim()

    // หากสร้างพรอมต์พร้อมพิมพ์ชื่อโฟลเดอร์ใหม่ ให้บันทึกโฟลเดอร์นั้นไว้ในรายการโฟลเดอร์ของห้องนั้นด้วย
    if (
      finalFolder &&
      !allFolders.some(
        (f) =>
          f.name.toLowerCase() === finalFolder.toLowerCase() &&
          f.category === finalCategory
      )
    ) {
      saveCloudFolder({ name: finalFolder, category: finalCategory }).then((created) => {
        setFolders((curr) => {
          const nextFolders = [...curr, created]
          writeLocalFolders(nextFolders)
          return nextFolders
        })
      })
    }

    try {
      const saved = await saveCloudPrompt({
        id: editingId,
        data: { ...payload, category: finalCategory, folder: finalFolder },
        imageFile: draft.imageFile,
        precompressedPreview: draft.precompressedPreview || '',
      })
      const next = isEditing
        ? items.map((item) => (item.id === editingId ? saved : item))
        : [saved, ...items]
      setItems(next)
      writeLocalPrompts(next)
      setEditorItem(null)
      flash(isEditing ? 'บันทึกการแก้ไขแล้ว' : 'บันทึกพรอมต์ใหม่แล้ว')
      setCloudState('Firebase พร้อม')
    } catch (error) {
      const localId = editingId || `local-${Date.now()}`
      const localImage =
        draft.precompressedPreview ||
        (draft.imageFile ? await fileToLocalPreview(draft.imageFile).catch(() => '') : '')
      const saved = normalizePrompt(localId, {
        ...payload,
        category: finalCategory,
        folder: finalFolder,
        image_urls: localImage ? [localImage] : draft.imageUrls,
        updated_at: new Date().toISOString(),
        created_at: editorItem?.createdAt || new Date().toISOString(),
      })
      const next = isEditing
        ? items.map((item) => (item.id === editingId ? saved : item))
        : [saved, ...items]
      setItems(next)
      writeLocalPrompts(next)
      setEditorItem(null)
      setCloudState('ใช้ข้อมูลในเครื่อง')
      flash(`บันทึกในเครื่องแล้ว: ${error?.message?.slice(0, 60) || 'Firebase ยังไม่พร้อม'}`)
    }
  }

  const deleteItem = (item) => {
    if (!item?.id) return
    setDeleteConfirmItem(item)
  }

  const confirmDeleteItem = async () => {
    const item = deleteConfirmItem
    if (!item?.id) return
    setDeleteConfirmItem(null)
    const targetId = item.id
    const targetTitle = item.title

    // 1. Optimistic UI: ตัดรายการออกจาก state และลดจำนวนพรอมต์รวมทันที
    const next = items.filter((current) => current.id !== targetId)
    setItems(next)
    writeLocalPrompts(next)
    if (detailItem?.id === targetId) {
      setDetailItem(null)
    }
    flash(`ลบ “${targetTitle}” แล้ว`)

    // 2. ซิงค์ลบข้อมูลบน Cloud / Storage ในเบื้องหลัง ไม่บล็อก UI
    try {
      await deleteCloudPrompt(item)
    } catch (err) {
      console.warn('ลบข้อมูลบนคลาวด์ไม่สำเร็จ (ลบในเครื่องเรียบร้อยแล้ว):', err)
    }
  }

  const toggleFavorite = async (item) => {
    const nextItem = { ...item, favorite: !item.favorite, updatedAt: new Date().toISOString() }
    const next = items.map((current) => current.id === item.id ? nextItem : current)
    setItems(next)
    writeLocalPrompts(next)
    try {
      await updateCloudPrompt(nextItem)
    } catch {
      setCloudState('ใช้ข้อมูลในเครื่อง')
    }
  }

  const showLibrary = page === 'home' || page === 'prompts' || page === 'notes'
  const hasActiveFilter =
    categoryFilter !== 'all' ||
    folderFilter !== 'all' ||
    quickFilter !== 'all' ||
    Boolean(query.trim())

  const shownItems = useMemo(() => {
    const base =
      page === 'notes'
        ? filteredItems.filter((item) => item.notes || item.category === 'note')
        : page === 'home' && !hasActiveFilter
        ? filteredItems.filter((item) => item.favorite).length > 0
          ? filteredItems.filter((item) => item.favorite)
          : filteredItems
        : filteredItems

    if (sortBy === 'latest') {
      return [...base].sort((a, b) => new Date(b.updatedAt || b.createdAt || 0) - new Date(a.updatedAt || a.createdAt || 0))
    }
    if (sortBy === 'az') {
      return [...base].sort((a, b) => (a.title || '').localeCompare(b.title || '', 'th'))
    }
    if (sortBy === 'favorite') {
      return [...base].sort((a, b) => Number(Boolean(b.favorite)) - Number(Boolean(a.favorite)))
    }
    return base
  }, [page, filteredItems, hasActiveFilter, sortBy])

  const popularTags = useMemo(() => {
    const counts = new Map()
    const defaults = ['ภาพติดบัตร', 'รีทัช', 'ชุดนักเรียน', 'ชุดสูท', 'พื้นหลังฟ้า', 'AI Portrait', 'SunoAI', 'ปกเพลง']
    for (const d of defaults) counts.set(d, 1)
    for (const item of items) {
      for (const t of item.tags || []) {
        const clean = (t || '').trim()
        if (clean) counts.set(clean, (counts.get(clean) || 0) + 2)
      }
    }
    return Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 12)
      .map(([tag]) => tag)
  }, [items])

  const handleFolderClick = useCallback((fName) => setFolderFilter(fName), [])
  const handleEditItem = useCallback((current) => { setEditorItem(current); setPage('add') }, [])
  const handleTagClick = useCallback((tag) => setQuery(tag), [])
  const handleOpenItem = useCallback((item) => setDetailItem(item), [])

  const handleSelectMenu = useCallback((menuId) => {
    setActiveMenu(menuId)
    if (menuId === 'home') {
      setPage('home')
      setCategoryFilter('all')
      setFolderFilter('all')
      setQuickFilter('all')
      window.scrollTo({ top: 0 })
    } else if (menuId === 'prompts') {
      setPage('prompts')
      setCategoryFilter('all')
      setFolderFilter('all')
      setQuickFilter('all')
    } else if (menuId === 'categories') {
      setPage('prompts')
      setTimeout(() => categorySectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 60)
    } else if (menuId === 'projects') {
      setPage('prompts')
      setTimeout(() => folderSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 60)
    } else if (menuId === 'favorites') {
      setPage('prompts')
      setQuickFilter('favorite')
      setCategoryFilter('all')
      setFolderFilter('all')
    } else if (menuId === 'notes') {
      setPage('notes')
      setQuickFilter('hasNote')
    } else if (menuId === 'savings') {
      setPage('savings')
    } else if (menuId === 'ai-tools') {
      setPage('ai-tools')
    } else if (menuId === 'reports') {
      setPage('reports')
    } else if (menuId === 'profile') {
      setPage('profile')
    }
  }, [])

  // ย้ายลำดับการ์ด (รองรับทั้งการคลิกค้างแล้วลากวาง และการกดปุ่มเลื่อน ◀ ▶)
  const reorderCards = (sourceId, targetId) => {
    if (!sourceId || !targetId || sourceId === targetId) return
    const currentShown = [...shownItems]
    const fromIdx = currentShown.findIndex((it) => it.id === sourceId)
    const toIdx = currentShown.findIndex((it) => it.id === targetId)
    if (fromIdx === -1 || toIdx === -1) return

    const [moved] = currentShown.splice(fromIdx, 1)
    currentShown.splice(toIdx, 0, moved)

    const shownIds = new Set(currentShown.map((it) => it.id))
    let replacementIdx = 0
    const nextItems = items
      .map((it) => (shownIds.has(it.id) ? currentShown[replacementIdx++] : it))
      .map((it, idx) => ({
        ...it,
        sortOrder: (idx + 1) * 10,
      }))

    setItems(nextItems)
    writeLocalPrompts(nextItems)
    const affected = nextItems.filter((item) => {
      const orig = items.find((it) => it.id === item.id)
      return !orig || orig.sortOrder !== item.sortOrder
    })
    if (affected.length) {
      updateCloudPromptsOrder(affected)
    }
    flash('ย้ายตำแหน่งการ์ดเรียบร้อยแล้ว')
  }

  const moveCardStep = (item, delta) => {
    const idx = shownItems.findIndex((it) => it.id === item.id)
    const targetIdx = idx + delta
    if (idx === -1 || targetIdx < 0 || targetIdx >= shownItems.length) return
    reorderCards(item.id, shownItems[targetIdx].id)
  }

  const handleCardDragStart = (e, item) => {
    setDraggedId(item.id)
    e.dataTransfer.effectAllowed = 'move'
    try {
      e.dataTransfer.setData('text/plain', item.id)
    } catch {
      // Ignore browser restrictions
    }
  }

  const handleCardDragOver = (e, targetItem) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    if (draggedId && draggedId !== targetItem.id && dragOverCardId !== targetItem.id) {
      setDragOverCardId(targetItem.id)
    }
  }

  const handleCardDragLeave = (_, targetItem) => {
    if (dragOverCardId === targetItem.id) {
      setDragOverCardId(null)
    }
  }

  const handleCardDrop = (e, targetItem) => {
    e.preventDefault()
    const sourceId = draggedId || e.dataTransfer.getData('text/plain')
    setDragOverCardId(null)
    setDraggedId(null)
    if (sourceId && sourceId !== targetItem.id) {
      reorderCards(sourceId, targetItem.id)
    }
  }

  const handleCardDragEnd = () => {
    setDraggedId(null)
    setDragOverCardId(null)
    setDragOverFolder(null)
    setDragOverCategory(null)
  }

  const handleFolderDrop = (e, targetFolderName) => {
    e.preventDefault()
    const sourceId = draggedId || e.dataTransfer.getData('text/plain')
    setDragOverFolder(null)
    setDraggedId(null)
    const draggedItem = items.find((it) => it.id === sourceId)
    if (draggedItem) {
      moveItemToFolder(draggedItem, targetFolderName === '__unfiled__' || targetFolderName === 'all' ? '' : targetFolderName)
    }
  }

  const handleCategoryDrop = (e, targetCategoryId) => {
    e.preventDefault()
    const sourceId = draggedId || e.dataTransfer.getData('text/plain')
    setDragOverCategory(null)
    setDraggedId(null)
    const draggedItem = items.find((it) => it.id === sourceId)
    if (draggedItem && targetCategoryId !== 'all') {
      moveItemToCategory(draggedItem, targetCategoryId)
    }
  }

  const unfiledCount = categoryFilteredItems.filter((item) => !item.folder).length
  const activeFolderDefault =
    folderFilter !== 'all' && folderFilter !== '__unfiled__' ? folderFilter : ''

  // สำคัญมาก: ตรวจสอบ PIN หลังจากเรียก React Hooks ทั้งหมดครบแล้ว เพื่อป้องกันบัค Hooks Mismatch ตอนปลดล็อก
  if (!unlocked) return <PinGate onUnlock={() => setUnlocked(true)} />

  return (
    <div className={`app-shell ${isSidebarCollapsed ? 'sidebar-collapsed' : ''}`}>
      <Sidebar
        page={page}
        activeMenu={activeMenu}
        collapsed={isSidebarCollapsed}
        onToggleCollapse={() => setIsSidebarCollapsed((prev) => !prev)}
        onSelectMenu={handleSelectMenu}
        onAdd={() => {
          setEditorItem({
            ...emptyForm,
            category: categoryFilter === 'all' ? 'main' : categoryFilter,
            folder: activeFolderDefault,
          })
          setPage('add')
        }}
        onOpenDownload={() => setShowDownloadModal(true)}
        totalCount={items.length}
        categoriesCount={categories.length - 1}
        foldersCount={allFolders.length}
        favoritesCount={favoritesCount}
        notesCount={notesCount}
        cloudState={cloudState}
      />

      <main className="main-content">
        <header className="topbar">
          <div className="topbar-title-block">
            <p className="eyebrow">MIX-IMAGE ART &amp; AUDIO</p>
            <h1>
              {page === 'home'
                ? 'Prompt Archive'
                : page === 'notes'
                ? 'โน้ตและเทคนิคส่วนตัว'
                : page === 'savings'
                ? 'เงินออม & บัญชีเสมือน'
                : page === 'ai-tools'
                ? 'เครื่องมือ AI สร้างสรรค์'
                : page === 'reports'
                ? 'รายงานและสถิติคลังพรอมต์'
                : page === 'profile'
                ? 'ตั้งค่าและโปรไฟล์'
                : 'คลังพรอมต์ทั้งหมด'}
            </h1>
            <p className="topbar-subtitle">คลังพรอมต์สร้างสรรค์ • ภาพ • เสียง • วิดีโอ • คอนเทนต์</p>
          </div>

          <div className="topbar-right-cluster">
            {/* Global Search Bar with Ctrl+K */}
            <label className="topbar-global-search">
              <Icon name="search" />
              <input
                ref={searchInputRef}
                value={query}
                onChange={(event) => {
                  setQuery(event.target.value)
                  if (page !== 'home' && page !== 'prompts' && page !== 'notes') {
                    setPage('prompts')
                    setActiveMenu('prompts')
                  }
                }}
                placeholder="ค้นหาพรอมต์, หมวดหมู่, แท็ก..."
              />
              {query ? (
                <button
                  type="button"
                  className="clear-search-btn"
                  onClick={() => setQuery('')}
                  aria-label="ล้างคำค้นหา"
                >
                  <Icon name="close" />
                </button>
              ) : (
                <kbd className="search-shortcut-kbd" title="กด Ctrl + K เพื่อค้นหาด่วน">Ctrl K</kbd>
              )}
            </label>

            <div className="topbar-actions">
              <TopbarClockPill />

              <button
                type="button"
                className={`cloud-status-btn ${isSyncing ? 'is-syncing' : ''}`}
                onClick={syncData}
                title="คลิกเพื่อซิงค์ข้อมูลกับ Firebase Cloud"
              >
                <Icon name="cloud" />
                <span>{isSyncing ? 'กำลังซิงค์...' : cloudState}</span>
              </button>

              <button
                type="button"
                className="topbar-icon-btn notification-bell-btn"
                onClick={() => flash(`คลังพรอมต์ซิงค์พร้อมใช้งาน • ทั้งหมด ${items.length} รายการ`)}
                title="การแจ้งเตือนระบบ"
                aria-label="การแจ้งเตือน"
              >
                <Icon name="bell" />
                <span className="notif-green-dot" aria-hidden="true" />
              </button>

              <button
                type="button"
                className="topbar-icon-btn"
                onClick={() => setShowDownloadModal(true)}
                title="ดาวน์โหลดแอป Windows (.exe) / Android (.apk)"
                aria-label="ดาวน์โหลดแอป"
              >
                <Icon name="download" />
              </button>

              <button
                type="button"
                className="topbar-profile-pill"
                onClick={() => handleSelectMenu('profile')}
                title="โปรไฟล์และการตั้งค่า"
              >
                <img src="./brand/jongjang-mascot.png" alt="MIX Profile" decoding="async" />
                <span>MIX</span>
                <span className="profile-caret">▾</span>
              </button>

              <button
                className="round-button"
                type="button"
                aria-label="ล็อคหน้าจอ (PIN)"
                title="ล็อคหน้าจอ (PIN)"
                onClick={() => {
                  clearUnlock()
                  setUnlocked(false)
                }}
              >
                <Icon name="logout" />
              </button>
            </div>
          </div>
        </header>

        {showLibrary && (
          <>
            {/* Quick Filter Pills + 4 Top Widgets (Keep Note, Calendar with Lock, Calculator, Weather Mekha GPS) */}
            <div className="filter-and-widgets-row">
              <div className="quick-filter-bar">
                <button
                  type="button"
                  className={`quick-pill ${quickFilter === 'all' && !lockedDate ? 'active' : ''}`}
                  onClick={() => {
                    setQuickFilter('all')
                    setLockedDate(null)
                    setCategoryFilter('all')
                    setFolderFilter('all')
                    setPage('home')
                    setActiveMenu('home')
                  }}
                >
                  ทั้งหมด ({items.length})
                </button>
                <button
                  type="button"
                  className={`quick-pill ${quickFilter === 'favorite' ? 'active' : ''}`}
                  onClick={() => setQuickFilter(quickFilter === 'favorite' ? 'all' : 'favorite')}
                >
                  <Icon name="star" filled={quickFilter === 'favorite'} /> รายการโปรด ({favoritesCount})
                </button>
                <button
                  type="button"
                  className={`quick-pill ${quickFilter === 'hasNote' ? 'active' : ''}`}
                  onClick={() => setQuickFilter(quickFilter === 'hasNote' ? 'all' : 'hasNote')}
                >
                  <Icon name="note" /> มีโน้ต ({notesCount})
                </button>
                <button
                  type="button"
                  className={`quick-pill ${quickFilter === 'hasImage' ? 'active' : ''}`}
                  onClick={() => setQuickFilter(quickFilter === 'hasImage' ? 'all' : 'hasImage')}
                >
                  <Icon name="image" /> มีรูปตัวอย่าง ({imagesCount})
                </button>
              </div>

              <div className="top-widget-strip">
                <QuickKeepNoteWidget onSaveNote={saveItem} />
                <CalendarLockWidget
                  items={items}
                  lockedDate={lockedDate}
                  onLockDate={(d) => setLockedDate(d)}
                  onClearLock={() => setLockedDate(null)}
                />
                <CalculatorWidget />
                <WeatherMekhaWidget />
              </div>
            </div>

            {/* แถบแจ้งเตือนเมื่อมีการล็อควัน */}
            {lockedDate && (
              <div className="date-locked-banner">
                <div className="date-locked-info">
                  <Icon name="lock" />
                  <span>
                    กำลังล็อคแสดงข้อมูลเฉพาะวันที่: <strong>{formatThaiDateFull(lockedDate)}</strong> (พบ {filteredItems.length} รายการ)
                  </span>
                </div>
                <button
                  type="button"
                  className="unlock-banner-btn"
                  onClick={() => setLockedDate(null)}
                  title="ปลดล็อคเพื่อดูทั้งหมด"
                >
                  <Icon name="unlock" /> ปลดล็อควันที่
                </button>
              </div>
            )}

            {/* 1. Welcome Banner (Hero Section ตามแบบ Visual Reference) */}
            {page === 'home' && (
              <section className="hero-strip">
                <div className="hero-content-col">
                  <span className="hero-label">MEET THE PROMPT DESK</span>
                  <h2>พร้อมสร้างสรรค์งานด้วย AI แล้วหรือยัง?</h2>
                  <p>
                    รวบรวมพรอมต์คุณภาพสำหรับภาพ, เพลง, วิดีโอ และคอนเทนต์ ครบจบในที่เดียว
                  </p>
                  <div className="hero-cta-row">
                    <button
                      type="button"
                      className="hero-cta-btn"
                      onClick={() => {
                        setEditorItem({
                          ...emptyForm,
                          category: categoryFilter === 'all' ? 'main' : categoryFilter,
                          folder: activeFolderDefault,
                        })
                        setPage('add')
                      }}
                    >
                      <Icon name="rocket" />
                      <span>เริ่มใช้งานทันที →</span>
                    </button>
                    <HeroClockBadge />
                  </div>
                </div>
                <div className="hero-image-frame">
                  <img src="./brand/jongjang-mascot.png" alt="จ๋องแจ๋งหุ่นยนต์ผู้ช่วยสร้างสรรค์" decoding="async" />
                </div>
              </section>
            )}

            {/* 2. Dashboard 5 Summary Stat Cards */}
            <section className="stat-grid stat-grid-5">
              <StatCard
                icon="prompt"
                label="พรอมต์ทั้งหมด"
                value={items.length}
                tone="purple"
                onClick={() => { setPage('prompts'); setActiveMenu('prompts'); setCategoryFilter('all'); setFolderFilter('all'); setQuickFilter('all') }}
                active={page === 'prompts' && quickFilter === 'all' && folderFilter === 'all' && categoryFilter === 'all'}
              />
              <StatCard
                icon="tag"
                label="หมวดหมู่"
                value={categories.length - 1}
                tone="blue"
                onClick={() => categorySectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
                active={categoryFilter !== 'all'}
              />
              <StatCard
                icon="folder"
                label="โปรเจกต์"
                value={allFolders.length}
                tone="green"
                onClick={() => folderSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
                active={folderFilter !== 'all'}
              />
              <StatCard
                icon="heart"
                label="รายการโปรด"
                value={favoritesCount}
                tone="orange"
                onClick={() => { setQuickFilter(quickFilter === 'favorite' ? 'all' : 'favorite'); setActiveMenu('favorites') }}
                active={quickFilter === 'favorite'}
              />
              <StatCard
                icon="trending-up"
                label="มีโน้ต / เทคนิค"
                value={`${notesCount} รายการ`}
                tone="cyan"
                onClick={() => { setPage('notes'); setActiveMenu('notes'); setQuickFilter('hasNote') }}
                active={page === 'notes' || quickFilter === 'hasNote'}
                onDragOver={(e) => {
                  e.preventDefault()
                  setDragOverCategory('note')
                }}
                onDragLeave={() => {
                  if (dragOverCategory === 'note') setDragOverCategory(null)
                }}
                onDrop={(e) => handleCategoryDrop(e, 'note')}
                isDropActive={dragOverCategory === 'note'}
              />
            </section>

            {/* 3. หมวดหมู่ยอดนิยม (Popular Categories Visual Cards) */}
            <section className="section-block" ref={categorySectionRef}>
              <div className="section-heading">
                <h2>
                  <Icon name="prompt" />
                  <span>หมวดหมู่ยอดนิยม</span>
                </h2>
                <div className="heading-actions">
                  {categoryFilter !== 'all' && (
                    <button
                      type="button"
                      className="text-button"
                      onClick={() => { setCategoryFilter('all'); setFolderFilter('all') }}
                    >
                      ล้างตัวกรองหมวดหมู่ ({categories.find((c) => c.id === categoryFilter)?.label || categoryFilter})
                    </button>
                  )}
                  <button
                    type="button"
                    className="pill-outline-btn"
                    onClick={() => { setCategoryFilter('all'); setFolderFilter('all'); setPage('prompts'); setActiveMenu('prompts') }}
                  >
                    ดูทั้งหมด →
                  </button>
                </div>
              </div>
              <div className="category-visual-grid">
                {categories.map((category) => {
                  const matchingItems =
                    category.id === 'all'
                      ? items
                      : items.filter((item) => {
                          if (item.category === category.id) return true
                          if (
                            item.folder &&
                            allFolders.some(
                              (f) =>
                                f.category === category.id &&
                                f.name.toLowerCase() === item.folder.toLowerCase()
                            )
                          ) {
                            return true
                          }
                          return false
                        })
                  const count = matchingItems.length
                  const previewImg = matchingItems.find((it) => it.imageUrls?.[0])?.imageUrls?.[0]

                  return (
                    <button
                      type="button"
                      className={`category-visual-card ${categoryFilter === category.id ? 'selected' : ''} ${dragOverCategory === category.id ? 'drop-target-active' : ''}`}
                      key={category.id}
                      onClick={() => {
                        const nextCat = categoryFilter === category.id && category.id !== 'all' ? 'all' : category.id
                        setCategoryFilter(nextCat)
                        setFolderFilter('all')
                        setQuickFilter('all')
                        setLockedDate(null)
                        setPage(nextCat === 'all' ? 'home' : 'prompts')
                      }}
                      onDragOver={(e) => {
                        if (category.id === 'all') return
                        e.preventDefault()
                        setDragOverCategory(category.id)
                      }}
                      onDragLeave={() => {
                        if (dragOverCategory === category.id) setDragOverCategory(null)
                      }}
                      onDrop={(e) => handleCategoryDrop(e, category.id)}
                    >
                      <div className={`cat-visual-thumb tone-${category.color}`}>
                        {previewImg ? (
                          <img src={previewImg} alt={category.label} loading="lazy" decoding="async" />
                        ) : (
                          <Icon name={category.icon} />
                        )}
                      </div>
                      <strong className="cat-visual-title">{category.label}</strong>
                      <small className="cat-visual-count">{count} พรอมต์</small>
                    </button>
                  )
                })}
              </div>
            </section>

            {/* 4. แท็กยอดนิยม (Popular Tags Row) */}
            <section className="section-block tags-section-block">
              <div className="section-heading">
                <h2>
                  <Icon name="tag" />
                  <span>แท็กยอดนิยม</span>
                </h2>
                {query && (
                  <button type="button" className="text-button" onClick={() => setQuery('')}>
                    ล้างคำค้นหา “{query}”
                  </button>
                )}
              </div>
              <div className="popular-tags-row">
                {popularTags.map((tag) => {
                  const isTagActive = query.trim().toLowerCase() === tag.toLowerCase()
                  return (
                    <button
                      type="button"
                      key={tag}
                      className={`popular-tag-pill ${isTagActive ? 'active' : ''}`}
                      onClick={() => setQuery(isTagActive ? '' : tag)}
                    >
                      #{tag}
                    </button>
                  )
                })}
              </div>
            </section>

            {/* 5. โฟลเดอร์จัดกลุ่ม / โปรเจกต์ (Folder Management Bar) */}
            <section className="section-block folder-section-block" ref={folderSectionRef}>
              <div className="section-heading folder-section-heading">
                <div>
                  <h2>
                    <Icon name="folder" filled />
                    <span>
                      โปรเจกต์ / โฟลเดอร์จัดกลุ่ม
                      {categoryFilter !== 'all'
                        ? ` (${categories.find((c) => c.id === categoryFilter)?.label || categoryFilter})`
                        : ''}
                    </span>
                    <span className="count-tag">({visibleFolders.length} โฟลเดอร์)</span>
                  </h2>
                  <p className="folder-hint-sub">
                    ลากการ์ดมาวางทับโฟลเดอร์เพื่อย้ายกลุ่ม หรือกดปุ่ม <strong>📁 ใส่โฟลเดอร์</strong> บนการ์ดได้เลย
                  </p>
                </div>

                <div className="heading-actions">
                  {folderFilter !== 'all' && (
                    <button
                      type="button"
                      className="text-button"
                      onClick={() => setFolderFilter('all')}
                    >
                      ดูทุกโฟลเดอร์
                    </button>
                  )}
                  <button
                    type="button"
                    className="create-folder-btn"
                    onClick={() => setIsCreatingFolder((prev) => !prev)}
                  >
                    <Icon name={isCreatingFolder ? 'close' : 'folder-plus'} />
                    <span>{isCreatingFolder ? 'ปิดฟอร์ม' : 'สร้างโฟลเดอร์ใหม่'}</span>
                  </button>
                </div>
              </div>

              {isCreatingFolder && (
                <form
                  className="create-folder-bar"
                  onSubmit={(e) => {
                    e.preventDefault()
                    createFolder()
                  }}
                >
                  <div className="create-folder-input-row">
                    <div className="create-folder-input-wrap">
                      <Icon name="folder-plus" />
                      <input
                        value={newFolderName}
                        onChange={(e) => setNewFolderName(e.target.value)}
                        placeholder={`ตั้งชื่อโฟลเดอร์ใหม่${categoryFilter !== 'all' ? ` (ห้อง: ${categories.find((c) => c.id === categoryFilter)?.label || categoryFilter})` : ''}...`}
                        autoFocus
                      />
                    </div>
                    {categoryFilter === 'all' && (
                      <select
                        className="create-folder-category-select"
                        value={newFolderCategory}
                        onChange={(e) => setNewFolderCategory(e.target.value)}
                        aria-label="เลือกห้องที่จะสร้างโฟลเดอร์"
                        title="โฟลเดอร์จะอยู่เฉพาะห้องที่เลือกนี้เท่านั้น"
                      >
                        {categories.filter((c) => c.id !== 'all').map((c) => (
                          <option key={c.id} value={c.id}>ห้อง: {c.label}</option>
                        ))}
                      </select>
                    )}
                    <div className="create-folder-actions">
                      <button type="submit" className="primary-button compact-button folder-save-btn" disabled={!newFolderName.trim()}>
                        บันทึกโฟลเดอร์
                      </button>
                      <button
                        type="button"
                        className="secondary-button compact-button"
                        onClick={() => { setIsCreatingFolder(false); setNewFolderName('') }}
                      >
                        ยกเลิก
                      </button>
                    </div>
                  </div>
                  <div className="folder-preset-row">
                    <span>สร้างด่วน{` (${categories.find((c) => c.id === (categoryFilter === 'all' ? newFolderCategory : categoryFilter))?.label || ''}):`}</span>
                    {folderPresets.map((preset) => (
                      <button
                        type="button"
                        key={preset}
                        className="tool-quick-btn"
                        onClick={() => createFolder(preset)}
                      >
                        + 📁 {preset}
                      </button>
                    ))}
                  </div>
                </form>
              )}

              <div className="folder-pills-row">
                <button
                  type="button"
                  className={`folder-tile ${folderFilter === 'all' ? 'selected' : ''}`}
                  onClick={() => setFolderFilter('all')}
                >
                  <Icon name="sparkles" />
                  <span>ทั้งหมดในหมวดนี้</span>
                  <span className="folder-count-badge">{categoryFilteredItems.length}</span>
                </button>

                {visibleFolders.map((folderObj) => {
                  const countInFolder = categoryFilteredItems.filter(
                    (item) => item.folder === folderObj.name
                  ).length
                  const isSelected = folderFilter === folderObj.name
                  const isDropOver = dragOverFolder === folderObj.name
                  return (
                    <div
                      key={folderObj.name}
                      className={`folder-tile ${isSelected ? 'selected' : ''} ${isDropOver ? 'folder-drop-active' : ''}`}
                      onClick={() => setFolderFilter(isSelected ? 'all' : folderObj.name)}
                      onDragOver={(e) => {
                        e.preventDefault()
                        e.dataTransfer.dropEffect = 'move'
                        if (dragOverFolder !== folderObj.name) setDragOverFolder(folderObj.name)
                      }}
                      onDragLeave={() => {
                        if (dragOverFolder === folderObj.name) setDragOverFolder(null)
                      }}
                      onDrop={(e) => handleFolderDrop(e, folderObj.name)}
                      role="button"
                      tabIndex={0}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault()
                          setFolderFilter(isSelected ? 'all' : folderObj.name)
                        }
                      }}
                      title={`คลิกเพื่อเปิดโฟลเดอร์ "${folderObj.name}" หรือลากการ์ดมาวางที่นี่`}
                    >
                      <Icon name="folder" filled={isSelected || isDropOver} />
                      <span className="folder-tile-name">{folderObj.name}</span>
                      <span className="folder-count-badge">{countInFolder}</span>
                      <button
                        type="button"
                        className="folder-delete-mini"
                        onClick={(e) => removeFolder(folderObj, e)}
                        title={`ลบโฟลเดอร์ ${folderObj.name}`}
                        aria-label={`ลบโฟลเดอร์ ${folderObj.name}`}
                      >
                        <Icon name="close" />
                      </button>
                    </div>
                  )
                })}

                {visibleFolders.length > 0 && (
                  <button
                    type="button"
                    className={`folder-tile unfiled-tile ${folderFilter === '__unfiled__' ? 'selected' : ''} ${dragOverFolder === '__unfiled__' ? 'folder-drop-active' : ''}`}
                    onClick={() => setFolderFilter(folderFilter === '__unfiled__' ? 'all' : '__unfiled__')}
                    onDragOver={(e) => {
                      e.preventDefault()
                      if (dragOverFolder !== '__unfiled__') setDragOverFolder('__unfiled__')
                    }}
                    onDragLeave={() => {
                      if (dragOverFolder === '__unfiled__') setDragOverFolder(null)
                    }}
                    onDrop={(e) => handleFolderDrop(e, '__unfiled__')}
                    title="แสดงรายการที่ยังไม่ได้จัดเข้าโฟลเดอร์ (ลากการ์ดมาวางที่นี่เพื่อเอาออกจากโฟลเดอร์)"
                  >
                    <Icon name="prompt" />
                    <span>ยังไม่จัดโฟลเดอร์</span>
                    <span className="folder-count-badge">{unfiledCount}</span>
                  </button>
                )}
              </div>
            </section>

            {/* 6. Prompt Gallery Section (พร้อมสลับ Grid/List View และตัวเรียงลำดับ) */}
            <section className="section-block" ref={gallerySectionRef}>
              <div className="section-heading gallery-toolbar-heading">
                <div>
                  <h2>
                    <Icon name="desktop" />
                    <span>
                      {folderFilter !== 'all' && folderFilter !== '__unfiled__'
                        ? `โฟลเดอร์: ${folderFilter}`
                        : folderFilter === '__unfiled__'
                        ? 'รายการที่ยังไม่จัดโฟลเดอร์'
                        : page === 'home' && !hasActiveFilter
                        ? 'พรอมต์ล่าสุด'
                        : page === 'notes'
                        ? 'รายการที่มีโน้ตส่วนตัว'
                        : 'คลังพรอมต์ทั้งหมด'}
                    </span>
                    <span className="count-tag">({shownItems.length})</span>
                  </h2>
                </div>

                <div className="gallery-toolbar-controls">
                  {page === 'home' && !hasActiveFilter && items.length > shownItems.length && (
                    <button
                      type="button"
                      className="text-button"
                      onClick={() => { setPage('prompts'); setActiveMenu('prompts'); setCategoryFilter('all'); setQuickFilter('all'); setFolderFilter('all') }}
                    >
                      ดูทั้งหมด ({items.length}) →
                    </button>
                  )}

                  {/* View Mode Toggle: Grid / List */}
                  <div className="view-mode-segmented" role="group" aria-label="รูปแบบการแสดงผล">
                    <button
                      type="button"
                      className={`view-mode-btn ${viewMode === 'grid' ? 'active' : ''}`}
                      onClick={() => setViewMode('grid')}
                      title="มุมมองการ์ด (Grid View)"
                      aria-label="Grid View"
                    >
                      <Icon name="grid" />
                    </button>
                    <button
                      type="button"
                      className={`view-mode-btn ${viewMode === 'list' ? 'active' : ''}`}
                      onClick={() => setViewMode('list')}
                      title="มุมมองรายการ (List View)"
                      aria-label="List View"
                    >
                      <Icon name="list" />
                    </button>
                  </div>

                  {/* Sort Select */}
                  <div className="gallery-sort-wrap">
                    <Icon name="sort" />
                    <select
                      className="gallery-sort-select"
                      value={sortBy}
                      onChange={(e) => setSortBy(e.target.value)}
                      aria-label="เรียงลำดับพรอมต์"
                    >
                      <option value="custom">ลำดับที่จัดไว้</option>
                      <option value="latest">ล่าสุดก่อน</option>
                      <option value="favorite">รายการโปรดก่อน</option>
                      <option value="az">ชื่อ ก–ฮ</option>
                    </select>
                  </div>

                  <button
                    type="button"
                    className="primary-button compact-button"
                    onClick={() => {
                      setEditorItem({
                        ...emptyForm,
                        category: categoryFilter === 'all' ? 'main' : categoryFilter,
                        folder: activeFolderDefault,
                      })
                      setPage('add')
                    }}
                  >
                    <Icon name="add" />
                    <span>
                      {activeFolderDefault ? `เพิ่มใน “${activeFolderDefault}”` : 'เพิ่มพรอมต์'}
                    </span>
                  </button>
                </div>
              </div>

              {shownItems.length ? (
                <>
                  <div className={`prompt-grid ${viewMode === 'list' ? 'list-view' : ''}`}>
                    {(paginateGallery
                      ? shownItems.slice((galleryPage - 1) * 12, galleryPage * 12)
                      : shownItems
                    ).map((item, index) => (
                      <PromptCard
                        item={item}
                        index={paginateGallery ? (galleryPage - 1) * 12 + index : index}
                        totalShown={shownItems.length}
                        folders={
                          categoryFilter !== 'all'
                            ? (foldersByCategory[categoryFilter] || [])
                            : (foldersByCategory[item.category]?.length ? foldersByCategory[item.category] : allFolders)
                        }
                        key={item.id}
                        isDragging={draggedId === item.id}
                        isDragOver={dragOverCardId === item.id}
                        onDragStart={handleCardDragStart}
                        onDragOver={handleCardDragOver}
                        onDragLeave={handleCardDragLeave}
                        onDrop={handleCardDrop}
                        onDragEnd={handleCardDragEnd}
                        onMoveStep={moveCardStep}
                        onMoveToFolder={moveItemToFolder}
                        onCreateAndMoveFolder={createAndMoveToFolder}
                        onMoveToCategory={moveItemToCategory}
                        onFolderClick={handleFolderClick}
                        onCopy={copyPrompt}
                        onEdit={handleEditItem}
                        onDelete={deleteItem}
                        onFavorite={toggleFavorite}
                        onOpen={handleOpenItem}
                        onTagClick={handleTagClick}
                      />
                    ))}
                  </div>

                  {/* Pagination Bar (ตามแบบ Reference UI Components) */}
                  {shownItems.length > 12 && (
                    <div className="soft-pagination-bar" role="navigation" aria-label="การแบ่งหน้าพรอมต์">
                      <div className="pagination-pages">
                        <button
                          type="button"
                          className="page-arrow-btn"
                          disabled={!paginateGallery || galleryPage <= 1}
                          onClick={() => {
                            setPaginateGallery(true)
                            setGalleryPage((p) => Math.max(1, p - 1))
                            gallerySectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
                          }}
                          aria-label="หน้าก่อนหน้า"
                        >
                          ‹
                        </button>
                        {Array.from({ length: Math.ceil(shownItems.length / 12) }, (_, i) => i + 1).map((pNum) => (
                          <button
                            type="button"
                            key={pNum}
                            className={`page-num-btn ${paginateGallery && galleryPage === pNum ? 'active' : ''}`}
                            onClick={() => {
                              setPaginateGallery(true)
                              setGalleryPage(pNum)
                              gallerySectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
                            }}
                          >
                            {pNum}
                          </button>
                        ))}
                        <button
                          type="button"
                          className="page-arrow-btn"
                          disabled={paginateGallery && galleryPage >= Math.ceil(shownItems.length / 12)}
                          onClick={() => {
                            const maxPage = Math.ceil(shownItems.length / 12)
                            setPaginateGallery(true)
                            setGalleryPage((p) => Math.min(maxPage, p + 1))
                            gallerySectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
                          }}
                          aria-label="หน้าถัดไป"
                        >
                          ›
                        </button>
                      </div>
                      <button
                        type="button"
                        className={`page-show-all-btn ${!paginateGallery ? 'active' : ''}`}
                        onClick={() => {
                          setPaginateGallery((prev) => !prev)
                          setGalleryPage(1)
                        }}
                      >
                        {!paginateGallery ? `แสดงครบทั้งหมด (${shownItems.length})` : `แสดงทีละหน้า (12/หน้า) • กดเพื่อดูทั้งหมด`}
                      </button>
                    </div>
                  )}
                </>
              ) : (
                <div className="empty-state">
                  <div className="empty-icon">
                    <Icon name={page === 'home' && !hasActiveFilter ? 'star' : folderFilter !== 'all' ? 'folder' : 'prompt'} filled={page === 'home' && !hasActiveFilter} />
                  </div>
                  <h2>
                    {page === 'home' && !hasActiveFilter
                      ? 'ยังไม่มีพรอมต์ที่ติดดาวไว้'
                      : folderFilter !== 'all' && folderFilter !== '__unfiled__'
                      ? `ยังไม่มีพรอมต์ในโฟลเดอร์ “${folderFilter}”`
                      : query || categoryFilter !== 'all' || quickFilter !== 'all' || folderFilter !== 'all'
                      ? 'ไม่พบรายการที่ตรงกับเงื่อนไข'
                      : 'ยังไม่มีพรอมต์ในคลัง'}
                  </h2>
                  <p>
                    {page === 'home' && !hasActiveFilter
                      ? 'คุณสามารถกดที่ไอคอนรูปดาว ⭐ บนการ์ดใดก็ได้ เพื่อนำมาแสดงไว้ในหน้าแรกนี้'
                      : folderFilter !== 'all' && folderFilter !== '__unfiled__'
                      ? 'คุณสามารถกด “ดูทุกโฟลเดอร์” แล้วลากการ์ดมาวางใส่โฟลเดอร์นี้ หรือกดปุ่มเพิ่มพรอมต์ในโฟลเดอร์นี้ได้ทันที'
                      : query || categoryFilter !== 'all' || quickFilter !== 'all'
                      ? 'ลองปรับคำค้นหา หรือกดล้างตัวกรองเพื่อดูรายการทั้งหมด'
                      : 'เริ่มสร้างและจัดเก็บพรอมต์สำหรับงาน AI ภาพและเสียงของคุณได้เลย'}
                  </p>
                  <div className="empty-actions">
                    {page === 'home' && !hasActiveFilter && (
                      <button
                        type="button"
                        className="secondary-button"
                        onClick={() => { setPage('prompts'); setActiveMenu('prompts') }}
                      >
                        <Icon name="prompt" /> ไปที่คลังพรอมต์ทั้งหมด ({items.length})
                      </button>
                    )}
                    {(query || categoryFilter !== 'all' || quickFilter !== 'all' || folderFilter !== 'all') && (
                      <button
                        type="button"
                        className="secondary-button"
                        onClick={() => {
                          setQuery('')
                          setFolderFilter('all')
                          setQuickFilter('all')
                        }}
                      >
                        แสดงพรอมต์ทั้งหมดในหมวดนี้
                      </button>
                    )}
                    <button
                      type="button"
                      className="primary-button"
                      onClick={() => {
                        setEditorItem({
                          ...emptyForm,
                          category: categoryFilter === 'all' ? 'main' : categoryFilter,
                          folder: activeFolderDefault,
                        })
                        setPage('add')
                      }}
                    >
                      <Icon name="add" /> เพิ่มพรอมต์ใหม่
                    </button>
                  </div>
                </div>
              )}
            </section>

            {/* 7. เครื่องมือด่วน (Quick Access Tools Strip ตามแบบ Visual Reference) */}
            <section className="section-block quick-tools-section">
              <div className="section-heading">
                <h2>
                  <Icon name="wrench" />
                  <span>เครื่องมือด่วน</span>
                </h2>
              </div>
              <div className="quick-tools-strip">
                <a
                  href="https://miximageai.online/"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="quick-tool-card primary-tool"
                >
                  <div className="qt-icon sage"><Icon name="image" /></div>
                  <div className="qt-info">
                    <strong>สร้างภาพ</strong>
                    <span>GPT-2.5 (Firefly)</span>
                  </div>
                </a>
                <a
                  href="https://mix-music.netlify.app/"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="quick-tool-card"
                >
                  <div className="qt-icon amber"><Icon name="music" /></div>
                  <div className="qt-info">
                    <strong>สร้างเสียง</strong>
                    <span>SunoAI v5</span>
                  </div>
                </a>
                <a
                  href="https://miximage-lyric.netlify.app/"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="quick-tool-card"
                >
                  <div className="qt-icon slate"><Icon name="note" /></div>
                  <div className="qt-info">
                    <strong>เขียนสคริปต์</strong>
                    <span>Google AI Studio</span>
                  </div>
                </a>
                <a
                  href="https://www.canva.com/"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="quick-tool-card"
                >
                  <div className="qt-icon teal"><Icon name="sparkles" /></div>
                  <div className="qt-info">
                    <strong>ตัดต่อวิดีโอ</strong>
                    <span>Canva</span>
                  </div>
                </a>
                <button
                  type="button"
                  className="quick-tool-card"
                  onClick={syncData}
                >
                  <div className="qt-icon drive"><Icon name="cloud" /></div>
                  <div className="qt-info">
                    <strong>เชื่อมต่อ Drive</strong>
                    <span>Google Drive / Cloud</span>
                  </div>
                </button>
              </div>
            </section>
          </>
        )}

        {page === 'ai-tools' && (
          <section className="section-block">
            <div className="section-heading">
              <h2>
                <Icon name="wrench" />
                <span>เครื่องมือ AI และระบบในเครือ MIX-IMAGE</span>
                <span className="count-tag">({externalLinksTopToBottom.length})</span>
              </h2>
            </div>
            <div className="profile-links-grid">
              {externalLinksTopToBottom.map((link) => (
                <a
                  key={link.id}
                  href={link.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={`sidebar-link-btn accent-${link.color}`}
                >
                  <span className={`sidebar-link-dot dot-${link.color}`} />
                  <div className="sidebar-link-text">
                    <strong>{link.sub}</strong>
                    <span>{link.label}</span>
                  </div>
                  <Icon name="external" className="sidebar-link-arrow" />
                </a>
              ))}
            </div>
          </section>
        )}

        {page === 'reports' && (
          <section className="section-block">
            <div className="section-heading">
              <h2>
                <Icon name="chart" />
                <span>สรุปรายงานคลังพรอมต์ (Workspace Analytics)</span>
              </h2>
            </div>
            <div className="stat-grid stat-grid-5">
              <StatCard icon="prompt" label="พรอมต์ทั้งหมด" value={items.length} tone="purple" onClick={() => handleSelectMenu('prompts')} />
              <StatCard icon="tag" label="หมวดหมู่" value={categories.length - 1} tone="blue" onClick={() => handleSelectMenu('categories')} />
              <StatCard icon="folder" label="โปรเจกต์ / โฟลเดอร์" value={allFolders.length} tone="green" onClick={() => handleSelectMenu('projects')} />
              <StatCard icon="heart" label="รายการโปรด" value={favoritesCount} tone="orange" onClick={() => handleSelectMenu('favorites')} />
              <StatCard icon="image" label="มีภาพตัวอย่าง" value={imagesCount} tone="cyan" onClick={() => { setPage('prompts'); setQuickFilter('hasImage') }} />
            </div>
            <div className="category-visual-grid" style={{ marginTop: '1.25rem' }}>
              {categories.filter((c) => c.id !== 'all').map((cat) => {
                const count = items.filter((it) => it.category === cat.id).length
                return (
                  <div key={cat.id} className="category-visual-card" onClick={() => { setCategoryFilter(cat.id); setPage('prompts') }}>
                    <div className={`cat-visual-thumb tone-${cat.color}`}>
                      <Icon name={cat.icon} />
                    </div>
                    <strong className="cat-visual-title">{cat.label}</strong>
                    <small className="cat-visual-count">{count} พรอมต์ ({items.length ? Math.round((count / items.length) * 100) : 0}%)</small>
                  </div>
                )
              })}
            </div>
          </section>
        )}

        {page === 'savings' && (
          <SavingsPage flash={flash} />
        )}

        {page === 'profile' && (
          <>
            <section className="profile-panel">
              <img src="./brand/jongjang-mascot.png" alt="จ๋องแจ๋ง ผู้ช่วย MIX-IMAGE" decoding="async" />
              <div>
                <p className="eyebrow">OWNER PROFILE</p>
                <h2>MIX NATTANON</h2>
                <p className="profile-bio">
                  MIX-IMAGE Art &amp; Audio — คลังเก็บไอเดีย พรอมต์ งานภาพ และเสียงสังเคราะห์สำหรับงาน AI Production
                </p>
                <div className="profile-stats-row">
                  <div className="profile-stat-item">
                    <span>พรอมต์ทั้งหมด</span>
                    <strong>{items.length}</strong>
                  </div>
                  <div className="profile-stat-item">
                    <span>โฟลเดอร์ทั้งหมด</span>
                    <strong>{allFolders.length}</strong>
                  </div>
                  <div className="profile-stat-item">
                    <span>รายการโปรด</span>
                    <strong>{favoritesCount}</strong>
                  </div>
                  <div className="profile-stat-item">
                    <span>สถานะคลาวด์</span>
                    <strong className="cloud-note"><Icon name="cloud" /> {cloudState}</strong>
                  </div>
                </div>
                <div className="profile-actions">
                  <button
                    type="button"
                    className="secondary-button"
                    onClick={syncData}
                    disabled={isSyncing}
                  >
                    <Icon name="sync" /> ซิงค์ข้อมูลกับ Firebase
                  </button>
                  <button
                    type="button"
                    className="danger-button"
                    onClick={() => {
                      clearUnlock()
                      setUnlocked(false)
                    }}
                  >
                    <Icon name="logout" /> ออกจากระบบ
                  </button>
                </div>
              </div>
            </section>

            {/* ส่วนดาวน์โหลดแอปสำหรับคอมพิวเตอร์และมือถือ */}
            <section className="profile-downloads-card">
              <div className="profile-downloads-header">
                <div className="profile-downloads-title-box">
                  <div className="downloads-icon-bubble">
                    <Icon name="download" />
                  </div>
                  <div>
                    <h2>แอปพลิเคชันสำหรับติดตั้งลงเครื่อง (Desktop &amp; Mobile)</h2>
                    <p>ติดตั้งโปรแกรมลงคอมพิวเตอร์ Windows หรือมือถือ Android ใช้งานเต็มหน้าจอและอัปเดตข้อมูลอัตโนมัติ</p>
                  </div>
                </div>
                <button
                  type="button"
                  className="profile-open-downloads-btn"
                  onClick={() => setShowDownloadModal(true)}
                >
                  <Icon name="download" />
                  <span>เปิดหน้าต่างดาวน์โหลด</span>
                </button>
              </div>

              <div className="profile-downloads-grid">
                <div className="profile-dl-item win" onClick={() => setShowDownloadModal(true)}>
                  <div className="dl-item-top">
                    <span className="dl-os-icon win"><Icon name="windows" /></span>
                    <span className="dl-os-badge">Windows .exe</span>
                  </div>
                  <h3>Windows Desktop App</h3>
                  <p>สำหรับ Windows 10/11 (64-bit) รวดเร็ว มีไอคอนบน Desktop</p>
                  <div className="dl-item-action">
                    <span>เปิดดาวน์โหลด .exe ↗</span>
                  </div>
                </div>

                <div className="profile-dl-item android" onClick={() => setShowDownloadModal(true)}>
                  <div className="dl-item-top">
                    <span className="dl-os-icon android"><Icon name="android" /></span>
                    <span className="dl-os-badge">Android .apk / PWA</span>
                  </div>
                  <h3>Android Mobile App</h3>
                  <p>สำหรับสมาร์ตโฟน Android ติดตั้งลงเครื่องเหมือนแอปแท้</p>
                  <div className="dl-item-action">
                    <span>เปิดดาวน์โหลด APK ↗</span>
                  </div>
                </div>
              </div>
            </section>

            <section className="section-block">
              <div className="section-heading">
                <h2>
                  <Icon name="globe" /> เว็บและเครื่องมือในเครือ MIX-IMAGE
                  <span className="count-tag">({externalLinksTopToBottom.length})</span>
                </h2>
              </div>
              <div className="profile-links-grid">
                {externalLinksTopToBottom.map((link) => (
                  <a
                    key={link.id}
                    href={link.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={`sidebar-link-btn accent-${link.color}`}
                  >
                    <span className={`sidebar-link-dot dot-${link.color}`} />
                    <div className="sidebar-link-text">
                      <strong>{link.sub}</strong>
                      <span>{link.label}</span>
                    </div>
                    <Icon name="external" className="sidebar-link-arrow" />
                  </a>
                ))}
              </div>
            </section>
          </>
        )}

        {page === 'add' && !editorItem && (
          <div className="empty-state">
            <h2>พร้อมเพิ่มพรอมต์</h2>
            <button
              type="button"
              className="primary-button"
              onClick={() =>
                setEditorItem({
                  ...emptyForm,
                  category: categoryFilter === 'all' ? 'main' : categoryFilter,
                  folder: activeFolderDefault,
                })
              }
            >
              <Icon name="add" /> เปิดฟอร์มเพิ่มพรอมต์
            </button>
          </div>
        )}
      </main>

      <MobileNav
        page={page}
        activeMenu={activeMenu}
        onSelectMenu={handleSelectMenu}
        onAdd={() => {
          setEditorItem({
            ...emptyForm,
            category: categoryFilter === 'all' ? 'main' : categoryFilter,
            folder: activeFolderDefault,
          })
          setPage('add')
        }}
      />

      {editorItem && (
        <PromptEditor
          item={editorItem}
          folders={allFolders}
          defaultCategory={editorItem?.category || (categoryFilter === 'all' ? 'main' : categoryFilter)}
          defaultFolder={editorItem?.folder || activeFolderDefault}
          onClose={() => { setEditorItem(null); setPage('home') }}
          onSave={saveItem}
        />
      )}

      {detailItem && (
        <DetailModal
          item={detailItem}
          folders={foldersByCategory[detailItem.category] || []}
          onClose={() => setDetailItem(null)}
          onCopy={copyPromptText}
          onEdit={(current) => { setDetailItem(null); setEditorItem(current); setPage('add') }}
          onDelete={deleteItem}
          onLightbox={(url) => setLightboxImage(url)}
          onMoveToCategory={moveItemToCategory}
          onMoveToFolder={moveItemToFolder}
        />
      )}

      {lightboxImage && (
        <Lightbox imageUrl={lightboxImage} onClose={() => setLightboxImage(null)} />
      )}

      {showDownloadModal && (
        <AppDownloadModal
          onClose={() => setShowDownloadModal(false)}
          deferredPrompt={deferredPrompt}
          onInstallPwa={handleInstallPwa}
          flash={flash}
        />
      )}

      {deleteConfirmItem && (
        <div className="modal-backdrop confirm-modal-backdrop" onClick={() => setDeleteConfirmItem(null)}>
          <div className="soft-confirm-modal" role="alertdialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
            <button
              type="button"
              className="confirm-close-x"
              onClick={() => setDeleteConfirmItem(null)}
              aria-label="ปิดหน้าต่างยืนยัน"
            >
              <Icon name="close" />
            </button>
            <div className="confirm-modal-row">
              <div className="confirm-trash-badge">
                <Icon name="trash" />
              </div>
              <div className="confirm-modal-text">
                <h3>ยืนยันการลบพรอมต์?</h3>
                <p>
                  คุณต้องการลบ <strong>“{deleteConfirmItem.title}”</strong> หรือไม่ การดำเนินการนี้ไม่สามารถย้อนกลับได้
                </p>
              </div>
            </div>
            <div className="confirm-modal-actions">
              <button
                type="button"
                className="secondary-button confirm-cancel-btn"
                onClick={() => setDeleteConfirmItem(null)}
              >
                ยกเลิก
              </button>
              <button
                type="button"
                className="primary-button confirm-delete-btn"
                onClick={confirmDeleteItem}
              >
                ลบ
              </button>
            </div>
          </div>
        </div>
      )}

      {toast && (
        <div className="toast-message" role="status">
          <div className="toast-icon-circle">
            <Icon name="check" />
          </div>
          <span>{toast}</span>
          <button type="button" className="toast-close-btn" onClick={() => setToast('')} aria-label="ปิดการแจ้งเตือน">
            <Icon name="close" />
          </button>
        </div>
      )}
    </div>
  )
}

export default App
