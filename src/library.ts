import { parseSong } from './parser';
import type { Song } from './types';

const modules = import.meta.glob('/songs/*.txt', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

/** All songs from the songs/ directory, sorted by title. */
export function loadSongs(): Song[] {
  const songs: Song[] = [];
  for (const [path, raw] of Object.entries(modules)) {
    const title = path
      .split('/')
      .pop()!
      .replace(/\.txt$/, '')
      .replace(/[-_]+/g, ' ');
    songs.push(parseSong(raw, title.charAt(0).toUpperCase() + title.slice(1)));
  }
  songs.sort((a, b) => a.title.localeCompare(b.title));
  return songs;
}
