import React, { forwardRef, useState } from 'react'
import { Icon } from '../ui.jsx'
import { CountUp } from '../DashKit.jsx'
import { BARBERS } from '../../data.js'
import { useStoredFlag } from './hooks.js'

/* ============================================================
   Primitivas del panel interno. Estilos en src/styles/panel.css (pn-*).
   Regla de uso: cada pantalla tiene UNA acción primaria (ModuleHeader) y
   todo lo demás usa estas piezas — nada de style={{}} para espaciar o
   dimensionar, que es de donde salían las desproporciones.
   ============================================================ */

const cx = (...parts) => parts.filter(Boolean).join(' ')

/* ---------- Botones ---------- */
const ICON_SIZE = { sm: 14, md: 16, lg: 18 }

export const Button = forwardRef(function Button(
  { variant = 'secondary', size = 'md', icon, iconRight, block, loading, className, children, type = 'button', ...rest },
  ref,
) {
  const iconOnly = !children && icon
  return (
    <button
      ref={ref}
      type={type}
      className={cx('pn-btn', `pn-btn--${variant}`, size !== 'md' && `pn-btn--${size}`, block && 'pn-btn--block', iconOnly && 'pn-btn--icon', loading && 'is-loading', className)}
      disabled={rest.disabled || loading}
      aria-busy={loading || undefined}
      {...rest}
    >
      {icon && <Icon name={icon} size={ICON_SIZE[size] || 16} />}
      {children != null && children !== false && <span className="pn-btn-label">{children}</span>}
      {iconRight && <Icon name={iconRight} size={ICON_SIZE[size] || 16} />}
    </button>
  )
})

/* Botón redondo de ícono (barra superior, acciones de fila). `label` es
   obligatorio: sin texto visible, es lo único que lee VoiceOver. */
export function IconButton({ icon, label, onClick, plain, small, badge, className, disabled, iconSize, ...rest }) {
  return (
    <button
      type="button"
      className={cx('pn-icon-btn', plain && 'is-plain', small && 'is-sm', className)}
      aria-label={label}
      title={label}
      onClick={onClick}
      disabled={disabled}
      {...rest}
    >
      <Icon name={icon} size={iconSize || (small ? 16 : 18)} />
      {badge ? <span className="pn-badge-dot">{badge > 99 ? '99+' : badge}</span> : null}
    </button>
  )
}

/* ---------- Chips y estados ---------- */
export function Chip({ tone, icon, dot, large, children, className, title }) {
  return (
    <span className={cx('pn-chip', tone && `pn-chip--${tone}`, large && 'is-lg', className)} title={title}>
      {dot && <span className="pn-dot" />}
      {icon && <Icon name={icon} size={12} />}
      {children}
    </span>
  )
}

export const BOOKING_STATUS = {
  pendiente: { label: 'Pendiente', tone: 'warn' },
  confirmada: { label: 'Confirmada', tone: 'ok' },
  'en curso': { label: 'En curso', tone: 'info' },
  completada: { label: 'Completada', tone: 'accent', icon: 'check' },
  cancelada: { label: 'Cancelada', tone: 'bad' },
}

export function StatusBadge({ status, large }) {
  const meta = BOOKING_STATUS[status] || { label: status || '—', tone: 'muted' }
  return (
    <Chip tone={meta.tone} icon={meta.icon} dot={!meta.icon} large={large}>
      {meta.label}
    </Chip>
  )
}

/* ---------- Avatar (foto del barbero o del cliente; iniciales si no hay) ---------- */
export function initialsOf(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean)
  if (!parts.length) return '·'
  return (parts[0][0] + (parts[1]?.[0] || '')).toUpperCase()
}

/* Miniatura liviana para la foto del barbero: la de BARBERS (data.js,
   /assets/bruno-hero.jpg) pesa ~340 KB y acá se dibuja a 32-96 px — en el
   iPhone, con datos móviles, eso hacía lento el panel. Si el barbero de esa
   foto tiene `avatar` (recorte chico en /assets/avatars/), se usa ese; una
   foto que ya es la miniatura, o que llegó por otra vía, se usa tal cual. Si
   la miniatura falla, se cae a la original y, si esa también falla, a las
   iniciales. */
