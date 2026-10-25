import { useMemo } from 'react';
import {
  Route,
  Routes,
  useNavigate,
  useParams,
  useSearchParams,
} from 'react-router-dom';
import { saveProfile, type DeviceProfile } from './calibration';
import { CalibrateView } from './components/CalibrateView';
import { FreePlayView } from './components/FreePlayView';
import { ListenView } from './components/ListenView';
import { NotFoundView } from './components/NotFoundView';
import { PracticeView } from './components/PracticeView';
import { SongList } from './components/SongList';
import { loadSongs } from './library';
import type { Song } from './types';

/** Looks up the song for the current route's :songId param. */
function useSong(songs: Song[]): Song | undefined {
  const { songId } = useParams();
  return songs.find((s) => s.id === songId);
}

function ListenRoute({ songs }: { songs: Song[] }) {
  const song = useSong(songs);
  if (!song) return <NotFoundView />;
  // key: stop the old song's playback when navigating song-to-song directly.
  return <ListenView key={song.id} song={song} />;
}

function PracticeRoute({ songs }: { songs: Song[] }) {
  const song = useSong(songs);
  if (!song) return <NotFoundView />;
  // key: a fresh practice session when the song (or URL) changes.
  return <PracticeView key={song.id} song={song} />;
}

/** Only same-app paths may be used as a post-calibration destination. */
function isInternalPath(path: string | null): path is string {
  return (
    path !== null &&
    path.startsWith('/') &&
    !path.startsWith('//') &&
    !path.startsWith('/\\')
  );
}

function CalibrateRoute() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const returnTo = params.get('returnTo');

  return (
    <CalibrateView
      onDone={(profile: DeviceProfile | null) => {
        if (profile) saveProfile(profile);
        navigate(isInternalPath(returnTo) ? returnTo : '/');
      }}
    />
  );
}

export default function App() {
  const songs = useMemo(() => loadSongs(), []);
  return (
    <Routes>
      <Route path="/" element={<SongList songs={songs} />} />
      <Route path="/listen/:songId" element={<ListenRoute songs={songs} />} />
      <Route path="/practice/:songId" element={<PracticeRoute songs={songs} />} />
      <Route path="/free-play" element={<FreePlayView />} />
      <Route path="/calibrate" element={<CalibrateRoute />} />
      <Route path="*" element={<NotFoundView />} />
    </Routes>
  );
}
