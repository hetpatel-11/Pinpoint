/**
 * Pinpoint — visual annotation overlay for any website.
 *
 * To use on your own project instead of the demo:
 *   1. Import PinpointOverlay from this file (or move it to its own file)
 *   2. Wrap your app's root component:
 *        <PinpointOverlay><YourApp /></PinpointOverlay>
 *   3. Run `npm run dev:api` so annotations are saved to disk
 *   4. Run `npm run mcp` so your AI coding agent can read them via MCP
 *
 * No data-annotate attributes needed — the selector builder works on any DOM element.
 */

import { useEffect, useRef, useState } from 'react'
import './App.css'
import {
  buildBatchPrompt,
  createEmptyReviewState,
  createId,
  DEMO_PAGE_NAME,
  DEMO_PAGE_ROUTE,
  type Annotation,
  type ReviewState,
} from './shared/review'

// ─── Utilities ────────────────────────────────────────────────────────────────

/**
 * Builds a CSS selector path for any DOM element.
 * Works without any data-annotate attributes.
 * Stops early at IDs or data-annotate anchors.
 * Keeps paths short (max 5 segments) so they're grep-able in source.
 */
function buildSelector(target: HTMLElement): string {
  if (!target || target.tagName === 'BODY' || target.tagName === 'HTML') return 'body'

  // Fast path: stable unique anchors
  if (target.dataset.annotate) return `[data-annotate="${target.dataset.annotate}"]`
  if (target.id && !/^:/.test(target.id)) return `#${target.id}`

  const segments: string[] = []
  let el: HTMLElement | null = target

  while (el && el.tagName !== 'BODY' && el.tagName !== 'HTML' && segments.length < 5) {
    // Anchor on stable identifiers and stop climbing
    if (el.dataset.annotate) {
      segments.unshift(`[data-annotate="${el.dataset.annotate}"]`)
      break
    }
    if (el.id && !/^:/.test(el.id)) {
      segments.unshift(`#${el.id}`)
      break
    }

    const tag = el.tagName.toLowerCase()

    // Prefer semantic class names (contain hyphens/underscores — not hashes or Tailwind utilities)
    const semanticClasses = Array.from(el.classList).filter(
      (c) => (c.includes('-') || c.includes('_')) && c.length < 40 && !/^[a-f0-9]{5,}$/.test(c),
    )

    let segment = semanticClasses.length > 0 ? `${tag}.${semanticClasses[0]}` : tag

    // Add :nth-of-type when multiple siblings share the same tag
    const parent = el.parentElement
    if (parent) {
      const sameTag = Array.from(parent.children).filter((c) => c.tagName === el!.tagName)
      if (sameTag.length > 1) {
        segment += `:nth-of-type(${sameTag.indexOf(el) + 1})`
      }
    }

    segments.unshift(segment)
    el = el.parentElement
  }

  return segments.join(' > ') || target.tagName.toLowerCase()
}

function getLabel(el: HTMLElement): string {
  return (
    el.getAttribute('data-label') ??
    el.getAttribute('aria-label') ??
    el.getAttribute('data-annotate') ??
    (el.id && !/^:/.test(el.id) ? `#${el.id}` : null) ??
    Array.from(el.classList).find((c) => c.includes('-') || c.includes('_')) ??
    ((el.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 40) ||
    el.tagName.toLowerCase()
    )
  )
}

// ─── API helpers ──────────────────────────────────────────────────────────────

async function fetchReviewState(): Promise<ReviewState> {
  const res = await fetch('/api/review-state')
  if (!res.ok) throw new Error('Failed to load')
  return res.json()
}

async function saveReviewState(state: ReviewState): Promise<void> {
  const res = await fetch('/api/review-state', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(state),
  })
  if (!res.ok) throw new Error('Failed to save')
}

// ─── PinpointOverlay ──────────────────────────────────────────────────────────

type SyncStatus = 'loading' | 'ready' | 'saving' | 'error'

interface PinpointOverlayProps {
  children: React.ReactNode
}

