import React, { useEffect, useState } from 'react'
import { Icon } from '../../components/ui.jsx'
import { CLP, fmtDate } from '../../data.js'
import { AUDIENCES, AUDIENCE_BY_ID, AUDIENCE_LABEL, CAMPAIGN_TEMPLATES } from './shared.jsx'
import {
  ModuleHeader, Card, KpiGrid, FilterChips, SectionLabel, InlineAlert, Button, ConfirmDialog,
  ProgressBar, List, ListRow, Chip, EmptyState, Field, Note,
} from '../../components/panel/index.js'
import '../../styles/panel/marketing.css'

// El mismo filtro que aplica api/clients.js (?mode=wallet-send-cards) al
// correo de prueba: si acá pasa, allá también.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`

/* Fecha corta de una campaña ("24 sep"). `createdAt` es un ISO en UTC: se
   pasa como Date para que el día sea el de Santiago y no el de Greenwich
   (una campaña de las 22:00 no puede figurar al día siguiente). */
const campaignDay = (iso) => {
  const d = new Date(iso)
  return Number.isFinite(d.getTime()) ? fmtDate(d, 'dm') : ''
}

/* Pestaña «marketing» del panel interno. Recibe en `ctx` el estado y las
   acciones de Dashboard que usa (ver el objeto `dash` que arma
   Dashboard.jsx). Las cifras y las campañas son las del programa de
   fidelidad de Pimp Studio — uno solo para los dos locales — y llegan por el
   puente (/api/clients?mode=wallet-*, ver api/_loyaltyBridge.js). */
