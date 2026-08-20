/* PIMP STUDIO · Workshop "Contenido que Vende" — Página (React + React Router)
   Drop-in para Vite. Requiere react-router-dom. Importa su propio CSS y datos.
   Logo esperado en /public/assets/pimp-studio-logo.jpg (degrada si falta). */
import React, { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { WORKSHOP } from '../data/workshop.js'
import SiteNav from '../components/SiteNav.jsx'
import { addLocalEnrollment } from '../enrollmentsStore.js'
import { Lamp } from '../components/ui/lamp.jsx'
import { Sparkles } from '../components/ui/sparkles.jsx'
import { EditableText } from '../components/edit/EditableText.jsx'
import { Editable } from '../components/edit/Editable.jsx'
import WKC from '../data/content/workshop.json'
import '../styles/workshop.css'

/* ---------- helpers UI ---------- */
const WK_ICONS = {
  scissors: "M14.5 9.5L21 3M14.5 14.5L21 21M9.5 12l-6.5-9M9.5 12l-6.5 9M9.5 12a2.5 2.5 0 1 1-5 0 2.5 2.5 0 0 1 5 0z",
  calendar: "M7 3v3M17 3v3M3.5 9h17M5 5h14a1.5 1.5 0 0 1 1.5 1.5V19A1.5 1.5 0 0 1 19 20.5H5A1.5 1.5 0 0 1 3.5 19V6.5A1.5 1.5 0 0 1 5 5z",
  user: "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4.5 20a7.5 7.5 0 0 1 15 0",
  star: "M12 3l2.6 5.3 5.8.8-4.2 4.1 1 5.8L12 16.8 6.8 19l1-5.8L3.6 9.1l5.8-.8z",
  spark: "M12 3v6M12 15v6M3 12h6M15 12h6",
  check: "M5 12.5l4.5 4.5L19 7",
  arrowRight: "M5 12h14M13 6l6 6-6 6",
  pin: "M12 21s7-6.2 7-11a7 7 0 1 0-14 0c0 4.8 7 11 7 11zM12 12a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z",
  gift: "M12 8v13M3.5 8h17v3.5h-17zM4.5 11.5h15V20a1 1 0 0 1-1 1h-13a1 1 0 0 1-1-1zM12 8S10.5 3.5 8 4.5 9.5 8 12 8zM12 8s1.5-4.5 4-3.5S14.5 8 12 8z",
  whatsapp: "M12 3a9 9 0 0 0-7.7 13.6L3 21l4.5-1.2A9 9 0 1 0 12 3z",
  instagram: "M7 3h10a4 4 0 0 1 4 4v10a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4V7a4 4 0 0 1 4-4zM12 8.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7zM17 6.5h.01",
  plus: "M12 5v14M5 12h14",
  menu: "M4 7h16M4 12h16M4 17h16",
  close: "M6 6l12 12M18 6L6 18",
  bolt: "M13 2L4 14h6l-1 8 9-12h-6z",
  camera: "M4 7h3l1.5-2h7L17 7h3a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V8a1 1 0 0 1 1-1zM12 16.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7z",
  film: "M4 4h16v16H4zM4 9h16M4 15h16M9 4v16M15 4v16",
  award: "M12 14a5 5 0 1 0 0-10 5 5 0 0 0 0 10zM9 13l-1.5 7L12 18l4.5 2L15 13",
};

function Icon({ name, size = 20, stroke = 1.6, color = "currentColor", style }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color}
      strokeWidth={stroke} strokeLinecap="round" strokeLinejoin="round" style={style} aria-hidden="true">
      <path d={WK_ICONS[name] || WK_ICONS.spark} />
    </svg>
  );
}

function useInView(opts) {
  const ref = useRef(null);
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) { setSeen(true); return; }
    const io = new IntersectionObserver((entries) => {
      entries.forEach((e) => { if (e.isIntersecting) { setSeen(true); io.unobserve(el); } });
    }, opts || { threshold: 0.16 });
    io.observe(el);
    const fb = setTimeout(() => setSeen(true), 1400);
    return () => { io.disconnect(); clearTimeout(fb); };
  }, []);
  return [ref, seen];
}

function Reveal({ children, className = "", style, as = "div" }) {
  const [ref, seen] = useInView();
  const Tag = as;
  return (
    <Tag ref={ref} className={`wks-reveal ${seen ? "is-in" : ""} ${className}`} style={style}>
      {children}
    </Tag>
  );
}

