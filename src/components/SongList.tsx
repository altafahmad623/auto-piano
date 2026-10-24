import type { Song } from '../types';

interface Props {
  songs: Song[];
  onListen: (song: Song) => void;
  onPractice: (song: Song) => void;
  onCalibrate: () => void;
  onFreePlay: () => void;
}

export function SongList({ songs, onListen, onPractice, onCalibrate, onFreePlay }: Props) {
  return (
    <div className="song-list">
      <header className="app-header">
        <h1>Auto Piano</h1>
        <div className="song-actions">
          <button onClick={onFreePlay}>Free play</button>
          <button className="secondary" onClick={onCalibrate}>
            Calibrate device
          </button>
        </div>
      </header>
      {songs.length === 0 && (
        <p className="empty-hint">No songs found. Drop a .txt file into the songs/ directory.</p>
      )}
      <ul>
        {songs.map((song) => (
          <li key={song.title} className="song-row">
            <div className="song-info">
              <strong>{song.title}</strong>
              <span className="song-meta">
                {song.key} · {song.beatsPerMeasure}/{song.beatUnit} · {song.tempo} BPM
              </span>
            </div>
            <div className="song-actions">
              <button onClick={() => onListen(song)}>Listen</button>
              <button onClick={() => onPractice(song)}>Practice</button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
