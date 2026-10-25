import { afterEach, describe, expect, it, vi } from 'vitest'
import type { DeviceProfile } from './calibration'
import {
  httpProfileStore,
  localProfileStore,
  migrateLocalProfiles,
  parseStoredEntry,
  PROFILE_VERSION,
  profileFileStem,
  type ProfileStore,
} from './profileStore'

const profile = (name: string): DeviceProfile => ({
  name,
  createdAt: 1700000000000,
  offsets: { 60: 60, 61: 62 },
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('profileFileStem', () => {
  it('lowercases and collapses disallowed characters', () => {
    expect(profileFileStem('My Piano 2!')).toBe('my-piano-2')
    expect(profileFileStem('a  b')).toBe('a-b')
  })

  it('keeps [a-z0-9-_] as-is', () => {
    expect(profileFileStem('a-b_c9')).toBe('a-b_c9')
  })

  it('trims leading and trailing hyphens', () => {
    expect(profileFileStem('--x--')).toBe('x')
  })

  it('falls back to "unnamed" for empty or all-disallowed names', () => {
    expect(profileFileStem('')).toBe('unnamed')
    expect(profileFileStem('***')).toBe('unnamed')
  })

  it('collides deliberately for names differing only in case/spacing', () => {
    expect(profileFileStem('My Piano')).toBe(profileFileStem('my  piano'))
  })
})

describe('parseStoredEntry', () => {
  it('accepts a version-1 entry', () => {
    const text = JSON.stringify({ version: 1, profile: profile('a') })
    expect(parseStoredEntry('a.json', text).profile).toEqual(profile('a'))
  })

  it('skips entries with an unknown version', () => {
    const text = JSON.stringify({ version: 2, profile: profile('a') })
    const parsed = parseStoredEntry('a.json', text)
    expect(parsed.profile).toBeUndefined()
    expect(parsed.error).toContain('a.json')
    expect(parsed.error).toContain('unknown version')
  })

  it('skips corrupt JSON', () => {
    const parsed = parseStoredEntry('a.json', '{not json')
    expect(parsed.profile).toBeUndefined()
    expect(parsed.error).toContain('a.json')
  })

  it('skips entries with a missing or invalid profile shape', () => {
    for (const entry of [
      null,
      42,
      'text',
      { version: 1 },
      { version: 1, profile: { name: 'a' } },
      { version: 1, profile: { name: 'a', createdAt: 'not a number', offsets: {} } },
      { version: 1, profile: { name: 'a', createdAt: 1, offsets: [60] } },
      { version: 1, profile: { name: 'a', createdAt: 1, offsets: { 60: 'sharp' } } },
    ]) {
      const parsed = parseStoredEntry('a.json', JSON.stringify(entry))
      expect(parsed.profile).toBeUndefined()
      expect(parsed.error).toBeDefined()
    }
  })

  it('skips version given as a string', () => {
    const parsed = parseStoredEntry('a.json', JSON.stringify({ version: '1', profile: profile('a') }))
    expect(parsed.profile).toBeUndefined()
  })
})

const jsonResponse = (status: number, body: unknown): Response =>
  ({ ok: status >= 200 && status < 300, status, json: async () => body }) as unknown as Response

describe('httpProfileStore', () => {
  it('lists profiles and reports corrupt files as errors', async () => {
    const fetchMock = vi.fn(async (_input: string) =>
      jsonResponse(200, {
        files: [
          { name: 'a.json', text: JSON.stringify({ version: 1, profile: profile('a') }) },
          { name: 'b.json', text: '{corrupt' },
          { name: 'c.json', text: JSON.stringify({ version: 9, profile: profile('c') }) },
        ],
      }),
    )
    vi.stubGlobal('fetch', fetchMock)

    const { profiles, errors } = await httpProfileStore().list()
    expect(profiles).toEqual([profile('a')])
    expect(errors).toHaveLength(2)
    expect(errors[0]).toContain('b.json')
    expect(errors[1]).toContain('c.json')
    expect(fetchMock).toHaveBeenCalledWith('/api/profiles')
  })

  it('throws when listing fails', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(500, { error: 'boom' })))
    await expect(httpProfileStore().list()).rejects.toThrow('HTTP 500')
  })

  it('saves a versioned envelope under the sanitized filename', async () => {
    const fetchMock = vi.fn(async (_input: string, _init?: RequestInit) =>
      jsonResponse(204, undefined),
    )
    vi.stubGlobal('fetch', fetchMock)

    await httpProfileStore().save(profile('My Piano'))

    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/profiles')
    expect(init!.method).toBe('POST')
    const body = JSON.parse(init!.body as string) as { file: string; text: string }
    expect(body.file).toBe('my-piano.json')
    expect(JSON.parse(body.text)).toEqual({
      version: PROFILE_VERSION,
      profile: profile('My Piano'),
    })
  })

  it('throws when saving fails', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(500, { error: 'boom' })))
    await expect(httpProfileStore().save(profile('a'))).rejects.toThrow('HTTP 500')
  })

  it('deletes by sanitized stem and throws on server errors', async () => {
    const fetchMock = vi.fn(async (_input: string, _init?: RequestInit) =>
      jsonResponse(204, undefined),
    )
    vi.stubGlobal('fetch', fetchMock)

    await httpProfileStore().delete('My Piano')
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/profiles/my-piano')
    expect(init!.method).toBe('DELETE')

    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(500, { error: 'boom' })))
    await expect(httpProfileStore().delete('a')).rejects.toThrow('HTTP 500')
  })
})

