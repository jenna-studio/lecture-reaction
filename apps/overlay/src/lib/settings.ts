/** Overlay preferences. Tiny by design — this is not a settings screen. */

import type { ReactionZone } from '@lr/shared';
import { readJson, STORAGE_KEYS, writeJson } from './storage';

export interface OverlaySettings {
  zone: ReactionZone;
  quiet: boolean;
}

/**
 * Bumped when a default changes in a way that should reach existing installs.
 *
 * v2: the default spawn zone became `bottom`. Without this, anyone who had
 * already used the overlay kept the old `both` value that was persisted the
 * first time any setting was touched, and would never see the new default.
 */
const SETTINGS_VERSION = 2;

interface StoredSettings extends Partial<OverlaySettings> {
  v?: number;
}

/**
 * Bottom band by default: reactions rise from under the slide rather than
 * alongside it, which keeps them furthest from the content the class is
 * actually reading. Left / Both remain available in the overlay's settings.
 */
export const DEFAULT_SETTINGS: OverlaySettings = { zone: 'bottom', quiet: false };

export function loadSettings(): OverlaySettings {
  const saved = readJson<StoredSettings>(STORAGE_KEYS.settings, {});

  // Pre-v2 settings carry a spawn zone chosen under the old default, so the
  // zone is reset. Quiet Mode is an explicit per-lecture choice, so it stays.
  const stale = saved.v !== SETTINGS_VERSION;
  const zone = stale ? undefined : saved.zone;

  return {
    zone: zone === 'left' || zone === 'bottom' || zone === 'both' ? zone : DEFAULT_SETTINGS.zone,
    quiet: typeof saved.quiet === 'boolean' ? saved.quiet : DEFAULT_SETTINGS.quiet,
  };
}

export function saveSettings(settings: OverlaySettings): void {
  writeJson(STORAGE_KEYS.settings, { ...settings, v: SETTINGS_VERSION } satisfies StoredSettings);
}
