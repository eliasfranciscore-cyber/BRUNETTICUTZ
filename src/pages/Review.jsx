import React, { useCallback, useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Emblem, Icon } from '../components/ui.jsx'
import { BARBERS } from '../data.js'
import '../styles/review.css'

/* /resena — la página pública para calificar una visita a Brunetti.

   Se abre desde el correo "Gracias por tu visita" (sendVisitThanksEmail en
   api/_email.js): el link lleva `t` (token de 32 hex, uno por atención
   completada) y a veces `s` (la estrella que el cliente tocó en el correo,
   para dejarla preseleccionada). Sin sesión: todo lo decide el servidor en
   GET/POST /api/barbers?mode=review — el link vale 90 días desde la visita y
   se puede volver a calificar mientras no venza (vale la última).

   Port de la página de PimpStudio con los tokens y el wordmark de Brunetti;
   sin el promedio público ni las tarjetas de barberos. */

const STAR_VALUES = [1, 2, 3, 4, 5]
const COMMENT_MAX = 600
const EXPIRED_MSG = 'Este enlace ya venció. Los enlaces para calificar duran 90 días desde tu visita.'
const INVALID_MSG = 'Este enlace no es válido o ya no está disponible. Revisa que lo hayas abierto completo desde el correo.'

// Brunetti es un solo barbero y el servidor no manda foto (photo: null): se
// usa el avatar de Bruno cuando la reseña es suya; cualquier otro nombre cae
// a las iniciales, como en PimpStudio.
const BRUNO = BARBERS.find((b) => b.id === 6)
function photoFor(barber) {
  if (barber?.photo) return barber.photo
  const label = `${barber?.name || ''} ${barber?.short || ''}`
  return /brun/i.test(label) ? BRUNO?.avatar || null : null
}

// Mismo truco de fecha-sin-huso que api/_email.js y Booking.jsx: un
// "YYYY-MM-DD" es un día de calendario, no un instante — se arma en UTC y se
// formatea en UTC para que no se corra un día según la zona del navegador.
function dateParts(key) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(key || ''))
  return m ? new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))) : null
}
// "mié 23 sep": Intl en es-CL agrega una coma y abrevia septiembre a
// "sept" (el único mes con 4 letras); se limpian las dos cosas a mano.
function humanDate(key) {
  const d = dateParts(key)
  if (!d) return ''
  return new Intl.DateTimeFormat('es-CL', { timeZone: 'UTC', weekday: 'short', day: 'numeric', month: 'short' })
    .format(d)
    .replace(/,/g, '')
    .replace(/\./g, '')
    .replace(/\bsept\b/, 'sep')
}

function initials(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean)
  if (!parts.length) return 'B'
  return (parts[0][0] + (parts[1]?.[0] || '')).toUpperCase()
}

function BarberAvatar({ barber }) {
  const src = photoFor(barber)
  const [broken, setBroken] = useState(false)
  if (src && !broken) {
    return <img src={src} alt="" className="rv-avatar rv-avatar-photo" onError={() => setBroken(true)} />
  }
  return <div className="rv-avatar rv-avatar-initials" aria-hidden="true">{initials(barber?.name)}</div>
}

function Skeleton() {
  return (
    <div className="rv-card rv-skeleton" aria-busy="true" aria-label="Cargando">
      <div className="rv-skel rv-skel-avatar" />
      <div className="rv-skel rv-skel-line" style={{ width: '55%' }} />
      <div className="rv-skel rv-skel-line" style={{ width: '75%' }} />
      <div className="rv-skel rv-skel-stars" />
    </div>
  )
}