export function PinpointOverlay({ children }: PinpointOverlayProps) {
  const [annotations, setAnnotations] = useState<Annotation[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [isDragOver, setIsDragOver] = useState(false)
  const [syncStatus, setSyncStatus] = useState<SyncStatus>('loading')
  const [hasHydrated, setHasHydrated] = useState(false)
  const [copied, setCopied] = useState(false)
  const [copiedPrompt, setCopiedPrompt] = useState(false)
  const [popoverPos, setPopoverPos] = useState({ x: 0, y: 0 })
  const [showExport, setShowExport] = useState(false)
  const canvasRef = useRef<HTMLDivElement>(null)

  // ── Load saved annotations ───────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false
    fetchReviewState()
      .then((state) => {
        if (cancelled) return
        setAnnotations(state.annotations)
        setSelectedId(state.selectedId ?? null)
        setSyncStatus('ready')
        setHasHydrated(true)
      })
      .catch(() => {
        if (cancelled) return
        setAnnotations(createEmptyReviewState().annotations)
        setSyncStatus('error')
        setHasHydrated(true)
      })
    return () => { cancelled = true }
  }, [])

  // ── Auto-save (debounced 300ms) ───────────────────────────────────────────
  useEffect(() => {
    if (!hasHydrated) return
    const t = window.setTimeout(() => {
      const state: ReviewState = {
        page: {
          name: DEMO_PAGE_NAME,
          route: DEMO_PAGE_ROUTE,
          capturedAt: new Date().toISOString(),
          viewport: {
            width: canvasRef.current?.scrollWidth ?? 0,
            height: canvasRef.current?.scrollHeight ?? 0,
          },
        },
        annotations,
        selectedId,
      }
      setSyncStatus('saving')
      saveReviewState(state)
        .then(() => setSyncStatus('ready'))
        .catch(() => setSyncStatus('error'))
    }, 300)
    return () => window.clearTimeout(t)
  }, [annotations, selectedId, hasHydrated])

  useEffect(() => {
    if (!copied) return
    const t = window.setTimeout(() => setCopied(false), 1500)
    return () => window.clearTimeout(t)
  }, [copied])

  useEffect(() => {
    if (!copiedPrompt) return
    const t = window.setTimeout(() => setCopiedPrompt(false), 1500)
    return () => window.clearTimeout(t)
  }, [copiedPrompt])

  const selectedAnnotation = annotations.find((a) => a.id === selectedId) ?? null

  const reviewPayload: ReviewState = {
    page: {
      name: DEMO_PAGE_NAME,
      route: DEMO_PAGE_ROUTE,
      capturedAt: new Date().toISOString(),
      viewport: {
        width: canvasRef.current?.scrollWidth ?? 0,
        height: canvasRef.current?.scrollHeight ?? 0,
      },
    },
    annotations,
    selectedId,
  }

  // ── Drag handlers ─────────────────────────────────────────────────────────
  function handleDragStart(e: React.DragEvent) {
    e.dataTransfer.effectAllowed = 'copy'
    e.dataTransfer.setData('application/new-pin', '1')

    // Custom blue ghost image
    const ghost = document.createElement('div')
    ghost.style.cssText = `
      position:fixed;top:-200px;left:-200px;
      width:30px;height:30px;border-radius:50% 50% 50% 0;
      transform:rotate(-45deg);background:#3b82f6;border:2px solid #fff;
      box-shadow:0 2px 8px rgba(0,0,0,.4);
    `
    document.body.appendChild(ghost)
    e.dataTransfer.setDragImage(ghost, 15, 28)
    setTimeout(() => document.body.removeChild(ghost), 0)
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault()
    setIsDragOver(false)
    if (!e.dataTransfer.getData('application/new-pin')) return

    const canvas = canvasRef.current!
    const rect = canvas.getBoundingClientRect()
    const scrollTop = canvas.scrollTop
    const pinX = e.clientX - rect.left
    const pinY = e.clientY - rect.top + scrollTop

    // Find the most specific real-content element at the drop point.
    // elementsFromPoint returns front-to-back; we skip our own overlay elements.
    const stack = document.elementsFromPoint(e.clientX, e.clientY) as HTMLElement[]
    const el =
      stack.find(
        (n) =>
          !n.hasAttribute('data-pinpoint') &&
          !n.classList.contains('pp-canvas') &&
          !n.classList.contains('pp-pins') &&
          !n.classList.contains('pin') &&
          !n.classList.contains('status-bar') &&
          !n.classList.contains('popover') &&
          n.tagName !== 'HTML' &&
          n.tagName !== 'BODY',
      ) ?? canvas

    const elRect = el.getBoundingClientRect()
    const selector = buildSelector(el)
    const label = getLabel(el)

    const annotation: Annotation = {
      id: createId(),
      comment: '',
      x: pinX,
      y: pinY,
      targetLabel: label,
      selector,
      tagName: el.tagName.toLowerCase(),
      textSnippet: (el.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 160),
      htmlSnippet: el.outerHTML.slice(0, 240),
      viewport: {
        width: Math.round(rect.width),
        height: Math.round(rect.height + scrollTop),
      },
      bounds: {
        left: Math.round(elRect.left - rect.left),
        top: Math.round(elRect.top - rect.top + scrollTop),
        width: Math.round(elRect.width),
        height: Math.round(elRect.height),
      },
      createdAt: new Date().toISOString(),
    }

    setAnnotations((prev) => [...prev, annotation])
    setSelectedId(annotation.id)
    setPopoverPos({
      x: Math.min(e.clientX + 20, window.innerWidth - 330),
      y: Math.max(e.clientY - 130, 16),
    })
  }

  // ── Pin click ─────────────────────────────────────────────────────────────
  function handlePinClick(e: React.MouseEvent, id: string) {
    e.stopPropagation()
    if (selectedId === id) { setSelectedId(null); return }
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
    setSelectedId(id)
    setPopoverPos({
      x: Math.min(r.right + 10, window.innerWidth - 330),
      y: Math.max(r.top - 60, 16),
    })
  }

  function handleStatusPinClick(e: React.MouseEvent, id: string) {
    e.stopPropagation()
    if (selectedId === id) { setSelectedId(null); return }
    const ann = annotations.find((a) => a.id === id)
    if (!ann || !canvasRef.current) return
    const rect = canvasRef.current.getBoundingClientRect()
    canvasRef.current.scrollTo({ top: ann.y - 200, behavior: 'smooth' })
    setSelectedId(id)
    setPopoverPos({
      x: Math.min(ann.x + rect.left + 20, window.innerWidth - 330),
      y: Math.max(ann.y - canvasRef.current.scrollTop + rect.top - 130, 16),
    })
  }

  // ── Annotation mutations ──────────────────────────────────────────────────
  function updateComment(id: string, comment: string) {
    setAnnotations((prev) => prev.map((a) => (a.id === id ? { ...a, comment } : a)))
  }

  function removeAnnotation(id: string) {
    setAnnotations((prev) => prev.filter((a) => a.id !== id))
    setSelectedId(null)
  }

  async function copyPrompt() {
    await navigator.clipboard.writeText(buildBatchPrompt(reviewPayload))
    setCopiedPrompt(true)
  }

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="pp-root" data-pinpoint onClick={() => setSelectedId(null)}>

      {/* Scrollable canvas — wraps the real site content */}
      <div
        ref={canvasRef}
        className={`pp-canvas${isDragOver ? ' drag-over' : ''}`}
        onDragOver={(e) => { e.preventDefault(); setIsDragOver(true) }}
        onDragLeave={(e) => {
          if (!canvasRef.current?.contains(e.relatedTarget as Node)) setIsDragOver(false)
        }}
        onDrop={handleDrop}
      >
        {children}

        {/* Pin markers — positioned relative to scrollable canvas */}
        <div className="pp-pins">
          {annotations.map((ann, i) => (
            <button
              key={ann.id}
              className={`pin${ann.id === selectedId ? ' pin-active' : ''}${!ann.comment ? ' pin-empty' : ''}`}
              style={{ left: ann.x, top: ann.y }}
              onClick={(e) => handlePinClick(e, ann.id)}
              title={ann.comment || 'Click to add comment'}
              data-pin-ui="true"
            >
              <span>{i + 1}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Comment popover */}
      {selectedAnnotation && (
        <div
          className="popover"
          style={{ left: popoverPos.x, top: popoverPos.y }}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="popover-header">
            <span className="popover-badge">
              {annotations.findIndex((a) => a.id === selectedAnnotation.id) + 1}
            </span>
            <span className="popover-target" title={selectedAnnotation.targetLabel}>
              {selectedAnnotation.targetLabel}
            </span>
            <button className="popover-close" onClick={() => setSelectedId(null)}>×</button>
          </div>
          <textarea
            className="popover-textarea"
            placeholder="Describe what needs to change…"
            value={selectedAnnotation.comment}
            onChange={(e) => updateComment(selectedAnnotation.id, e.target.value)}
            autoFocus
          />
          <div className="popover-selector">
            <code title="CSS selector — this is what the agent uses to find the element">
              {selectedAnnotation.selector}
            </code>
          </div>
          <div className="popover-bounds">
            <span>↔ {selectedAnnotation.bounds.width}px</span>
            <span>↕ {selectedAnnotation.bounds.height}px</span>
            <span>@ {selectedAnnotation.bounds.left}, {selectedAnnotation.bounds.top}</span>
          </div>
          <div className="popover-actions">
            <button className="popover-del" onClick={() => removeAnnotation(selectedAnnotation.id)}>
              Delete
            </button>
            <button className="popover-done" onClick={() => setSelectedId(null)}>
              Done
            </button>
          </div>
        </div>
      )}

      {/* Export panel */}
      {showExport && (
        <div className="export-panel" onClick={(e) => e.stopPropagation()}>
          <div className="export-panel-header">
            <span>Export for agent</span>
            <button className="popover-close" onClick={() => setShowExport(false)}>×</button>
          </div>
          <p className="export-label">Agent prompt — paste into JetBrains AI Chat or any LLM</p>
          <pre className="export-pre">{buildBatchPrompt(reviewPayload)}</pre>
          <p className="export-label" style={{ marginTop: 12 }}>Full JSON — read by MCP server automatically</p>
          <pre className="export-pre">{JSON.stringify(reviewPayload, null, 2)}</pre>
        </div>
      )}

      {/* Floating status bar */}
      <div className="status-bar" onClick={(e) => e.stopPropagation()}>

        <div className="status-brand">
          <PinIcon />
          <span className="status-logo">Pinpoint</span>
          <span className={`status-dot status-dot--${syncStatus}`} title={syncStatus} />
        </div>

        <div className="status-sep" />

        <div className="status-pins">
          {annotations.length === 0 ? (
            <span className="status-hint">Drag a pin to annotate</span>
          ) : (
            annotations.map((ann, i) => (
              <button
                key={ann.id}
                className={`status-chip${ann.id === selectedId ? ' active' : ''}${!ann.comment ? ' muted' : ''}`}
                onClick={(e) => handleStatusPinClick(e, ann.id)}
                title={ann.comment || `Pin ${i + 1} — no comment yet`}
              >
                {i + 1}
                {ann.comment && <span className="chip-dot" />}
              </button>
            ))
          )}
        </div>

        <div className="status-sep" />

        <div className="status-actions">
          {annotations.length > 0 && (
            <>
              <button
                className="status-btn"
                onClick={copyPrompt}
                title="Copy agent-ready prompt — paste into JetBrains AI Chat"
              >
                {copiedPrompt ? <CheckIcon /> : <PromptIcon />}
                {copiedPrompt ? 'Copied!' : 'Copy Prompt'}
              </button>
              <button
                className="status-btn status-btn--ghost"
                onClick={() => { setShowExport(v => !v); setSelectedId(null) }}
                title="View full structured JSON export"
              >
                <JsonIcon />
                {showExport ? 'Hide' : 'JSON'}
              </button>
            </>
          )}
          <div
            className="add-pin-btn"
            draggable
            onDragStart={handleDragStart}
            onDragEnd={() => setIsDragOver(false)}
            title="Drag onto the page to place a pin"
          >
            <PinIcon />
            Add Pin
          </div>
        </div>

      </div>
    </div>
  )
}