class MemoryStorage implements Storage {
  private readonly map = new Map<string, string>()
  get length(): number {
    return this.map.size
  }
  key(index: number): string | null {
    return [...this.map.keys()][index] ?? null
  }
  getItem(key: string): string | null {
    return this.map.get(key) ?? null
  }
  setItem(key: string, value: string): void {
    this.map.set(key, String(value))
  }
  removeItem(key: string): void {
    this.map.delete(key)
  }
  clear(): void {
    this.map.clear()
  }
}

describe('localProfileStore', () => {
  it('round-trips save/list, overwrites same name, deletes', async () => {
    const storage = new MemoryStorage()
    const store = localProfileStore(storage)

    await store.save(profile('a'))
    await store.save(profile('b'))
    await store.save({ ...profile('a'), createdAt: 2 })
    await store.delete('b')

    const { profiles, errors } = await store.list()
    expect(errors).toEqual([])
    expect(profiles).toEqual([{ ...profile('a'), createdAt: 2 }])
  })

  it('stores the versioned envelope format', async () => {
    const storage = new MemoryStorage()
    await localProfileStore(storage).save(profile('a'))
    const raw = JSON.parse(storage.getItem(storage.key(0)!) as string)
    expect(raw).toEqual([{ version: PROFILE_VERSION, profile: profile('a') }])
  })

  it('reports corrupt stored data as errors, never crashes', async () => {
    const storage = new MemoryStorage()
    const store = localProfileStore(storage)

    await store.save(profile('a')) // creates the store's localStorage key
    const key = storage.key(0)!

    storage.setItem(key, '{corrupt')
    const corrupt = await store.list()
    expect(corrupt.profiles).toEqual([])
    expect(corrupt.errors).toHaveLength(1)

    storage.setItem(key, JSON.stringify([{ version: 2, profile: profile('z') }]))
    const unknownVersion = await store.list()
    expect(unknownVersion.profiles).toEqual([])
    expect(unknownVersion.errors).toHaveLength(1)
  })
})

describe('migrateLocalProfiles', () => {
  const fakeStore = (failOn?: string): ProfileStore & { saved: DeviceProfile[] } => {
    const saved: DeviceProfile[] = []
    return {
      saved,
      async list() {
        return { profiles: [...saved], errors: [] }
      },
      async save(p: DeviceProfile) {
        if (p.name === failOn) throw new Error('boom')
        saved.push(p)
      },
      async delete() {},
    }
  }

  it('pushes each legacy profile into the store and reports counts', async () => {
    const store = fakeStore()
    const legacy = [profile('a'), profile('b')]

    const result = await migrateLocalProfiles(store, () => legacy)

    expect(result).toEqual({ migrated: 2, errors: [] })
    expect(store.saved).toEqual(legacy)
  })

  it('collects per-profile errors and continues when a save fails', async () => {
    const store = fakeStore('b')
    const legacy = [profile('a'), profile('b'), profile('c')]

    const result = await migrateLocalProfiles(store, () => legacy)

    expect(result.migrated).toBe(2)
    expect(result.errors).toEqual(['Migrating profile "b" failed: boom'])
    expect(store.saved.map((p) => p.name)).toEqual(['a', 'c'])
  })
})
