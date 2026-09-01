/** Overlay preferences. Tiny by design — this is not a settings screen. */

import type { ReactionZone } from '@lr/shared';
import { readJson, STORAGE_KEYS, writeJson } from './storage';

export interface OverlaySettings {
  zone: ReactionZone;
  quiet: boolean;
}

export const DEFAULT_SETTINGS: OverlaySettings = { zone: 'both', quiet: false };

export function loadSettings(): OverlaySettings {
  const saved = readJson<Partial<OverlaySettings>>(STORAGE_KEYS.settings, {});
  const zone = saved.zone;
  return {
    zone: zone === 'left' || zone === 'bottom' || zone === 'both' ? zone : DEFAULT_SETTINGS.zone,
    quiet: typeof saved.quiet === 'boolean' ? saved.quiet : DEFAULT_SETTINGS.quiet,
  };
}

export function saveSettings(settings: OverlaySettings): void {
  writeJson(STORAGE_KEYS.settings, settings);
}
