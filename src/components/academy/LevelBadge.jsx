import React from 'react'
import '../../styles/academy/app.css'

/* Circulito azul con el número de nivel (el de Skool, abajo a la derecha del
   avatar). `size` en px; el número escala con él. Sin nivel → nada. */
export default function LevelBadge({ level, size = 18, className, title }) {
  const n = Math.max(1, Math.min(9, Math.floor(Number(level) || 0)))
  if (!level) return null
  return (
    <span
      className={['aca-lvl', className].filter(Boolean).join(' ')}
      style={{ '--lvl-s': `${size}px` }}
      title={title || `Nivel ${n}`}
      aria-label={`Nivel ${n}`}
      role="img"
    >
      {n}
    </span>
  )
}

export { LevelBadge }
