/* Primitivas del panel interno — importar SIEMPRE desde acá.
   Estilos: src/styles/panel.css (prefijo pn-). Guía de uso en cada archivo. */
export {
  Button, IconButton, Chip, StatusBadge, BOOKING_STATUS, Avatar, initialsOf, barberPhoto,
  Card, SectionLabel, List, ListRow, Time, Kpi, KpiGrid, Segmented, FilterChips, ChoiceGrid, PeriodNav,
  SearchField, Field, Switch, ToggleRow, Note, SaveBar, SavedTick, EmptyState, InlineAlert,
  Skeleton, SkeletonRows, ProgressBar, StackedBar,
} from './kit.jsx'
export { Sheet, ConfirmDialog } from './Sheet.jsx'
export { ActionMenu } from './ActionMenu.jsx'
export { ModuleHeader, Toolbar } from './ModuleHeader.jsx'
export { DataTable } from './DataTable.jsx'
export { CalendarSheet } from './CalendarSheet.jsx'
export { useIsPhone, useMediaQuery, useStoredFlag, PHONE_QUERY, DOCK_QUERY } from './hooks.js'
