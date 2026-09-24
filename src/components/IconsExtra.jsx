import React from 'react'

/**
 * Set de íconos auto-contenido para los módulos nuevos.
 * No depende de ui.jsx, así que puedes copiar esta carpeta sin tocar otros módulos.
 * Si prefieres, puedes mapear estos nombres al <Icon> existente de tu ui.jsx.
 */
export const PATHS = {
  scissors: 'M6 6l12 12M6 18L18 6M8 6.5a2.5 2.5 0 1 1-5 0 2.5 2.5 0 0 1 5 0zM8 17.5a2.5 2.5 0 1 1-5 0 2.5 2.5 0 0 1 5 0z',
  calendar: 'M7 3v3M17 3v3M3.5 9h17M5 5h14a1.5 1.5 0 0 1 1.5 1.5V19A1.5 1.5 0 0 1 19 20.5H5A1.5 1.5 0 0 1 3.5 19V6.5A1.5 1.5 0 0 1 5 5z',
  clock: 'M12 7v5l3 2M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0z',
  user: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4.5 20a7.5 7.5 0 0 1 15 0',
  users: 'M16 14a4 4 0 1 0-4-4M2 20a6 6 0 0 1 12 0M22 20a5 5 0 0 0-7-4.6',
  phone: 'M5 4h3l1.5 5-2 1.5a11 11 0 0 0 5 5l1.5-2 5 1.5v3a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2z',
  chart: 'M4 20V4M4 20h16M8 16v-4M12 16V8M16 16v-6M20 16v-9',
  wallet: 'M4 7h14a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H4zM4 7V6a2 2 0 0 1 2-2h10M17 13h.5',
  star: 'M12 3l2.6 5.3 5.8.8-4.2 4.1 1 5.8L12 16.8 6.8 19l1-5.8L3.6 9.1l5.8-.8z',
  spark: 'M12 3v6M12 15v6M3 12h6M15 12h6',
  arrowRight: 'M5 12h14M13 6l6 6-6 6',
  arrowLeft: 'M19 12H5M11 6l-6 6 6 6',
  check: 'M5 12.5l4.5 4.5L19 7',
  trend: 'M3 17l6-6 4 4 8-8M21 7v5M21 7h-5',
  close: 'M6 6l12 12M18 6L6 18',
  x: 'M6 6l12 12M18 6L6 18',
  whatsapp: 'M12 3a9 9 0 0 0-7.7 13.6L3 21l4.5-1.2A9 9 0 1 0 12 3z',
  instagram: 'M7 2h10a5 5 0 0 1 5 5v10a5 5 0 0 1-5 5H7a5 5 0 0 1-5-5V7a5 5 0 0 1 5-5zM12 8.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7zM17.5 6.5h.01',
  reschedule: 'M21 12a9 9 0 1 1-3-6.7M21 3v5h-5',
  trash: 'M4 7h16M9 7V4h6v3M6 7l1 13a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-13M10 11v6M14 11v6',
  grid: 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z',
  list: 'M9 6h12M9 12h12M9 18h12M4 6h.01M4 12h.01M4 18h.01',
  pencil: 'M4 20h4l10.5-10.5a2 2 0 0 0 0-2.8l-1.2-1.2a2 2 0 0 0-2.8 0L4 16v4zM14 6l4 4',
}

export function Icon({ name, size = 18, stroke = 1.7, color = 'currentColor', style }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
      stroke={color} strokeWidth={stroke} strokeLinecap="round" strokeLinejoin="round" style={style}>
      <path d={PATHS[name] || PATHS.spark} />
    </svg>
  )
}