/* Imagen B/N con fallback a placeholder si falla la carga.
   Con `editId` la imagen es editable (mover/redimensionar/reemplazar) desde el
   editor visual; sin él, se renderiza plana como antes. */
function Bw({ src, alt, label = "Foto", className = "", innerClass = "", editId }) {
  const [failed, setFailed] = useState(false);
  const imgProps = { src, alt, loading: "lazy", onError: () => setFailed(true), className: innerClass };
  return (
    <div className={`wks-img ${className} ${failed ? "is-failed" : ""}`} data-label={label}>
      {!failed && (editId
        ? <Editable as="img" editId={editId} {...imgProps} />
        : <img {...imgProps} />)}
    </div>
  );
}

/* ID de YouTube desde cualquier formato de URL (watch/share/embed/shorts/live). */
function ytId(url) {
  const m = (url || "").match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?v=|embed\/|shorts\/|live\/))([\w-]{11})/);
  return m ? m[1] : null;
}

/* Normaliza una URL de YouTube o Vimeo (watch/share/embed) a su URL de embed
   con autoplay. Si ya es una URL de embed, la deja igual. */
function toEmbedUrl(url) {
  if (!url) return "";
  const yt = ytId(url);
  if (yt) return `https://www.youtube-nocookie.com/embed/${yt}?autoplay=1&rel=0&modestbranding=1&playsinline=1`;
  const m = url.match(/vimeo\.com\/(?:video\/)?(\d+)/);
  if (m) return `https://player.vimeo.com/video/${m[1]}?autoplay=1&title=0&byline=0&portrait=0`;
  return url;
}

/* Embed de video con fachada "click-to-play": muestra la VISTA PREVIA propia
   del video (miniatura de YouTube), no una foto del sitio. No carga el iframe
   pesado hasta que el usuario pulsa play → mejor rendimiento/LCP.
   `vertical` para reels 9:16. */
function VideoEmbed({ src, title = "Video", vertical = false }) {
  const [playing, setPlaying] = useState(false);
  const embed = toEmbedUrl(src);
  const yt = ytId(src);
  const thumb = yt ? `https://img.youtube.com/vi/${yt}/maxresdefault.jpg` : null;
  return (
    <div className={`wks-video ${vertical ? "is-vertical" : ""}`}>
      {playing ? (
        <iframe
          className="wks-video-frame"
          src={embed}
          title={title}
          loading="lazy"
          allow="autoplay; fullscreen; picture-in-picture; encrypted-media"
          allowFullScreen
        />
      ) : (
        <button type="button" className="wks-video-poster" onClick={() => setPlaying(true)} aria-label={`Reproducir: ${title}`}>
          {thumb && <img src={thumb} alt={title} loading="lazy" />}
          <span className="wks-video-play" aria-hidden="true">
            <svg width="26" height="26" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z" /></svg>
          </span>
        </button>
      )}
    </div>
  );
}

/* Sección dedicada del video (VSL), centrada y prominente — "entremedio". */
function VideoShowcase() {
  if (!WK.video) return null;
  return (
    <section className="wks-section wks-vsl">
      <div className="wks-container">
        <Reveal className="wks-head">
          <Lamp className="bru-lamp--sec" />
          <span className="wks-eyebrow"><EditableText file="workshop" path="video.eyebrow">{WKC.video.eyebrow}</EditableText></span>
          <h2 className="wks-h2"><EditableText file="workshop" path="video.title" as="span">{WKC.video.title}</EditableText></h2>
          <hr className="wks-rule" />
        </Reveal>
        <Reveal className="wks-vsl-frame">
          <VideoEmbed src={WK.video.url} title={WKC.video.title} />
        </Reveal>
      </div>
    </section>
  );
}

function formatCLP(n) {
  return "$" + Math.round(Number(n) || 0).toLocaleString("es-CL");
}

const WK = WORKSHOP;

/* ---------- hooks ---------- */
function useScrolled(threshold = 40) {
  const [v, setV] = useState(false);
  useEffect(() => {
    const on = () => setV(window.scrollY > threshold);
    on();
    window.addEventListener("scroll", on, { passive: true });
    return () => window.removeEventListener("scroll", on);
  }, []);
  return v;
}

