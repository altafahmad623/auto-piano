/**
 * Device profiles: the user plays keys one by one in order, we record what the
 * detector hears for each expected key. Stored in localStorage per named device.
 * `offsets[expectedMidi] = detectedMidi` — used by the matcher to accept a
 * note when the user's piano reads consistently as a different pitch.
 */
export interface DeviceProfile {
  name: string;
  createdAt: number;
  /** expected MIDI → detected MIDI for calibrated keys. */
  offsets: Record<number, number>;
}

const STORAGE_KEY = 'auto-piano-device-profiles';

export function listProfiles(): DeviceProfile[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as DeviceProfile[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveProfile(profile: DeviceProfile): void {
  const profiles = listProfiles().filter((p) => p.name !== profile.name);
  profiles.push(profile);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(profiles));
}

export function deleteProfile(name: string): void {
  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify(listProfiles().filter((p) => p.name !== name)),
  );
}

/** MIDI for a note name like "C4" — used for calibration key guides. */
export function nameToMidi(name: string): number {
  const m = /^([A-G])([#b]?)(\d)$/.exec(name);
  if (!m) throw new Error(`Bad key name: ${name}`);
  const pc: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
  const acc = m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0;
  return 12 * (parseInt(m[3], 10) + 1) + pc[m[1]] + acc;
}

/** Range of white+black key MIDI numbers for `octaves` starting at C<startOctave>. */
export function calibrationRange(startOctave: number, octaves: number): number[] {
  const keys: number[] = [];
  for (let oct = startOctave; oct < startOctave + octaves; oct++) {
    for (let semi = 0; semi < 12; semi++) keys.push(12 * (oct + 1) + semi);
  }
  return keys;
}
