/**
 * Le point d'entrée unique du système de composants.
 *
 * Les écrans importent `@/components/ui` et rien d'autre. C'est ce qui
 * rend une évolution du système possible : changer le rayon d'une carte
 * ou la couleur de l'inconnu, c'est un fichier, pas quarante.
 */
export {
  Card,
  Badge,
  StatusBadge,
  UnknownValue,
  ButtonLink,
  SubmitButton,
  Field,
  SelectField,
  EntityAvatar,
  Skeleton,
  TechnicalId,
  initialsOf,
  tintOf,
  type Tone,
  type ButtonVariant,
} from "./primitives";

export { PageHeader, SectionHeader, EmptyState, Panel, Tabs, Notice } from "./layout";
export { MetricCard, StatStrip, InfoCard, ActionCard } from "./cards";
export {
  DataTable,
  SearchBar,
  FilterBar,
  Pagination,
  ActivityTimeline,
  type Column,
} from "./data";
export { Modal, Drawer, ConfirmDialog } from "./overlays";