// Estrellas grandes y tocables: <input type="radio"> nativo (grupo accesible,
// teclado y lector de pantalla sin código extra) escondido bajo el ícono; la
// etiqueta entera es el área de toque (≥48px, ver review.css).
function StarPicker({ value, onChange, disabled }) {
  return (
    <div className="rv-stars" role="radiogroup" aria-label="Calificación de 1 a 5 estrellas">
      {STAR_VALUES.map((n) => (
        <label key={n} className={`rv-star ${n <= value ? 'is-on' : ''}`}>
          <input
            type="radio"
            name="rv-rating"
            value={n}
            checked={value === n}
            disabled={disabled}
            onChange={() => onChange(n)}
            aria-label={`${n} ${n === 1 ? 'estrella' : 'estrellas'}`}
          />
          <Icon name="star" size={30} />
        </label>
      ))}
    </div>
  )
}

const RATING_WORDS = ['', 'Mala', 'Regular', 'Buena', 'Muy buena', 'Excelente']

export default function Review() {
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const token = params.get('t') || ''
  const presetStar = Number(params.get('s'))

  // loading | invalid | error | ready | done
  const [phase, setPhase] = useState('loading')
  const [invalidReason, setInvalidReason] = useState('')
  const [loadError, setLoadError] = useState('')
  const [review, setReview] = useState(null)
  const [rating, setRating] = useState(0)
  const [comment, setComment] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState('')

  const load = useCallback(async () => {
    if (!token) {
      setInvalidReason(INVALID_MSG)
      setPhase('invalid')
      return
    }
    setPhase('loading')
    setLoadError('')
    try {
      const res = await fetch(`/api/barbers?mode=review&t=${encodeURIComponent(token)}`)
      const data = await res.json().catch(() => null)
      // 404 = token inválido o desconocido; 410 = venció. Un 429 o un 5xx no
      // dicen nada del link: se ofrece reintentar en vez de darlo por malo.
      if (res.status === 404 || (res.ok && data && !data.ok)) {
        setInvalidReason(INVALID_MSG)
        setPhase('invalid')
        return
      }
      if (res.status === 410) {
        setInvalidReason(EXPIRED_MSG)
        setPhase('invalid')
        return
      }
      if (!res.ok || !data?.ok || !data.review) {
        setLoadError(data?.error || '')
        setPhase('error')
        return
      }
      if (data.review.expired) {
        setInvalidReason(EXPIRED_MSG)
        setPhase('invalid')
        return
      }
      setReview(data.review)
      const preset = Number.isInteger(presetStar) && presetStar >= 1 && presetStar <= 5 ? presetStar : 0
      setRating(Number(data.review.rating) || preset)
      setComment(data.review.comment || '')
      setPhase('ready')
    } catch {
      setPhase('error')
    }
    // presetStar sale de `params`, que react-router mantiene estable salvo
    // que cambie la URL: no hace falta recrear `load` por eso.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token])

  useEffect(() => { load() }, [load])

  const submit = async (e) => {
    e?.preventDefault?.()
    if (!rating || submitting) return
    setSubmitting(true)
    setSubmitError('')
    try {
      const res = await fetch('/api/barbers?mode=review', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ t: token, rating, comment: comment.trim() }),
      })
      const data = await res.json().catch(() => null)
      if (res.status === 410) {
        // Venció entre que se abrió la página y se envió.
        setInvalidReason(EXPIRED_MSG)
        setPhase('invalid')
        return
      }
      if (res.status === 404) {
        setInvalidReason(INVALID_MSG)
        setPhase('invalid')
        return
      }
      if (!res.ok || !data?.ok) {
        setSubmitError(data?.error || 'No pudimos guardar tu calificación. Intenta de nuevo.')
        return
      }
      setPhase('done')
    } catch {
      setSubmitError('No pudimos conectar. Revisa tu conexión e intenta de nuevo.')
    } finally {
      setSubmitting(false)
    }
  }

  const barberLabel = review?.barber?.short || review?.barber?.name || 'Brunetti'
  const alreadyRated = Boolean(review && (review.rated || review.rating != null))
  const firstName = review?.clientFirstName

  return (
    <div className="rv-screen">
      <div className="rv-wrap">
        <button type="button" className="rv-back" onClick={() => navigate('/')}>
          <Icon name="arrowLeft" size={15} /> Volver a brunetticutz.cl
        </button>

        <div className="rv-brand"><Emblem size={52} /></div>

        {phase === 'loading' && <Skeleton />}

        {phase === 'invalid' && (
          <div className="rv-card rv-state animate-up" role="alert">
            <Icon name="bell" size={26} color="var(--muted)" />
            <p className="rv-state-msg">{invalidReason}</p>
            <div className="rv-done-actions">
              <button type="button" className="btn btn-dark" onClick={() => navigate('/')}>Ir al inicio</button>
              <button type="button" className="btn btn-gold" onClick={() => navigate('/reservar')}>Reservar</button>
            </div>
          </div>
        )}

        {phase === 'error' && (
          <div className="rv-card rv-state animate-up" role="alert">
            <Icon name="refresh" size={26} color="var(--muted)" />
            <p className="rv-state-msg">{loadError || 'No pudimos conectar. Revisa tu conexión e intenta de nuevo.'}</p>
            <button type="button" className="btn btn-dark" onClick={load}>Reintentar</button>
          </div>
        )}

        {phase === 'ready' && review && (
          <form className="rv-card animate-up" onSubmit={submit}>
            <BarberAvatar barber={review.barber} />
            <span className="rv-eyebrow">{firstName ? `Hola, ${firstName}` : 'Tu visita'}</span>
            <h1 className="rv-title font-display">¿Cómo te fue con {barberLabel}?</h1>
            <p className="rv-question">
              Cuéntanos cómo estuvo tu <strong>{review.service || 'visita'}</strong>
              {humanDate(review.date) ? <> del <strong>{humanDate(review.date)}</strong></> : null}.
            </p>

            <StarPicker value={rating} onChange={setRating} disabled={submitting} />
            <p className="rv-rating-word" aria-live="polite">{rating ? RATING_WORDS[rating] : 'Toca una estrella'}</p>

            <textarea
              className="rv-textarea"
              placeholder="Si quieres, déjale un comentario (opcional)"
              aria-label="Comentario (opcional)"
              value={comment}
              onChange={(e) => setComment(e.target.value.slice(0, COMMENT_MAX))}
              rows={3}
              maxLength={COMMENT_MAX}
              disabled={submitting}
            />
            {comment.length > COMMENT_MAX - 100 && (
              <p className="rv-hint">{COMMENT_MAX - comment.length} caracteres disponibles</p>
            )}

            {alreadyRated && !submitError && (
              <p className="rv-hint">Ya habías calificado esta visita. Puedes cambiar tu calificación cuando quieras.</p>
            )}
            {submitError && (
              <p className="rv-error" role="alert"><Icon name="bell" size={13} /> {submitError}</p>
            )}

            <button type="submit" className="btn btn-gold rv-submit" disabled={!rating || submitting}>
              {submitting ? 'Enviando…' : alreadyRated ? 'Actualizar calificación' : 'Enviar calificación'}
            </button>
          </form>
        )}

        {phase === 'done' && (
          <div className="rv-card rv-state animate-up" role="status">
            <span className="rv-done-mark"><Icon name="check" size={28} /></span>
            <h1 className="rv-title font-display">
              {firstName ? `¡Gracias, ${firstName}!` : '¡Gracias!'}
            </h1>
            <div className="rv-stars rv-stars-static" aria-label={`${rating} de 5 estrellas`}>
              {STAR_VALUES.map((n) => (
                <span key={n} className={`rv-star rv-star-sm ${n <= rating ? 'is-on' : ''}`} aria-hidden="true">
                  <Icon name="star" size={20} />
                </span>
              ))}
            </div>
            <p className="rv-state-msg">Tu opinión le ayuda a {barberLabel} a seguir afinando cada visita.</p>
            <div className="rv-done-actions">
              <button type="button" className="btn btn-dark" onClick={() => navigate('/reservar')}>Reservar de nuevo</button>
              <button type="button" className="btn btn-ghost" onClick={() => navigate('/cuenta')}>Ver mis estrellas</button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