function avatarThumb(src) {
  const s = String(src || '')
  return BARBERS.find((b) => b.photo === s && b.avatar)?.avatar || src
}

export function Avatar({ src, name, size = 36, accent, className, title }) {
  const [failed, setFailed] = useState(0) // 0 = miniatura, 1 = original, 2 = iniciales
  const url = failed === 0 ? avatarThumb(src) : src
  const showImg = src && failed < 2
  return (
    <span
      className={cx('pn-avatar', accent && !showImg && 'is-accent', className)}
      style={{ '--s': `${size}px` }}
      title={title || name || undefined}
      aria-hidden={title ? undefined : 'true'}
    >
      {showImg
        ? <img src={url} alt="" loading="lazy" decoding="async" onError={() => setFailed((n) => (url === src ? 2 : n + 1))} />
        : initialsOf(name)}
    </span>
  )
}

/* Foto de un barbero por id, buscada en la lista que ya tiene el panel
   (BARBERS de data.js). Centralizado para que ningún lugar vuelva a dibujar solo la
   inicial cuando hay foto. */
export function barberPhoto(barbers, barberId) {
  const b = (barbers || []).find((x) => Number(x.id) === Number(barberId))
  return b?.photo || null
}

/* ---------- Tarjeta ---------- */
export function Card({ title, subtitle, action, children, flush, padLg, onClick, className, bodyClassName, id, as: Tag = 'section' }) {
  const head = title || subtitle || action
  return (
    <Tag
      id={id}
      className={cx('pn-card', flush && 'is-flush', padLg && 'is-pad-lg', onClick && 'is-link', className)}
      onClick={onClick}
    >
      {head && (
        <div className="pn-card-head">
          <div className="pn-card-head-text">
            {title && <h2 className="pn-card-title">{title}</h2>}
            {subtitle && <p className="pn-card-sub">{subtitle}</p>}
          </div>
          {action}
        </div>
      )}
      <div className={cx('pn-card-body', bodyClassName)}>{children}</div>
    </Tag>
  )
}

export function SectionLabel({ children, className }) {
  return <h3 className={cx('pn-section-label', className)}>{children}</h3>
}

/* ---------- Listas ---------- */
export function List({ children, className }) {
  return <div className={cx('pn-list', className)}>{children}</div>
}

/* Fila de lista estilo iOS. Clickable = div con role="button" (y no
   <button>) para poder llevar botones propios adentro, como "Cobrar". */
export function ListRow({
  lead, title, subtitle, value, meta, trailing, actions, chevron, onClick, dim,
  titleWrap, subtitleWrap, className, children, ariaLabel,
}) {
  const clickable = typeof onClick === 'function'
  const onKeyDown = clickable
    ? (e) => { if ((e.key === 'Enter' || e.key === ' ') && e.target === e.currentTarget) { e.preventDefault(); onClick(e) } }
    : undefined
  return (
    <div
      className={cx('pn-row', lead && 'has-lead', clickable && 'is-link', dim && 'is-dim', className)}
      role={clickable ? 'button' : undefined}
      tabIndex={clickable ? 0 : undefined}
      aria-label={ariaLabel}
      onClick={onClick}
      onKeyDown={onKeyDown}
    >
      {lead && <span className="pn-row-lead">{lead}</span>}
      <span className="pn-row-main">
        {title != null && <span className={cx('pn-row-title', titleWrap && 'is-wrap')}>{title}</span>}
        {subtitle && <span className={cx('pn-row-sub', subtitleWrap && 'is-wrap')}>{subtitle}</span>}
        {children}
      </span>
      {(value != null || meta || trailing) && (
        <span className="pn-row-trail">
          {value != null && <span className="pn-row-value">{value}</span>}
          {meta && <span className="pn-row-meta">{meta}</span>}
          {trailing}
        </span>
      )}
      {actions && <span className="pn-row-actions" onClick={(e) => e.stopPropagation()}>{actions}</span>}
      {chevron && <Icon name="chevronRight" size={16} style={{ flex: '0 0 auto', color: 'var(--pn-text-3)' }} />}
    </div>
  )
}

