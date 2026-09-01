/**
 * §35 DESIGN SYSTEM — le point d'entrée unique.
 *
 * Les écrans importent `@/components/ui` et rien d'autre. C'est ce qui
 * rend une évolution du système possible : changer le rayon d'une
 * carte, c'est un fichier, pas quatre-vingt-treize.
 *
 * Ce fichier a remplacé l'ancien `components/ui.tsx`. Le chemin
 * d'import ne bouge pas — Next résout `@/components/ui` vers ce
 * dossier — donc aucun écran existant n'a eu à changer.
 */
export {
  Card, Badge, StatusBadge, ButtonLink, SubmitButton, Field, SelectField,
  CompanyAvatar, UserAvatar, Skeleton, initialsOf, tintOf,
  type Tone, type ButtonVariant,
} from "./primitives";

export { PageHeader, SectionHeader, EmptyState, Panel, Tabs } from "./layout";
export { MetricCard, InfoCard, ActionCard, PlanCard } from "./cards";
export { DataTable, SearchBar, FilterBar, ActivityTimeline, type Column } from "./data";
export { Modal, Drawer, ConfirmDialog } from "./overlays";
