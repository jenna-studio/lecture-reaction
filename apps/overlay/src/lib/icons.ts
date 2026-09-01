/**
 * REACTION_META names Font Awesome free-solid icons as strings; the React
 * component needs the icon objects. One explicit table, so an unknown name is
 * a type error rather than a blank chip.
 */

import type { IconDefinition } from '@fortawesome/fontawesome-svg-core';
import {
  faBackward,
  faCheck,
  faForward,
  faLightbulb,
  faQuestion,
  faRotateLeft,
} from '@fortawesome/free-solid-svg-icons';
import { REACTION_META, type PaletteKey, type ReactionType } from '@lr/shared';

const BY_NAME: Record<string, IconDefinition> = {
  check: faCheck,
  question: faQuestion,
  forward: faForward,
  backward: faBackward,
  'rotate-left': faRotateLeft,
  lightbulb: faLightbulb,
};

export function reactionIcon(type: ReactionType): IconDefinition {
  return BY_NAME[REACTION_META[type].icon] ?? faQuestion;
}

export const ACCENT_VAR: Record<PaletteKey, string> = {
  sky: 'var(--lr-sky)',
  pink: 'var(--lr-pink)',
  lavender: 'var(--lr-lavender)',
  mint: 'var(--lr-mint)',
  yellow: 'var(--lr-yellow)',
};

export function reactionAccent(type: ReactionType): string {
  return ACCENT_VAR[REACTION_META[type].accent];
}