export function Time({ value, sub }) {
  return <span className="pn-time">{value}{sub && <small>{sub}</small>}</span>
}

/* ---------- KPI ---------- */
export function Kpi({ label, value, format, suffix, hint, hintTone, icon, color, onClick, active, hero, animate = true, title }) {
  const Tag = onClick ? 'button' : 'div'
  const numeric = typeof value === 'number' && Number.isFinite(value)
  return (
    <Tag
      {...(onClick ? { type: 'button', onClick, 'aria-pressed': active || undefined } : {})}
      className={cx('pn-kpi', hero && 'is-hero', active && 'is-on')}
      title={title}
    >
      <span className="pn-kpi-label">
        {icon ? <Icon name={icon} size={13} /> : color ? <span className="pn-dot" style={{ '--c': color }} /> : null}
        <span>{label}</span>
      </span>
      <span className="pn-kpi-value">
        {numeric && animate ? <CountUp value={value} format={format} /> : (numeric && format ? format(value) : value ?? '—')}
        {suffix && <small>{suffix}</small>}
      </span>
      {hint && <span className={cx('pn-kpi-hint', hintTone === 'up' && 'is-up', hintTone === 'down' && 'is-down')}>{hint}</span>}
    </Tag>
  )
}

/* Grilla de KPI con "Ver N más": en el celular se ven los primeros `visible`
   y el resto queda un toque más abajo. No se esconde información, se ordena. */
export function KpiGrid({ items = [], visible, storageKey, cols, className }) {
  const shown = items.filter(Boolean)
  const [open, setOpen] = useStoredFlag(storageKey ? `pn_kpi_more_${storageKey}` : null, false)
  const limit = visible && shown.length > visible && !open ? visible : shown.length
  const hidden = shown.length - limit
  return (
    <div className={cx('pn-kpis', cols && `cols-${cols}`, className)}>
      {shown.slice(0, limit).map((k) => <Kpi key={k.id || k.label} {...k} />)}
      {visible && shown.length > visible && (
        <Button variant="plain" size="sm" className="pn-kpis-more" iconRight={open ? 'chevronUp' : 'chevronDown'} onClick={() => setOpen(!open)}>
          {open ? 'Ver menos' : `Ver ${hidden} ${hidden === 1 ? 'métrica' : 'métricas'} más`}
        </Button>
      )}
    </div>
  )
}

/* ---------- Segmentado y chips de filtro ---------- */
export function Segmented({ options, value, onChange, full, scroll, size, ariaLabel, className }) {
  return (
    <div className={cx('pn-seg', full && 'is-full', scroll && 'is-scroll', size === 'sm' && 'is-sm', className)} role="radiogroup" aria-label={ariaLabel}>
      {options.filter(Boolean).map((o) => {
        const on = o.value === value
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={on}
            className={cx('pn-seg-btn', on && 'is-on')}
            onClick={() => !on && onChange?.(o.value)}
            disabled={o.disabled}
            title={o.title}
          >
            {o.icon && <Icon name={o.icon} size={14} />}
            {o.label != null && <span>{o.label}</span>}
            {o.count != null && <span className="pn-seg-count">{o.count}</span>}
          </button>
        )
      })}
    </div>
  )
}

export function FilterChips({ options, value, onChange, ariaLabel, className }) {
  return (
    <div className={cx('pn-fchips', className)} role="radiogroup" aria-label={ariaLabel}>
      {options.filter(Boolean).map((o) => {
        const on = o.value === value
        return (
          <button key={o.value} type="button" role="radio" aria-checked={on} className={cx('pn-fchip', on && 'is-on')} onClick={() => onChange?.(o.value)}>
            {o.icon && <Icon name={o.icon} size={14} />}
            <span>{o.label}</span>
            {o.count != null && <span className="pn-fchip-count">{o.count}</span>}
          </button>
        )
      })}
    </div>
  )
}

/* Grilla de opciones (medio de pago, tipo de movimiento…): 2 columnas en el
   celular, hasta 4 en escritorio. Para listas de 4-6 opciones con rótulos
   largos, donde un segmentado se amontona ("TransferenciaMercado Pago"). */