// ─── Demo website ─────────────────────────────────────────────────────────────
// Replace this with <YourApp /> to use Pinpoint on your own project.

function DemoWebsite() {
  return (
    <div className="site" data-annotate="site-root">

      <nav className="site-nav" data-annotate="nav" data-label="Navigation bar">
        <div className="site-nav-inner">
          <a className="site-logo" data-annotate="logo" data-label="Logo">The Reading Room</a>
          <div className="site-nav-links" data-annotate="nav-links" data-label="Nav links">
            <a data-annotate="nav-browse" data-label="Browse link">Browse</a>
            <a data-annotate="nav-new" data-label="New arrivals link">New Arrivals</a>
            <a data-annotate="nav-events" data-label="Events link">Events</a>
            <a data-annotate="nav-about" data-label="About link">About</a>
          </div>
          <div className="site-nav-right">
            <a className="site-nav-cart" data-annotate="cart" data-label="Cart">🛒 Cart (0)</a>
          </div>
        </div>
      </nav>

      <section className="site-hero" data-annotate="hero" data-label="Hero section">
        <div className="site-hero-inner">
          <p className="site-eyebrow" data-annotate="eyebrow" data-label="Eyebrow text">Independent · Est. 1987</p>
          <h1 data-annotate="hero-heading" data-label="Hero heading">A bookshop worth getting lost in.</h1>
          <p className="site-hero-sub" data-annotate="hero-sub" data-label="Hero subtitle">
            We hand-pick every title on our shelves. No algorithms, no bestseller lists — just
            good books, recommended by people who love them.
          </p>
          <div className="site-hero-actions" data-annotate="hero-actions" data-label="Hero buttons">
            <a className="site-btn-dark" data-annotate="browse-btn" data-label="Browse button">Browse the shelves</a>
            <a className="site-btn-outline" data-annotate="events-btn" data-label="Events button">Upcoming events</a>
          </div>
        </div>
        <div className="site-hero-shelf" data-annotate="hero-shelf" data-label="Book shelf visual">
          {['#d4a373', '#a2855d', '#6b4f3a', '#c9785a', '#8b6347', '#d4956a'].map((c, i) => (
            <div key={i} className="site-book" style={{ background: c }} data-annotate={`book-spine-${i}`} data-label={`Book spine ${i + 1}`} />
          ))}
        </div>
      </section>

      <section className="site-section" data-annotate="staff-picks" data-label="Staff picks section">
        <div className="site-section-inner">
          <div className="site-section-header">
            <h2 data-annotate="staff-heading" data-label="Staff picks heading">Staff picks this month</h2>
            <a className="site-link" data-annotate="view-all" data-label="View all link">View all →</a>
          </div>
          <div className="site-books-grid" data-annotate="books-grid" data-label="Books grid">
            {[
              { color: '#c9a87c', title: 'Bewilderment', author: 'Richard Powers', blurb: 'A story of a father, a daughter, and the fragile world they inhabit.' },
              { color: '#7a9e7e', title: 'Piranesi', author: 'Susanna Clarke', blurb: 'A beautiful house, infinite halls, and a mystery at its heart.' },
              { color: '#8faec9', title: 'Tomorrow, and Tomorrow', author: 'Gabrielle Zevin', blurb: 'A sweeping story of creativity, love and friendship.' },
              { color: '#c97a7a', title: 'The Covenant of Water', author: 'Abraham Verghese', blurb: 'Three generations of a South Indian family across 77 years.' },
            ].map((book, i) => (
              <div key={i} className="site-book-card" data-annotate={`book-card-${i}`} data-label={`${book.title} card`}>
                <div className="site-book-cover" style={{ background: book.color }} data-annotate={`book-cover-${i}`} data-label={`${book.title} cover`} />
                <div className="site-book-info">
                  <p className="site-book-title" data-annotate={`book-title-${i}`} data-label={`${book.title} title`}>{book.title}</p>
                  <p className="site-book-author" data-annotate={`book-author-${i}`} data-label={`${book.title} author`}>{book.author}</p>
                  <p className="site-book-blurb">{book.blurb}</p>
                  <a className="site-book-link" data-annotate={`book-cta-${i}`} data-label={`${book.title} add to cart`}>Add to cart →</a>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="site-section site-section-tinted" data-annotate="events" data-label="Events section">
        <div className="site-section-inner">
          <h2 data-annotate="events-heading" data-label="Events heading">Upcoming events</h2>
          <div className="site-events-list" data-annotate="events-list" data-label="Events list">
            {[
              { date: 'Jun 12', day: 'Thursday', title: 'Reading circle: Piranesi', time: '6:30 pm', type: 'Reading Group' },
              { date: 'Jun 19', day: 'Thursday', title: 'Author talk: Yaa Gyasi', time: '7:00 pm', type: 'Author Event' },
              { date: 'Jun 22', day: 'Sunday', title: "Children's story hour", time: '11:00 am', type: 'Family' },
              { date: 'Jun 28', day: 'Saturday', title: 'Summer reading kickoff', time: '2:00 pm', type: 'Community' },
            ].map((ev, i) => (
              <div key={i} className="site-event" data-annotate={`event-${i}`} data-label={`Event: ${ev.title}`}>
                <div className="site-event-date">
                  <span className="site-event-day-name">{ev.day.slice(0, 3)}</span>
                  <span className="site-event-day-num">{ev.date.split(' ')[1]}</span>
                </div>
                <div className="site-event-body">
                  <p className="site-event-title" data-annotate={`event-title-${i}`} data-label={`Event title: ${ev.title}`}>{ev.title}</p>
                  <p className="site-event-meta">{ev.time} · {ev.type}</p>
                </div>
                <a className="site-event-rsvp" data-annotate={`event-rsvp-${i}`} data-label={`RSVP: ${ev.title}`}>RSVP</a>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="site-section" data-annotate="newsletter" data-label="Newsletter section">
        <div className="site-section-inner site-newsletter">
          <div>
            <h2 data-annotate="newsletter-heading" data-label="Newsletter heading">Get our monthly reading list</h2>
            <p data-annotate="newsletter-sub" data-label="Newsletter subtitle">
              Staff picks, new arrivals and event announcements — no spam, ever.
            </p>
          </div>
          <form className="site-newsletter-form" onSubmit={(e) => e.preventDefault()} data-annotate="newsletter-form" data-label="Newsletter form">
            <input type="email" placeholder="your@email.com" className="site-newsletter-input" data-annotate="newsletter-input" data-label="Email input" />
            <button type="submit" className="site-btn-dark" data-annotate="newsletter-submit" data-label="Subscribe button">Subscribe</button>
          </form>
        </div>
      </section>

      <footer className="site-footer" data-annotate="footer" data-label="Footer">
        <div className="site-footer-inner">
          <div>
            <p className="site-footer-logo" data-annotate="footer-logo" data-label="Footer logo">The Reading Room</p>
            <p className="site-footer-address" data-annotate="footer-address" data-label="Store address">
              42 Ellsworth Ave, Cambridge, MA<br />
              Mon–Sat 9am–8pm · Sun 10am–6pm
            </p>
          </div>
          <div className="site-footer-cols" data-annotate="footer-links" data-label="Footer links">
            <div>
              <p className="site-footer-col-head">Shop</p>
              {['Fiction', 'Non-fiction', "Children's", 'Gift cards'].map((l) => <a key={l}>{l}</a>)}
            </div>
            <div>
              <p className="site-footer-col-head">Visit</p>
              {['Events', 'Reading groups', 'Blog', 'Contact'].map((l) => <a key={l}>{l}</a>)}
            </div>
          </div>
        </div>
        <div className="site-footer-bottom" data-annotate="footer-bottom" data-label="Footer bottom">
          <p>© 2026 The Reading Room. All rights reserved.</p>
          <p><a>Privacy</a> · <a>Terms</a></p>
        </div>
      </footer>

    </div>
  )
}

// ─── App entry point ──────────────────────────────────────────────────────────

export default function App() {
  return (
    <PinpointOverlay>
      <DemoWebsite />
    </PinpointOverlay>
  )
}

// ─── Icons ────────────────────────────────────────────────────────────────────

function PinIcon() {
  return (
    <svg width="11" height="14" viewBox="0 0 12 15" fill="none" aria-hidden="true">
      <path d="M6 0C3.79 0 2 1.79 2 4c0 3 4 9 4 9s4-6 4-9c0-2.21-1.79-4-4-4z" fill="currentColor" />
      <circle cx="6" cy="4" r="1.6" fill="white" />
    </svg>
  )
}

function PromptIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    </svg>
  )
}

function JsonIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polyline points="16 18 22 12 16 6" />
      <polyline points="8 6 2 12 8 18" />
    </svg>
  )
}

function CheckIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  )
}
