import React, { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { safeUrl, UGC_REL } from '../../academy/url.js'
import { r } from '../../academy/routes.js'

/* ============================================================
   RichText — texto escrito por un miembro (publicaciones, comentarios,
   bio, mensajes, descripciones). SPEC §0.2 / §7.3.

   NUNCA se interpreta HTML: todo sale como nodos de texto de React. La
   Academy comparte origen con el panel (el token del barbero vive en el
   mismo localStorage), así que un solo `<img onerror>` o un `javascript:`
   pintado como link bastaría para robarlo.

   - Saltos de línea: se respetan con `white-space: pre-wrap` (sin <br>).
   - Links: solo lo que parece URL (http://, https://, www.) y además pasa
     safeUrl(); lo demás queda como texto. Abren en pestaña nueva con
     rel="noopener noreferrer nofollow ugc".
   - @menciones: `@handle` → perfil del miembro dentro de la app. La @ no
     puede venir pegada a una palabra (juan@gmail.com no es una mención),
     misma regla que extractMentions() del servidor.

   Props: text, className, as ('div' por defecto; 'span' si va dentro de un
   párrafo), maxLength (corta con "…" antes de tokenizar).
   ============================================================ */

// URL: esquema explícito o "www.". Se corta en espacios y en < > " que
// nunca son parte de un link pegado en un texto.
const URL_SRC = '(?:https?:\\/\\/|www\\.)[^\\s<>"]+'
// Mención: (inicio o carácter que no es parte de palabra/correo) + @handle.
const MENTION_SRC = '(^|[^A-Za-z0-9_.@-])@([A-Za-z0-9-]{3,40})(?![A-Za-z0-9-])'
const TOKEN_RE = new RegExp(`(${URL_SRC})|${MENTION_SRC}`, 'g')

// Puntuación que casi siempre es del texto y no del link ("mira esto: https://x.cl.").
const TRAILING = /[.,;:!?'"»”)\]}]+$/

function trimUrl(raw) {
  let url = raw
  let rest = ''
  const m = url.match(TRAILING)
  if (m) {
    let tail = m[0]
    // Un ")" que cierra un "(" del propio link se queda (Wikipedia y cía).
    while (tail.startsWith(')') && (url.slice(0, -tail.length).split('(').length - 1) > (url.slice(0, -tail.length).split(')').length - 1)) {
      tail = tail.slice(1)
    }
    if (tail) {
      rest = tail
      url = url.slice(0, -tail.length)
    }
  }
  return { url, rest }
}

function tokenize(text) {
  const out = []
  let last = 0
  let m
  TOKEN_RE.lastIndex = 0
  while ((m = TOKEN_RE.exec(text))) {
    if (m[1]) {
      const { url, rest } = trimUrl(m[1])
      const href = safeUrl(url.startsWith('www.') ? `https://${url}` : url)
      if (m.index > last) out.push({ t: 'text', v: text.slice(last, m.index) })
      if (href) out.push({ t: 'link', v: url, href })
      else out.push({ t: 'text', v: url })
      if (rest) out.push({ t: 'text', v: rest })
      last = m.index + m[1].length
    } else {
      // m[2] es el carácter previo (o ''), m[3] el handle.
      const lead = m[2] || ''
      const start = m.index + lead.length
      if (start > last) out.push({ t: 'text', v: text.slice(last, start) })
      out.push({ t: 'mention', v: `@${m[3]}`, handle: m[3].toLowerCase() })
      last = start + 1 + m[3].length
    }
  }
  if (last < text.length) out.push({ t: 'text', v: text.slice(last) })
  return out
}

export function RichText({ text, className, as: Tag = 'div', maxLength }) {
  const parts = useMemo(() => {
    let s = typeof text === 'string' ? text : text == null ? '' : String(text)
    if (maxLength && s.length > maxLength) s = `${s.slice(0, maxLength).trimEnd()}…`
    return s ? tokenize(s) : []
  }, [text, maxLength])

  if (!parts.length) return null
  return (
    <Tag className={['aca-rt', className].filter(Boolean).join(' ')}>
      {parts.map((p, i) => {
        if (p.t === 'link') {
          return (
            <a key={i} href={p.href} target="_blank" rel={UGC_REL} className="aca-rt-link">
              {p.v}
            </a>
          )
        }
        if (p.t === 'mention') {
          return (
            <Link key={i} to={r.profile(p.handle)} className="aca-rt-mention">
              {p.v}
            </Link>
          )
        }
        return <React.Fragment key={i}>{p.v}</React.Fragment>
      })}
    </Tag>
  )
}

export default RichText