export function ChoiceGrid({ options, value, onChange, ariaLabel, className, cols }) {
  return (
    <div className={cx('pn-choices', cols && `cols-${cols}`, className)} role="radiogroup" aria-label={ariaLabel}>
      {options.filter(Boolean).map((o) => {
        const on = o.value === value
        return (
          <button key={o.value} type="button" role="radio" aria-checked={on} className={cx('pn-choice', on && 'is-on')} onClick={() => onChange?.(o.value)} disabled={o.disabled}>
            {o.icon && <Icon name={o.icon} size={16} />}
            <span>{o.label}</span>
          </button>
        )
      })}
    </div>
  )
}

/* ---------- Navegación de período: ‹ etiqueta › ---------- */
export function PeriodNav({ label, sublabel, onPrev, onNext, canPrev = true, canNext = true, onLabelClick, prevLabel = 'Anterior', nextLabel = 'Siguiente', className }) {
  const LabelTag = onLabelClick ? 'button' : 'span'
  return (
    <div className={cx('pn-period', className)}>
      {onPrev && (
        <button type="button" className="pn-period-arrow" onClick={onPrev} disabled={!canPrev} aria-label={prevLabel} title={prevLabel}>
          <Icon name="chevronLeft" size={16} />
        </button>
      )}
      <LabelTag {...(onLabelClick ? { type: 'button', onClick: onLabelClick } : {})} className="pn-period-label">
        <span>{label}</span>
        {sublabel && <small>{sublabel}</small>}
        {onLabelClick && <Icon name="chevronDown" size={14} style={{ color: 'var(--pn-text-3)' }} />}
      </LabelTag>
      {onNext && (
        <button type="button" className="pn-period-arrow" onClick={onNext} disabled={!canNext} aria-label={nextLabel} title={nextLabel}>
          <Icon name="chevronRight" size={16} />
        </button>
      )}
    </div>
  )
}

/* ---------- Búsqueda ---------- */
export function SearchField({ value, onChange, placeholder = 'Buscar', autoFocus, className, inputRef, onKeyDown, ariaLabel }) {
  return (
    <label className={cx('pn-search', className)}>
      <Icon name="search" size={16} />
      <input
        ref={inputRef}
        type="search"
        value={value}
        placeholder={placeholder}
        aria-label={ariaLabel || placeholder}
        autoFocus={autoFocus}
        autoComplete="off"
        autoCorrect="off"
        spellCheck={false}
        enterKeyHint="search"
        onChange={(e) => onChange?.(e.target.value)}
        onKeyDown={onKeyDown}
      />
      {value ? (
        <button type="button" className="pn-search-clear" aria-label="Borrar búsqueda" onClick={() => onChange?.('')}>
          <Icon name="close" size={12} />
        </button>
      ) : null}
    </label>
  )
}

/* ---------- Formularios ---------- */
export function Field({ label, optional, hint, error, children, className, htmlFor }) {
  return (
    <div className={cx('pn-field', className)}>
      {label && (
        <label className="pn-field-label" htmlFor={htmlFor}>
          <span>{label}</span>
          {optional && <em>Opcional</em>}
        </label>
      )}
      {children}
      {error ? <span className="pn-field-error">{error}</span> : hint ? <span className="pn-field-hint">{hint}</span> : null}
    </div>
  )
}

export function Switch({ checked, onChange, disabled, label, className }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={Boolean(checked)}
      aria-label={label}
      className={cx('pn-switch', checked && 'is-on', className)}
      disabled={disabled}
      onClick={(e) => { e.stopPropagation(); onChange?.(!checked) }}
    />
  )
}

/* Fila con interruptor: toda la fila es tocable, no solo el switch. */
export function ToggleRow({ title, description, checked, onChange, disabled, lead }) {
  return (
    <ListRow
      lead={lead}
      title={title}
      titleWrap
      subtitle={description}
      subtitleWrap
      className={cx('pn-toggle-row', disabled && 'is-disabled')}
      onClick={disabled ? undefined : () => onChange?.(!checked)}
      trailing={<Switch checked={checked} onChange={onChange} disabled={disabled} label={typeof title === 'string' ? title : undefined} />}
    />
  )
}

export function Note({ icon = 'info', children, className }) {
  return (
    <div className={cx('pn-note', className)}>
      <Icon name={icon} size={15} />
      <div>{children}</div>
    </div>
  )
}