export default function MarketingTab({ ctx }) {
  const {
    activeClients,
    audienceCount,
    campaignAudience,
    campaignConfirming,
    campaignError,
    campaignMessage,
    campaignSending,
    campaignSentNote,
    cardProgress,
    cardSending,
    cardStopRef,
    cardTestEmail,
    cardTestPhone,
    clientKey,
    newClientsCount,
    recurringPct,
    sendLoyaltyCards,
    sendWalletCampaign,
    setCampaignAudience,
    setCampaignConfirming,
    setCampaignError,
    setCampaignMessage,
    setCampaignSentNote,
    setCardTestEmail,
    setCardTestPhone,
    topClients,
    walletCampaigns,
    walletStats,
  } = ctx

  // Confirmación del envío masivo de la tarjeta por correo (antes un
  // window.confirm en Dashboard). Estado de la pestaña: no lo usa nadie más.
  const [bulkConfirming, setBulkConfirming] = useState(false)
  // Cuál de los dos envíos está corriendo ('test' | 'bulk'), para que el
  // spinner aparezca en el botón que se tocó y no en los dos.
  const [cardKind, setCardKind] = useState(null)
  // "Detener" corta entre tandas (cardStopRef), no al instante: el rótulo
  // lo dice mientras termina la tanda en curso.
  const [stopping, setStopping] = useState(false)
  useEffect(() => { if (!cardSending) { setStopping(false); setCardKind(null) } }, [cardSending])

  const recipients = audienceCount(campaignAudience)
  const audienceLabel = AUDIENCE_LABEL[campaignAudience] || campaignAudience
  // Cualquier cambio de mensaje o audiencia cierra la confirmación: nunca se
  // confirma algo distinto a lo que se leyó.
  const resetFeedback = () => { setCampaignConfirming(false); setCampaignSentNote('') }
  const openCampaignConfirm = () => { setCampaignError?.(''); setCampaignConfirming(true) }

  const byStars = Array.isArray(walletStats?.byStars) ? walletStats.byStars : []
  const maxStars = Math.max(1, ...byStars)

  const testPhoneOk = cardTestPhone.length === 9
  const testEmailBad = Boolean(cardTestEmail) && !EMAIL_RE.test(cardTestEmail)
  const sendTest = () => {
    setCardKind('test')
    sendLoyaltyCards({ onlyPhone: cardTestPhone, again: true, includeInstalled: true, testEmail: cardTestEmail || null })
  }
  const sendBulk = () => {
    setBulkConfirming(false)
    setCardKind('bulk')
    sendLoyaltyCards({ confirmed: true })
  }
  const stopCards = () => { cardStopRef.current = true; setStopping(true) }

  return (
    <div className="pn-page">
      <ModuleHeader
        title="Marketing"
        subtitle={walletStats ? plural(walletStats.passesIssued, 'tarjeta emitida', 'tarjetas emitidas') : 'Fidelidad y campañas por Wallet'}
      />

      {/* KPIs. Los que dependen del puente muestran "—" mientras cargan en
          vez de 0: un 0 se lee como "nadie instaló la tarjeta" y ya pasó que
          se tomaran decisiones mirando un dato que aún no llegaba. */}
      <KpiGrid
        visible={4}
        cols={4}
        storageKey="marketing"
        items={[
          {
            id: 'wallet', icon: 'wallet', label: 'Tarjetas en Wallet',
            value: walletStats ? walletStats.installed : '—',
            hint: walletStats ? `${walletStats.installRate}% de ${walletStats.passesIssued} emitidas` : 'Cargando…',
          },
          {
            id: 'active', icon: 'users', label: 'Clientes activos',
            value: activeClients.length,
            hint: `${recurringPct}% vuelve`,
          },
          {
            id: 'freecut', icon: 'gift', label: 'Corte gratis listo',
            value: walletStats ? walletStats.freeCutReady : '—',
            hint: walletStats
              ? (walletStats.freeCutsRedeemed != null ? `${walletStats.freeCutsRedeemed} canjeados ya` : 'Ahora mismo')
              : null,
          },
          {
            id: 'campaigns', icon: 'megaphone', label: 'Campañas del mes',
            value: walletStats ? walletStats.campaignsThisMonth : '—',
            hint: walletStats ? `${walletStats.campaignsSent} en total` : null,
          },
          {
            id: 'stars-month', icon: 'star', label: 'Estrellas del mes',
            value: walletStats ? walletStats.starsThisMonth : '—',
            hint: walletStats ? `${walletStats.starsAllTime} desde el inicio` : null,
          },
          {
            id: 'almost', icon: 'target', label: 'A punto (7-9)',
            value: walletStats ? (walletStats.audienceCounts?.almost_free ?? 0) : '—',
            hint: 'Les falta poco',
          },
          { id: 'new-today', icon: 'user', label: 'Nuevos hoy', value: newClientsCount, hint: 'Hoy' },
          {
            id: 'avg-stars', icon: 'percent', label: 'Promedio de estrellas',
            value: walletStats ? walletStats.avgStars : '—',
            hint: walletStats ? `sobre ${walletStats.clientsWithStars} clientes` : null,
          },
        ]}
      />

      {/* Campaña — primero y no después de las métricas: es lo que el
          barbero viene a hacer a esta pestaña. Los 3 pasos viven en la misma
          tarjeta: a quién, mensaje y vista previa + envío. */}
      <Card
        title="Nueva campaña"
        subtitle="Aparece en la tarjeta del cliente y dispara una notificación en su celular. Solo llega a quien tiene el pase agregado — el resto no se entera."
      >
        <div className="pn-stack is-lg pn-mkt-campaign">
          <div className="pn-mkt-step">
            <SectionLabel><Icon name="target" size={12} /> 1 · A quién</SectionLabel>
            <FilterChips
              ariaLabel="A quién enviar"
              value={campaignAudience}
              onChange={(v) => { setCampaignAudience(v); resetFeedback() }}
              options={AUDIENCES.map((a) => ({ value: a.id, label: a.label, icon: a.icon, count: walletStats ? audienceCount(a.id) : undefined }))}
            />
            <p className="pn-muted pn-mkt-desc">{AUDIENCE_BY_ID[campaignAudience]?.desc}</p>
          </div>

          <div className="pn-mkt-step">
            <SectionLabel><Icon name="send" size={12} /> 2 · Mensaje</SectionLabel>
            <div className="pn-mkt-tpls" role="list" aria-label="Sugerencias de mensaje">
              {CAMPAIGN_TEMPLATES.map((t) => (
                <button
                  key={t}
                  type="button"
                  role="listitem"
                  className="pn-mkt-tpl"
                  onClick={() => { setCampaignMessage(t); resetFeedback() }}
                >
                  {t}
                </button>
              ))}
            </div>
            <textarea
              className="input"
              rows={3}
              aria-label="Mensaje de la campaña"
              value={campaignMessage}
              onChange={(e) => { setCampaignMessage(e.target.value.slice(0, 180)); resetFeedback() }}
              placeholder="Ej: Este viernes, 20% en barba. Te esperamos."
            />
            <div className="pn-between">
              <span className="pn-muted pn-mkt-hint">Se ve en la tarjeta hasta el próximo mensaje</span>
              <span className={`pn-mkt-counter${campaignMessage.length > 150 ? ' is-near' : ''}`}>{campaignMessage.length}/180</span>
            </div>
          </div>

          <div className="pn-mkt-step">
            <SectionLabel><Icon name="eye" size={12} /> 3 · Vista previa</SectionLabel>
            {campaignMessage.trim() ? (
              <div className="pn-mkt-preview">
                <span className="who">Brunetti Cutz</span>
                <span className="msg">{campaignMessage.trim()}</span>
                <span className="to">→ {audienceLabel} · {walletStats ? plural(recipients, 'cliente', 'clientes') : 'contando clientes…'}</span>
              </div>
            ) : (
              <p className="pn-muted pn-mkt-desc">Escribe un mensaje para ver cómo se verá.</p>
            )}

            {campaignSentNote && (
              <InlineAlert tone="success" onClose={() => setCampaignSentNote('')}>{campaignSentNote}</InlineAlert>
            )}
            {/* El error se ve dentro de la confirmación; si se cancela después
                de un fallo, queda acá para que no se pierda. */}
            {campaignError && !campaignConfirming && (
              <InlineAlert tone="error" onClose={() => setCampaignError?.('')}>{campaignError}</InlineAlert>
            )}

            {/* Dos pasos para enviar. Es irreversible: el push sale al
                celular de decenas de clientes y no hay "deshacer". */}
            <Button
              variant="primary"
              icon="megaphone"
              block
              disabled={!campaignMessage.trim() || campaignSending || (walletStats && recipients === 0)}
              onClick={openCampaignConfirm}
            >
              {walletStats ? `Enviar a ${plural(recipients, 'cliente', 'clientes')}` : 'Enviar campaña'}
            </Button>
          </div>
        </div>
      </Card>

      {walletCampaigns.length > 0 && (
        <Card title="Historial" subtitle="Las últimas campañas, de los dos locales" flush>
          <List>
            {walletCampaigns.slice(0, 8).map((c) => (
              <ListRow
                key={c.id}
                title={c.message}
                titleWrap
                subtitleWrap
                subtitle={[
                  AUDIENCE_LABEL[c.audience] || c.audience,
                  plural(Number(c.recipientCount || 0), 'destinatario', 'destinatarios'),
                  campaignDay(c.createdAt),
                ].filter(Boolean).join(' · ')}
                trailing={(
                  <Chip tone={c.source === 'brunetti' ? 'accent' : 'muted'}>
                    {c.source === 'brunetti' ? 'Brunetti' : 'Pimp Studio'}
                  </Chip>
                )}
              />
            ))}
          </List>
        </Card>
      )}

      {/* Adopción de la tarjeta: emitidas vs realmente agregadas, y en qué
          punto del camino al corte gratis está la gente. */}
      <Card
        title="Wallet y fidelidad"
        subtitle={walletStats ? `${walletStats.installed} de ${walletStats.passesIssued} instaladas · ${walletStats.installRate}%` : undefined}
      >
        {!walletStats ? (
          <p className="pn-muted pn-mkt-desc">Cargando métricas…</p>
        ) : (
          <div className="pn-stack is-lg">
            <ProgressBar value={walletStats.installRate} max={100} color="var(--pn-accent)" label="Tasa de instalación" />
            <KpiGrid items={[
              { id: 'apple', icon: 'apple', label: 'En iPhone', value: walletStats.appleInstalled },
              { id: 'android', icon: 'android', label: 'En Android', value: walletStats.googleInstalled },
              { id: 'five', icon: 'star', label: 'Con 5+ estrellas', value: walletStats.withFiveOrMore },
              { id: 'free', icon: 'gift', label: 'Corte gratis listo', value: walletStats.freeCutReady },
            ]}
            />
            {byStars.length > 0 && (
              <div>
                <SectionLabel>Clientes por estrellas</SectionLabel>
                <div className="pn-mkt-hist">
                  {byStars.map((n, i) => (
                    <div
                      key={i}
                      className={`pn-mkt-hist-bar${i >= 10 ? ' is-goal' : ''}`}
                      title={`${plural(n, 'cliente', 'clientes')} con ${plural(i, 'estrella', 'estrellas')}`}
                    >
                      <i style={{ '--h': `${Math.max(n ? 4 : 1, Math.round((n / maxStars) * 100))}%` }} />
                      <span>{i}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </Card>

      {/* Envío del link de la tarjeta por correo. Va por tandas desde el
          navegador (ver ?mode=wallet-send-cards): así se ve el avance y se
          puede detener a mitad sin dejar a nadie a medias. */}
      <Card
        title="Mandar la tarjeta por correo"
        subtitle="Cada cliente recibe su propio link para agregar la tarjeta."
      >
        <div className="pn-stack">
          <Note icon="mail">
            Al abrir el link desde el celular le aparece un solo botón: Apple Wallet en iPhone, Google Wallet en Android. Se omite a quien ya la tiene agregada.
          </Note>

          <div className="pn-form-row">
            <Field
              label="Teléfono del cliente"
              htmlFor="mkt-card-phone"
              hint="Para probar con uno: 9 dígitos, usa su tarjeta real."
            >
              <input
                id="mkt-card-phone"
                className="input"
                value={cardTestPhone}
                onChange={(e) => setCardTestPhone(e.target.value.replace(/\D/g, '').slice(0, 9))}
                placeholder="912345678"
                inputMode="numeric"
                autoComplete="off"
              />
            </Field>
            <Field
              label="Correo de prueba"
              optional
              htmlFor="mkt-card-email"
              error={testEmailBad ? 'Revisa el correo: así no va a llegar.' : null}
              hint="Si lo dejas vacío, le llega al correo del cliente."
            >
              <input
                id="mkt-card-email"
                className="input"
                type="email"
                value={cardTestEmail}
                onChange={(e) => setCardTestEmail(e.target.value.trim())}
                placeholder="tu@correo.cl"
                inputMode="email"
                autoComplete="off"
              />
            </Field>
          </div>

          <div className="pn-hstack pn-mkt-card-actions">
            <Button
              variant="secondary"
              icon="wallet"
              loading={cardSending && cardKind === 'test'}
              disabled={!testPhoneOk || testEmailBad || cardSending}
              onClick={sendTest}
            >
              Probar con uno
            </Button>
            <Button
              variant="primary"
              icon="mail"
              loading={cardSending && cardKind !== 'test'}
              disabled={cardSending}
              onClick={() => setBulkConfirming(true)}
            >
              Enviar a los que faltan
            </Button>
            {cardSending && cardKind !== 'test' && (
              <Button variant="plain" icon="close" disabled={stopping} onClick={stopCards}>
                {stopping ? 'Deteniendo…' : 'Detener'}
              </Button>
            )}
          </div>

          {cardProgress && (
            <div role="status" aria-live="polite">
              <Note icon={cardSending ? 'send' : 'info'}>{cardProgress}</Note>
            </div>
          )}
        </div>
      </Card>

      <Card title="Clientes frecuentes" subtitle="3 o más visitas">
        {!topClients.length ? (
          <EmptyState compact icon="users" title="Sin datos aún" />
        ) : (
          <div className="pn-mkt-clients">
            {topClients.slice(0, 8).map((c) => (
              <div key={clientKey ? clientKey(c) : (c.id ?? c.phone)} className="pn-mkt-client">
                <span className="pn-mkt-client-name">{c.name}</span>
                <span className="pn-mkt-client-amt">{CLP(c.totalSpent || 0)}</span>
                <span className="pn-mkt-client-meta">{plural(Number(c.visits || 0), 'visita', 'visitas')}</span>
              </div>
            ))}
          </div>
        )}
      </Card>

      <ConfirmDialog
        open={campaignConfirming}
        onCancel={() => setCampaignConfirming(false)}
        onConfirm={sendWalletCampaign}
        busy={campaignSending}
        icon="megaphone"
        title="¿Enviar esta campaña?"
        message={walletStats
          ? `Se enviará a ${plural(recipients, 'cliente', 'clientes')} (${audienceLabel}). No se puede deshacer.`
          : `Se enviará a los clientes de «${audienceLabel}» que tienen la tarjeta agregada. No se puede deshacer.`}
        confirmLabel={walletStats ? `Enviar a ${recipients}` : 'Enviar'}
      >
        {campaignError && <InlineAlert tone="error" className="pn-mkt-confirm-alert">{campaignError}</InlineAlert>}
      </ConfirmDialog>

      <ConfirmDialog
        open={bulkConfirming}
        onCancel={() => setBulkConfirming(false)}
        onConfirm={sendBulk}
        icon="mail"
        title="¿Mandar la tarjeta por correo?"
        message="Le llega el correo con su tarjeta de fidelidad a todos los clientes con correo que todavía no la tienen. Va por tandas: puedes detenerlo a mitad y retomar sin repetir a nadie."
        confirmLabel="Enviar a los que faltan"
      />
    </div>
  )
}
