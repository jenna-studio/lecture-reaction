import type { IconDefinition } from '@fortawesome/fontawesome-svg-core';
import {
  faCheck,
  faEyeSlash,
  faVolumeXmark,
  faForward,
  faHeart,
  faLightbulb,
  faQuestion,
  faRotateLeft,
} from '@fortawesome/free-solid-svg-icons';
import { REACTION_META, type PaletteKey, type ReactionType } from '@lr/shared';

/** Keyed by the free-solid icon names the shared protocol already declares. */
const ICONS: Record<string, IconDefinition> = {
  check: faCheck,
  'eye-slash': faEyeSlash,
  'volume-xmark': faVolumeXmark,
  question: faQuestion,
  forward: faForward,
  heart: faHeart,
  'rotate-left': faRotateLeft,
  lightbulb: faLightbulb,
};

export function reactionIcon(type: ReactionType): IconDefinition {
  return ICONS[REACTION_META[type].icon] ?? faQuestion;
}

/** theme.css accent classes, listed literally so they survive any purge pass. */
const ACCENT_CLASS: Record<PaletteKey, string> = {
  sky: 'lr-a-sky',
  pink: 'lr-a-pink',
  lavender: 'lr-a-lavender',
  mint: 'lr-a-mint',
  yellow: 'lr-a-yellow',
  peach: 'lr-a-peach',
  sage: 'lr-a-sage',
  aqua: 'lr-a-aqua',
};

export function accentClass(accent: PaletteKey): string {
  return ACCENT_CLASS[accent];
}