/* Barra de "cambios sin guardar": el único patrón de guardado para campos de
   texto. Los interruptores y selects se guardan al tocarlos (SavedTick). */
export function SaveBar({ visible, saving, onSave, onDiscard, message = 'Tienes cambios sin guardar', saveLabel = 'Guardar' }) {
  if (!visible) return null
  return (
    <div className="pn-savebar" role="status">
      <span className="pn-savebar-msg">{message}</span>
      {onDiscard && <Button variant="plain" size="sm" onClick={onDiscard} disabled={saving}>Descartar</Button>}
      <Button variant="primary" size="sm" onClick={onSave} loading={saving}>{saveLabel}</Button>
    </div>
  )
}

export function SavedTick({ show, children = 'Guardado' }) {
  if (!show) return null
  return <span className="pn-saved" role="status"><Icon name="check" size={13} /> {children}</span>
}

/* ---------- Estados ---------- */
export function EmptyState({ icon = 'spark', title, text, action, compact, className }) {
  return (
    <div className={cx('pn-empty', compact && 'is-compact', className)}>
      <span className="pn-empty-icon"><Icon name={icon} size={compact ? 15 : 18} /></span>
      <div>
        {title && <p className="pn-empty-title">{title}</p>}
        {text && <p className="pn-empty-text">{text}</p>}
        {action && (
          <div className="pn-empty-action">
            <Button variant="secondary" size="sm" icon={action.icon} onClick={action.onClick}>{action.label}</Button>
          </div>
        )}
      </div>
    </div>
  )
}

const ALERT_ICON = { warn: 'alert', error: 'alert', info: 'info', success: 'checkCircle' }
export function InlineAlert({ tone = 'info', title, children, action, onClose, icon, className }) {
  return (
    <div className={cx('pn-alert', `pn-alert--${tone}`, className)} role={tone === 'error' ? 'alert' : 'status'}>
      <Icon name={icon || ALERT_ICON[tone] || 'info'} size={16} />
      <div className="pn-alert-body">
        {title && <div className="pn-alert-title">{title}</div>}
        {children}
      </div>
      {(action || onClose) && (
        <div className="pn-alert-actions">
          {action && <Button variant="plain" size="sm" onClick={action.onClick}>{action.label}</Button>}
          {onClose && <IconButton icon="close" label="Cerrar aviso" plain small onClick={onClose} />}
        </div>
      )}
    </div>
  )
}

export function Skeleton({ height = 16, width = '100%', radius, className }) {
  return <span className={cx('pn-skel', className)} style={{ display: 'block', height, width, borderRadius: radius }} aria-hidden="true" />
}

export function SkeletonRows({ rows = 3 }) {
  return (
    <div className="pn-list" aria-busy="true" aria-label="Cargando">
      {Array.from({ length: rows }, (_, i) => (
        <div className="pn-row has-lead" key={i}>
          <span className="pn-row-lead"><Skeleton width={36} height={36} radius={999} /></span>
          <span className="pn-row-main"><Skeleton width="55%" height={13} /><Skeleton width="35%" height={11} /></span>
          <span className="pn-row-trail"><Skeleton width={64} height={13} /></span>
        </div>
      ))}
    </div>
  )
}

/* ---------- Barra de progreso / barra apilada ---------- */
export function ProgressBar({ value = 0, max = 100, color, className, label }) {
  const pct = max > 0 ? Math.max(0, Math.min(100, (value / max) * 100)) : 0
  return (
    <div className={cx('pn-bar', className)} role="progressbar" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100} aria-label={label}>
      <i style={{ width: `${pct}%`, '--c': color }} />
    </div>
  )
}

export function StackedBar({ parts = [], className, label }) {
  const total = parts.reduce((s, p) => s + (Number(p.value) || 0), 0)
  return (
    <div className={cx('pn-bar is-stacked', className)} aria-label={label} role="img">
      {total > 0 && parts.map((p) => (
        <i key={p.key || p.label} style={{ width: `${((Number(p.value) || 0) / total) * 100}%`, '--c': p.color }} title={p.label} />
      ))}
    </div>
  )
}
