/**
 * Backward-compatible re-export.
 * All existing imports from '@/store/ui' continue to work.
 * New code should import from '@/store' for the canonical store names.
 */
export { useUIStore as useUI } from './uiStore';
export type { DateRange } from './uiStore';
