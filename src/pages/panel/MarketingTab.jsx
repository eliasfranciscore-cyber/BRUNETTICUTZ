import React from 'react'
import { Icon, Stat } from '../../components/ui.jsx'
import { CLP } from '../../data.js'
import { AUDIENCES, AUDIENCE_BY_ID, AUDIENCE_LABEL, CAMPAIGN_TEMPLATES, Panel } from './shared.jsx'

/* Pestaña «marketing» del panel interno, extraída tal cual de Dashboard.jsx
   para que cada módulo viva en su propio archivo. Recibe en `ctx` el estado
   y las acciones de Dashboard que usa (ver el objeto `dash` que arma
   Dashboard.jsx). */
export default function MarketingTab({ ctx }) {
  const {
    activeClients,
    audienceCount,
    campaignAudience,
    campaignConfirming,
    campaignMessage,
    campaignSending,
    campaigns,
    cardProgress,
    cardSending,
    cardStopRef,
    cardTestEmail,
    cardTestPhone,
    clientKey,
    newClientsCount,
    recurringPct,
    sendCampaign,
    sendLoyaltyCards,
    setCampaignAudience,
    setCampaignConfirming,
    setCampaignMessage,
    setCardTestEmail,
    setCardTestPhone,
    topClients,
    walletStats,
  } = ctx
  return (
          <div className="animate-in mkt">
            {/* KPIs. Los que dependen del puente muestran "—" mientras cargan
                en vez de 0: un 0 se lee como "nadie instaló la tarjeta" y ya
                pasó que se tomaran decisiones mirando un dato que aún no
                llegaba. */}
            <div className="mkt-kpis">
              <Stat icon="wallet" label="Tarjetas en Wallet" accent
                value={walletStats ? walletStats.installed : "—"}
                hint={walletStats ? `${walletStats.installRate}% de ${walletStats.passesIssued} emitidas` : "Cargando…"} />
              <Stat icon="star" label="Estrellas del mes"
                value={walletStats ? walletStats.starsThisMonth : "—"}
                hint={walletStats ? `${walletStats.starsAllTime} desde el inicio` : null} />
              <Stat icon="gift" label="Corte gratis listo"
                value={walletStats ? walletStats.freeCutReady : "—"}
                hint={walletStats ? `${walletStats.freeCutsRedeemed} canjeados ya` : null} />
              <Stat icon="target" label="A punto (7-9)"
                value={walletStats ? (walletStats.audienceCounts?.almost_free ?? 0) : "—"}
                hint="Les falta poco" />
              <Stat icon="users" label="Clientes activos" value={activeClients.length} hint={`${recurringPct}% vuelve`} />
              <Stat icon="user" label="Nuevos hoy" value={newClientsCount} />
              <Stat icon="megaphone" label="Campañas del mes"
                value={walletStats ? walletStats.campaignsThisMonth : "—"}
                hint={walletStats ? `${walletStats.campaignsSent} en total` : null} />
              <Stat icon="percent" label="Promedio de estrellas"
                value={walletStats ? walletStats.avgStars : "—"}
                hint={walletStats ? `sobre ${walletStats.clientsWithStars} clientes` : null} />
            </div>

            {/* Campañas — el bloque principal de la pestaña, primero y no
                después de las métricas: es lo que el barbero viene a hacer. */}
            <Panel
              title="Campaña push"
              action={walletStats ? <span className="chip chip-gold">{audienceCount(campaignAudience)} destinatarios</span> : null}
            >
              <div style={{ display: "grid", gap: ".9rem" }}>
                <p className="mkt-note">
                  El mensaje aparece en la tarjeta del cliente y dispara una notificación en su celular. Solo llega a quien tiene el pase agregado — el resto no se entera.
                </p>

                <div style={{ display: "grid", gap: ".5rem" }}>
                  <span className="mkt-sub"><Icon name="target" size={13} /> A quién</span>
                  <div className="mkt-auds">
                    {AUDIENCES.map((a) => {
                      const n = audienceCount(a.id)
                      return (
                        <button
                          key={a.id}
                          type="button"
                          className={`mkt-aud${campaignAudience === a.id ? " is-on" : ""}`}
                          disabled={walletStats && n === 0}
                          title={a.desc}
                          onClick={() => { setCampaignAudience(a.id); setCampaignConfirming(false) }}
                        >
                          <Icon name={a.icon} size={13} />
                          <b>{a.label}</b>
                          <span className="n">{walletStats ? n : "…"}</span>
                        </button>
                      )
                    })}
                  </div>
                  <p className="mkt-note">{AUDIENCE_BY_ID[campaignAudience]?.desc}</p>
                </div>

                <div className="mkt-block">
                  <span className="mkt-sub"><Icon name="send" size={13} /> Mensaje</span>
                  <div className="mkt-tpls">
                    {CAMPAIGN_TEMPLATES.map((t) => (
                      <button key={t} type="button" className="mkt-tpl"
                        onClick={() => { setCampaignMessage(t); setCampaignConfirming(false) }}>
                        {t.length > 34 ? `${t.slice(0, 34)}…` : t}
                      </button>
                    ))}
                  </div>
                  <textarea
                    className="mkt-ta"
                    value={campaignMessage}
                    onChange={(e) => { setCampaignMessage(e.target.value.slice(0, 180)); setCampaignConfirming(false) }}
                    placeholder="Ej: Este viernes, 20% en barba. Te esperamos."
                    rows={3}
                  />
                  <div className="mkt-meta">
                    <span>Se ve en la tarjeta hasta que mandes otro mensaje.</span>
                    <span className={`mkt-count${campaignMessage.length > 150 ? " is-near" : ""}`}>{campaignMessage.length}/180</span>
                  </div>

                  {campaignMessage.trim() && (
                    <div className="mkt-preview">
                      <span className="who">Brunetti Cutz</span>
                      <span className="msg">{campaignMessage.trim()}</span>
                      <span className="to">→ {AUDIENCE_LABEL[campaignAudience]} · {audienceCount(campaignAudience)} cliente{audienceCount(campaignAudience) === 1 ? "" : "s"}</span>
                    </div>
                  )}

                  {/* Dos toques para enviar. Es irreversible: el push sale al
                      celular de decenas de clientes y no hay "deshacer". */}
                  {!campaignConfirming ? (
                    <button className="btn btn-gold btn-block"
                      disabled={!campaignMessage.trim() || campaignSending || (walletStats && audienceCount(campaignAudience) === 0)}
                      onClick={() => setCampaignConfirming(true)}>
                      <Icon name="megaphone" size={15} /> Enviar campaña
                    </button>
                  ) : (
                    <div className="mkt-actions">
                      <button className="btn btn-ghost" disabled={campaignSending} onClick={() => setCampaignConfirming(false)}>Cancelar</button>
                      <button className="btn btn-gold" disabled={campaignSending} onClick={sendCampaign}>
                        <Icon name="check" size={15} /> {campaignSending ? "Enviando…" : `Confirmar · ${audienceCount(campaignAudience)}`}
                      </button>
                    </div>
                  )}
                </div>

                {campaigns.length > 0 && (
                  <div className="mkt-block">
                    <span className="mkt-sub"><Icon name="clock" size={13} /> Historial</span>
                    <div className="mkt-hist">
                      {campaigns.slice(0, 8).map((c) => (
                        <div key={c.id} className="mkt-hist-row">
                          <span className="msg">{c.message}</span>
                          <span className="meta">
                            <span>{AUDIENCE_LABEL[c.audience] || c.audience}</span>
                            <span>· {c.recipientCount} destinatarios</span>
                            <span>· {String(c.createdAt || "").slice(0, 10)}</span>
                            <span className="src">{c.source === "brunetti" ? "Brunetti" : "Pimp Studio"}</span>
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </Panel>

            {/* Adopción de la tarjeta: emitidas vs realmente agregadas, y en
                qué punto del camino al corte gratis está la gente. */}
            <Panel
              title="Tarjeta de fidelidad"
              action={walletStats ? <span className="chip chip-gold">{walletStats.passesIssued} emitidas</span> : null}
            >
              {!walletStats && <p style={{ color: "var(--muted)", fontSize: ".84rem" }}>Cargando métricas…</p>}
              {walletStats && (
                <div style={{ display: "grid", gap: "1rem" }}>
                  <div style={{ display: "grid", gap: ".4rem" }}>
                    <div className="mkt-meta">
                      <span className="mkt-sub">Instaladas</span>
                      <span>{walletStats.installed} de {walletStats.passesIssued} · {walletStats.installRate}%</span>
                    </div>
                    <div className="mkt-meter"><i style={{ width: `${Math.min(100, walletStats.installRate)}%` }} /></div>
                  </div>

                  <div className="mkt-kpis">
                    <Stat icon="apple"   label="En iPhone"  value={walletStats.appleInstalled} />
                    <Stat icon="android" label="En Android" value={walletStats.googleInstalled} />
                    <Stat icon="star"    label="Con 5+ estrellas" value={walletStats.withFiveOrMore} />
                    <Stat icon="gift"    label="Corte gratis listo" value={walletStats.freeCutReady} accent />
                  </div>

                  <div style={{ display: "grid", gap: ".4rem" }}>
                    <span className="mkt-sub">Clientes por estrellas</span>
                    <div className="mkt-bars">
                      {walletStats.byStars.map((n, i) => {
                        const max = Math.max(1, ...walletStats.byStars)
                        return (
                          <div key={i} className={`mkt-bar${i >= 10 ? " is-goal" : ""}`} title={`${n} cliente${n === 1 ? "" : "s"} con ${i} estrella${i === 1 ? "" : "s"}`}>
                            <i style={{ height: `${Math.max(n ? 4 : 1, Math.round((n / max) * 62))}px` }} />
                            <span>{i}</span>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                </div>
              )}
            </Panel>

            {/* Envío del link de la tarjeta por correo. Va por tandas desde el
                navegador (ver ?mode=wallet-send-cards): así se ve el avance y
                se puede detener a mitad. */}
            <Panel title="Mandar la tarjeta por correo">
              <div style={{ display: "grid", gap: ".7rem" }}>
                <p className="mkt-note">
                  Cada cliente recibe su propio link. Al abrirlo desde el celular le aparece un solo botón: Apple Wallet en iPhone, Google Wallet en Android. Se omite a quien ya la tiene agregada.
                </p>
                <div className="mkt-fields">
                  <input
                    className="mkt-input"
                    value={cardTestPhone}
                    onChange={(e) => setCardTestPhone(e.target.value.replace(/\D/g, "").slice(0, 9))}
                    placeholder="9 dígitos (prueba)"
                    inputMode="numeric"
                  />
                  <input
                    className="mkt-input"
                    value={cardTestEmail}
                    onChange={(e) => setCardTestEmail(e.target.value.trim())}
                    placeholder="correo de prueba (opcional)"
                    inputMode="email"
                  />
                </div>
                <div className="mkt-actions">
                  <button className="btn btn-dark" disabled={cardTestPhone.length !== 9 || cardSending}
                    onClick={() => sendLoyaltyCards({ onlyPhone: cardTestPhone, again: true, includeInstalled: true, testEmail: cardTestEmail || null })}>
                    <Icon name="wallet" size={14} /> Probar con uno
                  </button>
                  <button className="btn btn-gold" disabled={cardSending} onClick={() => sendLoyaltyCards({})}>
                    <Icon name="mail" size={14} /> {cardSending ? "Enviando…" : "Enviar a los que faltan"}
                  </button>
                  {cardSending && <button className="btn btn-ghost" onClick={() => { cardStopRef.current = true }}>Detener</button>}
                </div>
                {cardProgress && <span style={{ fontSize: ".74rem", color: "var(--muted)" }}>{cardProgress}</span>}
              </div>
            </Panel>

            <Panel title="Clientes frecuentes" action={<span className="chip chip-gold">3+ visitas</span>}>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(200px,1fr))", gap: ".8rem" }}>
                {!topClients.length && <p style={{ color: "var(--muted)", fontSize: ".84rem" }}>Sin datos aún.</p>}
                {topClients.slice(0, 8).map((c) => (
                  <div key={clientKey(c)} style={{ padding: "1rem", border: "1px solid var(--hair)", borderRadius: 12, background: "rgba(0,0,0,0.25)" }}>
                    <span style={{ fontSize: ".85rem", fontWeight: 500, display: "block", marginBottom: ".3rem" }}>{c.name}</span>
                    <span className="font-display gold-text" style={{ fontSize: "1.05rem", fontWeight: 700 }}>{CLP(c.totalSpent || 0)}</span>
                    <span style={{ fontSize: ".72rem", color: "var(--muted-2)", display: "block", marginTop: ".2rem" }}>{c.visits} visitas</span>
                  </div>
                ))}
              </div>
            </Panel>
          </div>
  )
}
