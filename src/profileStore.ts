/**
 * Async device-profile storage (plan 004 §2, option B). Two interchangeable
 * backends:
 *
 * - `httpProfileStore` — the /api/profiles middleware in vite.config.ts, which
 *   writes one JSON file per profile into a repo-local `profiles/` dir.
 * - `localProfileStore` — localStorage, same stored format.
 *
 * Every stored entry is wrapped as `{ version: 1, profile }`. Entries that are
 * corrupt or of an unknown version are skipped and reported through `list()`'s
 * `errors` (to be surfaced via ErrorBanner) — they never throw or crash.
 */
import { listProfiles, type DeviceProfile } from './calibration'

export const PROFILE_VERSION = 1

/** Profiles plus human-readable notes about stored entries we had to skip. */
export interface ProfileListResult {
  profiles: DeviceProfile[]
  errors: string[]
}

export interface ProfileStore {
  list(): Promise<ProfileListResult>
  save(profile: DeviceProfile): Promise<void>
  delete(name: string): Promise<void>
}

interface StoredEntry {
  version: number
  profile: DeviceProfile
}

function toStoredEntry(profile: DeviceProfile): StoredEntry {
  return { version: PROFILE_VERSION, profile }
}

function skipMessage(location: string): string {
  return `${location}: skipped (corrupt or unknown version)`
}

/**
 * Filename stem for a profile: lowercase, `[a-z0-9-_]` only. Names that differ
 * only in case/spacing collide on purpose — saving overwrites, matching the
 * old saveProfile behavior for the same name.
 */
export function profileFileStem(name: string): string {
  const stem = name
    .toLowerCase()
    .replace(/[^a-z0-9-_]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return stem || 'unnamed'
}

/** Parse and validate one stored entry. Never throws; bad input → `error`. */
export function parseStoredEntry(file: string, text: string): { profile?: DeviceProfile; error?: string } {
  let entry: unknown
  try {
    entry = JSON.parse(text)
  } catch {
    return { error: skipMessage(file) }
  }
  const profile = validateStoredEntry(entry)
  return profile ? { profile } : { error: skipMessage(file) }
}

function validateStoredEntry(entry: unknown): DeviceProfile | null {
  if (typeof entry !== 'object' || entry === null) return null
  const { version, profile } = entry as { version?: unknown; profile?: unknown }
  if (version !== PROFILE_VERSION) return null
  if (typeof profile !== 'object' || profile === null) return null
  const { name, createdAt, offsets } = profile as {
    name?: unknown
    createdAt?: unknown
    offsets?: unknown
  }
  if (typeof name !== 'string' || typeof createdAt !== 'number') return null
  if (typeof offsets !== 'object' || offsets === null || Array.isArray(offsets)) return null
  for (const value of Object.values(offsets)) {
    if (typeof value !== 'number') return null
  }
  return { name, createdAt, offsets: offsets as Record<number, number> }
}

/** Store backed by the /api/profiles middleware in vite.config.ts. */
export function httpProfileStore(baseUrl = ''): ProfileStore {
  return {
    async list() {
      const res = await fetch(`${baseUrl}/api/profiles`)
      if (!res.ok) throw new Error(`Listing profiles failed (HTTP ${res.status})`)
      const data = (await res.json()) as { files?: { name?: unknown; text?: unknown }[] }
      const profiles: DeviceProfile[] = []
      const errors: string[] = []
      for (const file of Array.isArray(data.files) ? data.files : []) {
        if (typeof file?.name !== 'string' || typeof file?.text !== 'string') {
          errors.push('Unexpected entry in /api/profiles response')
          continue
        }
        const parsed = parseStoredEntry(file.name, file.text)
        if (parsed.error) errors.push(parsed.error)
        else profiles.push(parsed.profile!)
      }
      return { profiles, errors }
    },

    async save(profile: DeviceProfile) {
      const res = await fetch(`${baseUrl}/api/profiles`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          file: `${profileFileStem(profile.name)}.json`,
          text: JSON.stringify(toStoredEntry(profile)),
        }),
      })
      if (!res.ok) throw new Error(`Saving profile "${profile.name}" failed (HTTP ${res.status})`)
    },

    async delete(name: string) {
      const res = await fetch(`${baseUrl}/api/profiles/${profileFileStem(name)}`, {
        method: 'DELETE',
      })
      // The middleware deletes idempotently (no error for unknown names),
      // matching the old localStorage deleteProfile behavior.
      if (!res.ok) throw new Error(`Deleting profile "${name}" failed (HTTP ${res.status})`)
    },
  }
}

const LOCAL_STORAGE_KEY = 'auto-piano-device-profiles-v1'

/**
 * localStorage-backed store using the same `{ version, profile }` entry format.
 * Uses its own key so the legacy `auto-piano-device-profiles` array (still read
 * by the sync functions in calibration.ts) is left untouched; run
 * `migrateLocalProfiles` to copy those over.
 */
export function localProfileStore(storage: Storage = localStorage): ProfileStore {
  const read = (): ProfileListResult => {
    const raw = storage.getItem(LOCAL_STORAGE_KEY)
    if (!raw) return { profiles: [], errors: [] }
    let entries: unknown
    try {
      entries = JSON.parse(raw)
    } catch {
      return { profiles: [], errors: [skipMessage(LOCAL_STORAGE_KEY)] }
    }
    if (!Array.isArray(entries)) return { profiles: [], errors: [skipMessage(LOCAL_STORAGE_KEY)] }
    const profiles: DeviceProfile[] = []
    const errors: string[] = []
    entries.forEach((entry, i) => {
      const profile = validateStoredEntry(entry)
      if (profile) profiles.push(profile)
      else errors.push(skipMessage(`${LOCAL_STORAGE_KEY} entry ${i}`))
    })
    return { profiles, errors }
  }

  const write = (profiles: DeviceProfile[]) => {
    storage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(profiles.map(toStoredEntry)))
  }

  return {
    async list() {
      return read()
    },
    async save(profile: DeviceProfile) {
      const { profiles } = read()
      write([...profiles.filter((p) => p.name !== profile.name), profile])
    },
    async delete(name: string) {
      const { profiles } = read()
      write(profiles.filter((p) => p.name !== name))
    },
  }
}

/**
 * One-time migration (plan 004 §2): copy profiles from the legacy
 * localStorage['auto-piano-device-profiles'] array into `store` via save().
 * The legacy key is left untouched. `listLegacy` is injectable for tests.
 */
export async function migrateLocalProfiles(
  store: ProfileStore,
  listLegacy: () => DeviceProfile[] = listProfiles,
): Promise<{ migrated: number; errors: string[] }> {
  const errors: string[] = []
  let migrated = 0
  for (const profile of listLegacy()) {
    try {
      await store.save(profile)
      migrated++
    } catch (err) {
      errors.push(
        `Migrating profile "${profile.name}" failed: ${err instanceof Error ? err.message : String(err)}`,
      )
    }
  }
  return { migrated, errors }
}
