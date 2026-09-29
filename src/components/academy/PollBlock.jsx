import React, { useState } from 'react'
import { Icon } from '../../academy/Icon.jsx'
import { useAcademy } from '../../academy/context.js'
import { academyApi } from '../../academy/api.js'
import '../../styles/academy/comunidad.css'

/* ============================================================
   Encuesta de una publicación (poll-vote, SPEC §5.3).
   · Sin votar: opciones como botones de radio.
   · Con voto: barras con % y la opción propia marcada; se puede cambiar el
     voto tocando otra (el backend lo permite).
   · compact (tarjeta del feed): hasta 3 opciones y "+N opciones más", que
     abre la publicación.
   poll = { options:[{text, votes}], total, myVote|null }
   ============================================================ */

const cx = (...p) => p.filter(Boolean).join(' ')

export default function PollBlock({ postId, poll, onChange, compact = false, onMore, disabled = false }) {
  const { toast } = useAcademy()
  const [busy, setBusy] = useState(null)
  const options = Array.isArray(poll?.options) ? poll.options : []
  if (!options.length) return null
  const total = Number.isFinite(Number(poll?.total))
    ? Number(poll.total)
    : options.reduce((s, o) => s + (Number(o?.votes) || 0), 0)
  const myVote = poll?.myVote == null ? null : Number(poll.myVote)
  const voted = myVote != null
  const shown = compact ? options.slice(0, 3) : options
  const hidden = options.length - shown.length

  const vote = async (idx) => {
    if (busy != null || disabled || myVote === idx) return
    setBusy(idx)
    try {
      const d = await academyApi('poll-vote', { method: 'POST', body: { postId, optionIdx: idx } })
      if (d?.poll) onChange?.(d.poll)
    } catch (e) {
      const m = e?.message && !/^(Failed|unavailable)/i.test(e.message) ? e.message : 'No se pudo registrar tu voto'
      toast?.(m, 'error')
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className={cx('aca-cm-poll', compact && 'is-compact', voted && 'is-voted')} data-stop="">
      <div className="aca-cm-poll-label"><Icon name="chart" size={14} /> Encuesta</div>
      <div className="aca-cm-poll-opts" role="group" aria-label="Opciones de la encuesta">
        {shown.map((o, i) => {
          const votes = Number(o?.votes) || 0
          const pct = total > 0 ? Math.round((votes * 100) / total) : 0
          const isMine = myVote === i
          return (
            <button
              key={i}
              type="button"
              className={cx('aca-cm-poll-opt', isMine && 'is-mine', busy === i && 'is-busy')}
              onClick={() => vote(i)}
              disabled={busy != null || disabled}
              aria-pressed={isMine}
              aria-label={voted ? `${o?.text || ''}: ${pct}%` : o?.text || ''}
            >
              {voted && <span className="aca-cm-poll-fill" style={{ width: `${pct}%` }} aria-hidden="true" />}
              <span className="aca-cm-poll-radio" aria-hidden="true">{isMine ? <Icon name="check" size={12} stroke={2.4} /> : null}</span>
              <span className="aca-cm-poll-text">{o?.text || ''}</span>
              {voted && <span className="aca-cm-poll-pct">{pct}%</span>}
            </button>
          )
        })}
      </div>
      <div className="aca-cm-poll-foot">
        <span>{total} {total === 1 ? 'voto' : 'votos'}</span>
        {compact && hidden > 0 && (
          <button type="button" className="aca-cm-linkbtn" onClick={onMore}>
            +{hidden} {hidden === 1 ? 'opción más' : 'opciones más'}
          </button>
        )}
        {!compact && voted && <span className="aca-cm-poll-hint">Toca otra opción para cambiar tu voto</span>}
      </div>
    </div>
  )
}
