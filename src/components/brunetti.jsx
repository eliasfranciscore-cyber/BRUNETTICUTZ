import React, { useEffect } from 'react'

/* ============================================================
   Brunetti — efectos cinematográficos portados del handoff
   (brunetti.js + aceternity navbar). Operan sobre el DOM dentro
   de rootRef para reproducir el comportamiento vanilla 1:1.
   ============================================================ */
export function useBrunettiFx(rootRef, { parallax = true } = {}) {
  useEffect(() => {
    const root = rootRef.current
    if (!root) return
    const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const cleanups = []

    /* 1. Scroll reveal (stagger) */
    const revealNodes = Array.from(root.querySelectorAll('[data-reveal]'))
    if (revealNodes.length) {
      if (reduce || !('IntersectionObserver' in window)) {
        revealNodes.forEach((n) => n.classList.add('is-in'))
      } else {
        const io = new IntersectionObserver((entries) => {
          entries.forEach((e) => {
            if (e.isIntersecting) { e.target.classList.add('is-in'); io.unobserve(e.target) }
          })
        }, { threshold: 0.16, rootMargin: '0px 0px -8% 0px' })
        revealNodes.forEach((n) => io.observe(n))
        cleanups.push(() => io.disconnect())
        // failsafe — nunca dejar contenido oculto
        const t = setTimeout(() => revealNodes.forEach((n) => n.classList.add('is-in')), 2600)
        cleanups.push(() => clearTimeout(t))
      }
    }

    /* 2. Navbar shrink */
    const header = root.querySelector('.site-header')
    if (header) {
      const onScroll = () => {
        if (window.scrollY > 60) header.classList.add('is-shrunk')
        else header.classList.remove('is-shrunk')
      }
      onScroll()
      window.addEventListener('scroll', onScroll, { passive: true })
      cleanups.push(() => window.removeEventListener('scroll', onScroll))
    }

    /* 3. Animated counters */
    const countNodes = Array.from(root.querySelectorAll('[data-count]'))
    if (countNodes.length) {
      const done = new WeakSet()
      const setFinal = (el) => {
        done.add(el)
        const target = parseFloat(el.getAttribute('data-count'))
        el.textContent = (el.getAttribute('data-prefix') || '') + target.toLocaleString('es-CL') + (el.getAttribute('data-suffix') || '')
      }
      const animate = (el) => {
        if (done.has(el)) return
        done.add(el)
        const target = parseFloat(el.getAttribute('data-count'))
        const suffix = el.getAttribute('data-suffix') || ''
        const prefix = el.getAttribute('data-prefix') || ''
        if (reduce || !('requestAnimationFrame' in window)) { el.textContent = prefix + target.toLocaleString('es-CL') + suffix; return }
        const dur = 1400
        let start = null
        const frame = (ts) => {
          if (start === null) start = ts
          const p = Math.min((ts - start) / dur, 1)
          const eased = 1 - Math.pow(1 - p, 3)
          const val = Math.round(target * eased)
          el.textContent = prefix + val.toLocaleString('es-CL') + suffix
          if (p < 1) requestAnimationFrame(frame)
        }
        requestAnimationFrame(frame)
      }
      if (!('IntersectionObserver' in window)) {
        countNodes.forEach(animate)
      } else {
        const io = new IntersectionObserver((entries) => {
          entries.forEach((e) => { if (e.isIntersecting) { animate(e.target); io.unobserve(e.target) } })
        }, { threshold: 0.25 })
        countNodes.forEach((n) => io.observe(n))
        cleanups.push(() => io.disconnect())
        // Failsafe: si el observer no dispara (algunos WebKit/PWA en iOS no
        // entregan el callback de inmediato), fija el valor final directo
        // —sin rAF, que puede estar pausado— para nunca dejar el contador en 0.
        const t = setTimeout(() => countNodes.forEach((el) => { if (!done.has(el)) setFinal(el) }), 2600)
        cleanups.push(() => clearTimeout(t))
      }
    }

    /* 4. Hero parallax */
    if (parallax && !reduce) {
      const fig = root.querySelector('[data-parallax]')
      if (fig) {
        let ticking = false
        const update = () => {
          const y = window.scrollY
          if (y < window.innerHeight * 1.2) fig.style.transform = `translateY(${y * 0.08}px)`
          ticking = false
        }
        const onScroll = () => { if (!ticking) { requestAnimationFrame(update); ticking = true } }
        window.addEventListener('scroll', onScroll, { passive: true })
        cleanups.push(() => window.removeEventListener('scroll', onScroll))
      }
    }

    /* 5. Tilt en retrato (desktop) */
    if (!reduce) {
      const fig = root.querySelector('[data-tilt]')
      if (fig && window.matchMedia('(pointer:fine)').matches) {
        const inner = fig.querySelector('img')
        const onMove = (e) => {
          const r = fig.getBoundingClientRect()
          const px = (e.clientX - r.left) / r.width - 0.5
          const py = (e.clientY - r.top) / r.height - 0.5
          fig.style.transform = `perspective(900px) rotateY(${px * 6}deg) rotateX(${-py * 6}deg)`
          if (inner) inner.style.transform = `scale(1.08) translate(${-px * 12}px,${-py * 12}px)`
        }
        const onLeave = () => { fig.style.transform = ''; if (inner) inner.style.transform = 'scale(1.04)' }
        fig.addEventListener('mousemove', onMove)
        fig.addEventListener('mouseleave', onLeave)
        cleanups.push(() => { fig.removeEventListener('mousemove', onMove); fig.removeEventListener('mouseleave', onLeave) })
      }
    }

    return () => cleanups.forEach((fn) => fn())
  }, [rootRef, parallax])
}

/* Scroll suave a una sección por id (sin scrollIntoView). */
export function scrollToId(id) {
  const el = document.getElementById(id)
  if (!el) return
  const top = el.getBoundingClientRect().top + window.scrollY - 80
  window.scrollTo({ top, behavior: 'smooth' })
}

export function BrunettiFooter({ rightSlot }) {
  return (
    <footer className="site-footer">
      <div className="container footer-wrap">
        <div className="footer-brand">
          <img src="/assets/brunetti-logo-icon.svg" alt="Brunetti" className="footer-logo" />
          <span>BRUNETTI</span>
        </div>
        <p>© 2026 Brunetti · Bruno Herrera. Todos los derechos reservados.</p>
        {rightSlot}
      </div>
    </footer>
  )
}