function useCountdown(targetISO) {
  const [t, setT] = useState(() => calc(targetISO));
  useEffect(() => {
    const id = setInterval(() => setT(calc(targetISO)), 1000);
    return () => clearInterval(id);
  }, [targetISO]);
  return t;
}
function calc(targetISO) {
  const diff = Math.max(0, new Date(targetISO).getTime() - Date.now());
  const d = Math.floor(diff / 86400000);
  const h = Math.floor((diff % 86400000) / 3600000);
  const m = Math.floor((diff % 3600000) / 60000);
  const s = Math.floor((diff % 60000) / 1000);
  const pad = (x) => String(x).padStart(2, "0");
  return { d: pad(d), h: pad(h), m: pad(m), s: pad(s) };
}

function smoothTo(id) {
  const el = document.getElementById(id);
  if (el) window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - 64, behavior: "smooth" });
}

/* ============================================================ HERO */
function Hero({ onReserve }) {
  const cd = useCountdown(WK.meta.dateISO);
  const [failed, setFailed] = useState(false);
  const m = WK.meta;
  return (
    <section className="wks-hero" id="top">
      <div className={`wks-hero-media ${failed ? "is-failed" : ""}`}>
        {!failed && <Editable as="img" editId="workshop:hero" src={WK.photos.hero} alt="Barbería premium" onError={() => setFailed(true)} />}
      </div>
      <div className="wks-hero-overlay" />
      <div className="wks-hero-inner">
        <div className="wks-container wks-hero-grid">
          <div className="wks-hero-text">
            <Editable as="img" editId="workshop:logo" className="wks-hero-logo" src="/assets/ascension-logo.webp" alt="ASCENSIÓN" />
            <div className="wks-hero-figwrap" aria-hidden="true">
              <Editable as="img" editId="workshop:heroCutout" src="/assets/ascension-hero-cutout.webp" alt="" />
            </div>
            <div className="wks-hero-kicker">
              <span className="wks-chip"><Icon name="scissors" size={13} /> Edición barbería premium</span>
              <span className="wks-eyebrow"><EditableText file="workshop" path="meta.kicker">{WKC.meta.kicker}</EditableText></span>
            </div>
            <h1>
              <EditableText file="workshop" path="meta.title1">{WKC.meta.title1}</EditableText>
              <span className="wks-hero-line2"><EditableText file="workshop" path="meta.title2">{WKC.meta.title2}</EditableText></span>
            </h1>
            <p className="wks-hero-sub"><EditableText file="workshop" path="meta.subtitle" as="span">{WKC.meta.subtitle}</EditableText></p>
            <div className="wks-hero-actions">
              <button className="wks-btn wks-btn-gold" onClick={onReserve}>
                <Icon name="calendar" size={16} /> Asegura tu silla
              </button>
              <button className="wks-btn wks-btn-ghost" onClick={() => smoothTo("programa")}>
                Ver el programa
              </button>
            </div>
          </div>

          <aside className="wks-hero-card">
            <div className="wks-card-row">
              <div className="wks-date-badge">
                <b>{m.dateLabel}</b>
              </div>
              <span className="wks-chip"><Icon name="pin" size={12} /> Cupos 20</span>
            </div>
            <div className="wks-countdown">
              {[["d", "Días"], ["h", "Hrs"], ["m", "Min"], ["s", "Seg"]].map(([k, l]) => (
                <div className="wks-cd-cell" key={k}><b>{cd[k]}</b><span>{l}</span></div>
              ))}
            </div>
            <div className="wks-price-line">
              <span className="wks-price-now">{formatCLP(m.priceNow)}</span>
              <span className="wks-price-was">{formatCLP(m.priceWas)}</span>
              <span className="wks-price-off">{m.off} OFF</span>
            </div>
          </aside>
        </div>
      </div>
      <div className="wks-scroll-hint"><span>Scroll</span><i /></div>
    </section>
  );
}

