import { useNavigate } from 'react-router-dom';
import type { Song } from '../types';

interface Props {
  songs: Song[];
}

export function SongList({ songs }: Props) {
  const navigate = useNavigate();
  return (
    <div className="song-list">
      <header className="app-header">
        <h1>Auto Piano</h1>
        <div className="song-actions">
          <button onClick={() => navigate('/free-play')}>Free play</button>
          <button className="secondary" onClick={() => navigate('/calibrate')}>
            Calibrate device
          </button>
        </div>
      </header>
      <p className="hero-hint">
        Play your real piano — the app listens and follows along. Free play uses
        the computer keyboard instead. Calibrate teaches the app how your piano
        actually sounds.
      </p>
      {songs.length === 0 && (
        <p className="empty-hint">No songs found. Drop a .txt file into the songs/ directory.</p>
      )}
      <ul>
        {songs.map((song) => (
          <li key={song.id} className="song-row">
            <div className="song-info">
              <strong>{song.title}</strong>
              <span className="song-meta">
                {song.key} · {song.beatsPerMeasure}/{song.beatUnit} · {song.tempo} BPM
              </span>
            </div>
            <div className="song-actions">
              <button onClick={() => navigate(`/listen/${song.id}`)}>Listen</button>
              <button onClick={() => navigate(`/practice/${song.id}`)}>Practice</button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