/* ============================================================ TRANSFORM */
function Transform() {
  return (
    <section className="wks-section" id="transformar">
      <div className="wks-container">
        <Reveal className="wks-head">
          <span className="wks-eyebrow"><EditableText file="workshop" path="transform.eyebrow">{WKC.transform.eyebrow}</EditableText></span>
          <h2 className="wks-h2"><EditableText file="workshop" path="transform.h2" as="span">{WKC.transform.h2}</EditableText></h2>
          <hr className="wks-rule" />
        </Reveal>
        <div className="wks-transform-grid">
          {WK.transform.map((c, i) => (
            <Reveal key={c.n} className="wks-tcard" style={{ transitionDelay: `${i * 0.08}s` }}>
              <span className="wks-tcard-num">{c.n}</span>
              <Bw src={WK.photos[c.photo]} alt={c.title} label={c.title} editId={`workshop:card:${c.photo}`} />
              <div className="wks-tcard-body">
                <h3><EditableText file="workshop" path={`transform.cards.${i}.title`} as="span">{WKC.transform.cards[i].title}</EditableText></h3>
                <p><EditableText file="workshop" path={`transform.cards.${i}.body`} as="span">{WKC.transform.cards[i].body}</EditableText></p>
              </div>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ============================================================ QUOTE 50/50 */
function QuoteBlock() {
  const [ref, seen] = useInView({ threshold: 0.3 });
  return (
    <section className="wks-section wks-section-alt wks-quote">
      <div className="wks-container wks-quote-grid" ref={ref}>
        <div>
          <span className="wks-eyebrow" style={{ marginBottom: "1.2rem", display: "inline-flex" }}><EditableText file="workshop" path="quote.eyebrow">{WKC.quote.eyebrow}</EditableText></span>
          <blockquote>
            “<EditableText file="workshop" path="quote.quotePrefix" as="span">{WKC.quote.quotePrefix}</EditableText>{" "}
            <span className="q"><EditableText file="workshop" path="quote.quoteHighlight" as="span">{WKC.quote.quoteHighlight}</EditableText></span>”
          </blockquote>
          <cite><EditableText file="workshop" path="quote.cite">{WKC.quote.cite}</EditableText></cite>
        </div>
        <div className={`wks-5050 ${seen ? "is-in" : ""}`}>
          <div className="wks-5050-row">
            <div className="lbl"><span>Técnica</span><span>50%</span></div>
            <div className="wks-5050-bar"><i className="tech" /></div>
          </div>
          <div className="wks-5050-row">
            <div className="lbl"><span>Visibilidad</span><span className="wks-gold">50%</span></div>
            <div className="wks-5050-bar"><i className="vis" /></div>
          </div>
        </div>
      </div>
    </section>
  );
}

/* ============================================================ FEATURE ROW */
function FeatureRow({ data, contentKey, reversed }) {
  const c = WKC[contentKey]
  return (
    <section className="wks-section">
      <div className="wks-container">
        <Reveal className={`wks-feature ${reversed ? "is-rev" : ""}`}>
          <div className="wks-feature-media">
            <Bw src={WK.photos[data.photo]} alt={c.title} label={c.eyebrow} editId={`workshop:feat:${data.photo}`} />
            <span className="wks-chip wks-feature-tag"><Icon name="bolt" size={12} /> En vivo</span>
          </div>
          <div className="wks-feature-body">
            <Lamp className="bru-lamp--sec" />
            <span className="wks-eyebrow"><EditableText file="workshop" path={`${contentKey}.eyebrow`}>{c.eyebrow}</EditableText></span>
            <h2 className="wks-h2" style={{ fontSize: "clamp(1.7rem,3.4vw,2.6rem)" }}><EditableText file="workshop" path={`${contentKey}.title`} as="span">{c.title}</EditableText></h2>
            <ul className="wks-detail-list">
              {data.items.map((it, i) => (
                <li key={it.h}>
                  <span className="ic"><Icon name={it.icon} size={18} /></span>
                  <div>
                    <h4><EditableText file="workshop" path={`${contentKey}.items.${i}.h`} as="span">{c.items[i].h}</EditableText></h4>
                    <p><EditableText file="workshop" path={`${contentKey}.items.${i}.p`} as="span">{c.items[i].p}</EditableText></p>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </Reveal>
      </div>
    </section>
  );
}

/* ============================================================ PROGRAMA tabs */
function Programa() {
  const [active, setActive] = useState(0);
  const mod = WK.modules[active];
  return (
    <section className="wks-section wks-section-alt" id="programa">
      <div className="wks-container">
        <Reveal className="wks-head">
          <span className="wks-eyebrow"><EditableText file="workshop" path="programa.eyebrow">{WKC.programa.eyebrow}</EditableText></span>
          <h2 className="wks-h2"><EditableText file="workshop" path="programa.h2" as="span">{WKC.programa.h2}</EditableText></h2>
          <hr className="wks-rule" />
        </Reveal>
        <div className="wks-modules">
          <div className="wks-mod-tabs">
            {WK.modules.map((mm, i) => (
              <button key={mm.n} className={`wks-mod-tab ${i === active ? "is-active" : ""}`} onClick={() => setActive(i)}>
                <span className="n">{mm.n}</span>
                <span className="t"><EditableText file="workshop" path={`modules.${i}.title`}>{WKC.modules[i].title}</EditableText></span>
              </button>
            ))}
          </div>
          <div className="wks-mod-panel" key={active}>
            <div className="wks-mod-panel-media wks-fade-key">
              {mod.video ? (
                <div className="wks-img" data-label={mod.title}>
                  <video src={mod.video} poster={mod.poster} autoPlay muted loop playsInline preload="metadata" />
                </div>
              ) : (
                <Bw src={WK.photos[mod.photo]} alt={mod.title} label={mod.title} editId={`workshop:mod:${mod.photo}`} />
              )}
            </div>
            <div className="wks-mod-panel-body wks-fade-key">
              <span className="wks-eyebrow">{mod.n}</span>
              <h3><EditableText file="workshop" path={`modules.${active}.title`} as="span">{WKC.modules[active].title}</EditableText></h3>
              <ul className="wks-mod-points">
                {mod.points.map((p, i) => (
                  <li key={p.b}>
                    <span className="dot"><Icon name="check" size={12} /></span>
                    <span><b><EditableText file="workshop" path={`modules.${active}.points.${i}.b`}>{WKC.modules[active].points[i].b}</EditableText>.</b> <span><EditableText file="workshop" path={`modules.${active}.points.${i}.s`} as="span">{WKC.modules[active].points[i].s}</EditableText></span></span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

/* ============================================================ CRONOGRAMA */
function Cronograma() {
  return (
    <section className="wks-section" id="cronograma">
      <div className="wks-container">
        <Reveal className="wks-head">
          <span className="wks-eyebrow"><EditableText file="workshop" path="cronograma.eyebrow">{WKC.cronograma.eyebrow}</EditableText></span>
          <h2 className="wks-h2"><EditableText file="workshop" path="cronograma.h2" as="span">{WKC.cronograma.h2}</EditableText></h2>
          <hr className="wks-rule" />
        </Reveal>
        <Reveal className="wks-timeline">
          {WK.timeline.map((t, i) => (
            <div className="wks-tl-row" key={t.time} style={{ transitionDelay: `${i * 0.06}s` }}>
              <div className="wks-tl-time">{t.time}</div>
              <span className="wks-tl-dot" />
              <div className="wks-tl-main">
                <b><EditableText file="workshop" path={`cronograma.timeline.${i}.b`}>{WKC.cronograma.timeline[i].b}</EditableText></b>
                <span><EditableText file="workshop" path={`cronograma.timeline.${i}.s`}>{WKC.cronograma.timeline[i].s}</EditableText></span>
              </div>
            </div>
          ))}
        </Reveal>
      </div>
    </section>
  );
}

/* ============================================================ GIVE + KIT */
function GiveKit() {
  return (
    <section className="wks-section wks-section-alt">
      <div className="wks-container wks-two">
        <Reveal className="wks-panel">
          <div className="wks-panel-head">
            <span className="ic"><Icon name="award" size={20} /></span>
            <h3><EditableText file="workshop" path="give.title" as="span">{WKC.give.title}</EditableText></h3>
          </div>
          <ul className="wks-give-list">
            {WK.give.map((g, i) => (
              <li key={g.b} style={{ transitionDelay: `${i * 0.05}s` }}>
                <span className="ck"><Icon name="check" size={16} /></span>
                <div><b><EditableText file="workshop" path={`give.items.${i}.b`}>{WKC.give.items[i].b}</EditableText></b><span><EditableText file="workshop" path={`give.items.${i}.s`}>{WKC.give.items[i].s}</EditableText></span></div>
              </li>
            ))}
          </ul>
        </Reveal>
        <Reveal className="wks-panel" style={{ transitionDelay: "0.08s" }}>
          <div className="wks-panel-head">
            <span className="ic"><Icon name="bolt" size={20} /></span>
            <h3><EditableText file="workshop" path="kit.title" as="span">{WKC.kit.title}</EditableText></h3>
          </div>
          <ul className="wks-give-list">
            {WK.kit.map((g, i) => (
              <li key={g.b} style={{ transitionDelay: `${i * 0.05}s` }}>
                <span className="ck"><Icon name="check" size={16} /></span>
                <div><b><EditableText file="workshop" path={`kit.items.${i}.b`}>{WKC.kit.items[i].b}</EditableText></b><span><EditableText file="workshop" path={`kit.items.${i}.s`}>{WKC.kit.items[i].s}</EditableText></span></div>
              </li>
            ))}
          </ul>
        </Reveal>
      </div>
    </section>
  );
}

/* ============================================================ PRICING */
function Pricing({ onReserve }) {
  const [ref, seen] = useInView({ threshold: 0.3 });
  const [failed, setFailed] = useState(false);
  const m = WK.meta;
  const pct = Math.round((m.seatsTaken / m.seatsTotal) * 100);
  const left = m.seatsTotal - m.seatsTaken;
  return (
    <section className="wks-section wks-pricing" id="precio">
      <div className={`wks-pricing-bg ${failed ? "is-failed" : ""}`}>
        {!failed && <Editable as="img" editId="workshop:pricingBg" src={WK.photos.pricing} alt="" onError={() => setFailed(true)} />}
      </div>
      <div className="wks-container">
        <div className="wks-pricing-card" ref={ref}>
          <div className="wks-pricing-top">
            <div style={{ display: "grid", gap: "0.8rem" }}>
              <span className="wks-eyebrow">Asegura tu silla</span>
              <div className="wks-pricing-amount">
                <span className="now">{formatCLP(m.priceNow)}</span>
                <span className="was">{formatCLP(m.priceWas)}</span>
                <span className="wks-price-off">{m.off} OFF</span>
              </div>
              <p className="wks-pricing-note"><EditableText file="workshop" path="meta.pricingNote" as="span">{WKC.meta.pricingNote}</EditableText></p>
            </div>
            <div className="wks-cupos">
              <div className="wks-cupos-head">
                <b>{left} cupos restantes</b>
                <span>{m.seatsTaken}/{m.seatsTotal} ocupados</span>
              </div>
              <div className="wks-cupos-bar"><i style={{ width: seen ? `${pct}%` : 0 }} /></div>
              <span style={{ color: "var(--wk-muted)", fontSize: "0.78rem" }}><EditableText file="workshop" path="meta.exclusivityNote">{WKC.meta.exclusivityNote}</EditableText></span>
            </div>
          </div>
          <div className="wks-pricing-foot">
            <p className="wks-pricing-note" style={{ margin: 0 }}>{m.dateLong}</p>
            <button className="wks-btn wks-btn-gold" onClick={onReserve}>
              <Icon name="calendar" size={16} /> Reservar ahora
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}

/* ============================================================ REGISTER */
function Register({ formRef }) {
  const [form, setForm] = useState({ name: "", phone: "", email: "", edition: WK.meta.dateLabel });
  const [errors, setErrors] = useState({});
  const [sent, setSent] = useState(false);
  const m = WK.meta;

  const set = (k) => (e) => {
    setForm((f) => ({ ...f, [k]: e.target.value }));
    setErrors((er) => ({ ...er, [k]: undefined }));
  };

  const validate = () => {
    const er = {};
    if (form.name.trim().length < 3) er.name = "Ingresa tu nombre completo.";
    if (!/^[+\d][\d\s()-]{7,}$/.test(form.phone.trim())) er.phone = "Teléfono no válido.";
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) er.email = "Email no válido.";
    setErrors(er);
    return Object.keys(er).length === 0;
  };

  const submit = async (e) => {
    e.preventDefault();
    if (!validate()) return;
    /* Respaldo local: aparece de inmediato en el panel interno (Inscripciones),
       aunque el backend no esté disponible (p. ej. en desarrollo). */
    addLocalEnrollment({ ...form, source: 'workshop' });
    /* Enviar a API (enrollments + users) — no bloquea si falla */
    try {
      await fetch('/api/enrollments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...form, source: 'workshop' }),
      });
    } catch (x) { /* noop */ }
    setSent(true);
  };

  return (
    <section className="wks-section" id="inscribir" ref={formRef}>
      <div className="wks-container">
        <Reveal className="wks-head is-center">
          <span className="wks-eyebrow"><EditableText file="workshop" path="register.eyebrow">{WKC.register.eyebrow}</EditableText></span>
          <h2 className="wks-h2"><EditableText file="workshop" path="register.h2" as="span">{WKC.register.h2}</EditableText></h2>
          <hr className="wks-rule" />
        </Reveal>
        <div className="wks-register-grid">
          <aside className="wks-form-aside">
            <div className="wks-summary-row"><span>Workshop</span><b>Contenido que Vende</b></div>
            <div className="wks-summary-row"><span>Fecha</span><b>{m.dateLabel}</b></div>
            <div className="wks-summary-row"><span>Cupos</span><b>{m.seatsTotal - m.seatsTaken} disponibles</b></div>
            <div className="wks-summary-total">
              <div><span style={{ color: "var(--wk-muted)", fontSize: "0.8rem" }}>Inversión total</span>
                <div style={{ display: "flex", gap: "0.5rem", alignItems: "baseline" }}>
                  <span className="v">{formatCLP(m.priceNow)}</span>
                  <span style={{ color: "var(--wk-muted)", textDecoration: "line-through", fontSize: "0.9rem" }}>{formatCLP(m.priceWas)}</span>
                </div>
              </div>
              <span className="wks-price-off">{m.off}</span>
            </div>
          </aside>

          {sent ? (
            <div className="wks-success">
              <span className="ring"><Icon name="check" size={26} /></span>
              <h3>¡Cupo reservado, {form.name.split(" ")[0]}!</h3>
              <p style={{ margin: 0, color: "var(--wk-ink-soft)" }}>
                Te escribiremos a <b className="wks-gold">{form.email}</b> y al {form.phone} con los datos de pago y la ubicación exacta. Nos vemos el {m.dateLabel}.
              </p>
              <button className="wks-btn wks-btn-ghost wks-btn-sm" onClick={() => { setSent(false); setForm({ name: "", phone: "", email: "", edition: form.edition }); }}>
                Inscribir a otra persona
              </button>
            </div>
          ) : (
            <form className="wks-form" onSubmit={submit} noValidate>
              <div className={`wks-field ${errors.name ? "is-error" : ""}`}>
                <label>Nombre completo</label>
                <input value={form.name} onChange={set("name")} placeholder="Tu nombre y apellido" />
                <span className="err">{errors.name}</span>
              </div>
              <div className="wks-form-row">
                <div className={`wks-field ${errors.phone ? "is-error" : ""}`}>
                  <label>WhatsApp</label>
                  <input value={form.phone} onChange={set("phone")} placeholder="+56 9 ..." inputMode="tel" />
                  <span className="err">{errors.phone}</span>
                </div>
                <div className={`wks-field ${errors.email ? "is-error" : ""}`}>
                  <label>Email</label>
                  <input value={form.email} onChange={set("email")} placeholder="tu@correo.com" inputMode="email" />
                  <span className="err">{errors.email}</span>
                </div>
              </div>
              <div className="wks-field">
                <label>Edición</label>
                <select value={form.edition} onChange={set("edition")}>
                  <option>{m.dateLabel}</option>
                  <option>Próxima edición · lista de espera</option>
                </select>
              </div>
              <button className="wks-btn wks-btn-gold wks-btn-block" type="submit" style={{ marginTop: "0.4rem" }}>
                <Icon name="check" size={16} /> Inscríbete ahora · {formatCLP(m.priceNow)}
              </button>
              <p style={{ margin: 0, color: "var(--wk-muted-2)", fontSize: "0.76rem", textAlign: "center" }}>
                <EditableText file="workshop" path="register.formNote" as="span">{WKC.register.formNote}</EditableText>
              </p>
            </form>
          )}
        </div>
      </div>
    </section>
  );
}

/* ============================================================ FAQ */
/* Mide la altura real de la respuesta (en vez de un max-height fijo) para
   que el acordeón nunca recorte respuestas largas. */
function FaqItem({ i, f, isOpen, onToggle }) {
  const pRef = useRef(null);
  const [h, setH] = useState(0);
  useEffect(() => {
    if (pRef.current) setH(pRef.current.scrollHeight);
  }, [isOpen, f.a]);
  return (
    <div className={`wks-faq-item ${isOpen ? "is-open" : ""}`}>
      <button className="wks-faq-q" onClick={onToggle}>
        <EditableText file="workshop" path={`faq.items.${i}.q`} as="span">{f.q}</EditableText>
        <span className="pm"><Icon name="plus" size={14} /></span>
      </button>
      <div className="wks-faq-a" style={{ maxHeight: isOpen ? `${h}px` : 0 }}>
        <p ref={pRef}><EditableText file="workshop" path={`faq.items.${i}.a`} as="span">{f.a}</EditableText></p>
      </div>
    </div>
  );
}

function Faq() {
  const [open, setOpen] = useState(0);
  return (
    <section className="wks-section wks-section-alt">
      <div className="wks-container">
        <Reveal className="wks-head is-center">
          <span className="wks-eyebrow"><EditableText file="workshop" path="faq.eyebrow">{WKC.faq.eyebrow}</EditableText></span>
          <h2 className="wks-h2"><EditableText file="workshop" path="faq.h2" as="span">{WKC.faq.h2}</EditableText></h2>
          <hr className="wks-rule" />
        </Reveal>
        <div className="wks-faq">
          {WKC.faq.items.map((f, i) => (
            <FaqItem key={i} i={i} f={f} isOpen={open === i} onToggle={() => setOpen(open === i ? -1 : i)} />
          ))}
        </div>
      </div>
    </section>
  );
}

/* ============================================================ FOOTER */
function Footer({ onReserve }) {
  const m = WK.meta;
  const links = [
    ["transformar", "Transformación"],
    ["programa", "Programa"],
    ["cronograma", "Cronograma"],
    ["precio", "Inversión"],
    ["inscribir", "Inscripción"],
  ];
  return (
    <footer className="wks-footer">
      <div className="wks-footer-wide">
        <div className="wks-footer-cols">
          <div className="wks-footer-brand">
            <img className="mfooter-wordmark" src="/assets/brunetti-workshop-wordmark.webp" alt="Brunetticutz" />
            <p className="wks-footer-tag">
              <EditableText file="workshop" path="footer.tagline" as="span">{WKC.footer.tagline}</EditableText>
            </p>
            <button className="wks-btn wks-btn-gold" onClick={onReserve}>
              <Icon name="calendar" size={16} /> Inscríbete ahora
            </button>
          </div>

          <nav className="wks-footer-col">
            <span className="wks-eyebrow">Explora</span>
            {links.map(([id, label]) => (
              <button key={id} type="button" className="wks-footer-link" onClick={() => smoothTo(id)}>
                {label}
              </button>
            ))}
          </nav>

          <div className="wks-footer-col">
            <span className="wks-eyebrow">Hablemos</span>
            <a className="wks-footer-link" href={`https://wa.me/${m.whatsapp.replace(/[^\d]/g, "")}`}>
              <Icon name="whatsapp" size={16} color="var(--wk-gold-lt)" /> WhatsApp directo
            </a>
            <a className="wks-footer-link" href="https://www.instagram.com/brunetticutz/" target="_blank" rel="noopener noreferrer">
              <Icon name="instagram" size={16} color="var(--wk-gold-lt)" /> {m.handle}
            </a>
          </div>
        </div>

        <div className="wks-footer-bottom">
          <span>© 2026 ASCENSIÓN · por Brunetti</span>
          <span>Edición barbería premium · {m.dateLabel}</span>
        </div>
      </div>
    </footer>
  );
}

/* ============================================================ STICKY CTA */
function StickyCta({ onReserve }) {
  const show = useScrolled(680);
  return (
    <div className={`wks-sticky-cta ${show ? "is-show" : ""}`}>
      <div className="px"><b>{formatCLP(WK.meta.priceNow)}</b><span>{WK.meta.off} · {WK.meta.dateLabel}</span></div>
      <button className="wks-btn wks-btn-gold wks-btn-sm" onClick={onReserve}><Icon name="calendar" size={14} /> Reservar silla</button>
    </div>
  );
}

/* ============================================================ APP */
export default function Workshop() {
  const navigate = useNavigate();
  const formRef = useRef(null);
  const reserve = () => smoothTo("inscribir");
  void navigate;
  return (
    <div className="wks">
      <div className="wks-shell">
        <SiteNav />
        <Hero onReserve={reserve} />
        {/* Fondo de partículas moradas para todo el cuerpo del workshop (el hero
            queda fuera, igual que en Home). Color a juego con la lámpara morada. */}
        <div className="bru-sparkles-zone">
          <Sparkles className="bru-sparkles--bg" color="180, 131, 243" />
          <Transform />
          <QuoteBlock />
          <FeatureRow data={WK.experiencia} contentKey="experiencia" />
          <FeatureRow data={WK.asesoria} contentKey="asesoria" reversed />
          <VideoShowcase />
          <Programa />
          <Cronograma />
          <GiveKit />
          <Pricing onReserve={reserve} />
          <Register formRef={formRef} />
          <Faq />
          <Footer onReserve={reserve} />
        </div>
      </div>
    </div>
  );
}
