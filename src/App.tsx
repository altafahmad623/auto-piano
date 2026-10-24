import { useMemo, useState } from 'react';
import { saveProfile, type DeviceProfile } from './calibration';
import { CalibrateView } from './components/CalibrateView';
import { FreePlayView } from './components/FreePlayView';
import { ListenView } from './components/ListenView';
import { PracticeView } from './components/PracticeView';
import { SongList } from './components/SongList';
import { loadSongs } from './library';
import type { Song } from './types';

type View =
  | { name: 'library' }
  | { name: 'listen'; song: Song }
  | { name: 'practice'; song: Song }
  | { name: 'freePlay' }
  | { name: 'calibrate'; from: 'library' | 'practice'; song?: Song };

export default function App() {
  const songs = useMemo(() => loadSongs(), []);
  const [view, setView] = useState<View>({ name: 'library' });

  const calibrateDone = (profile: DeviceProfile | null) => {
    if (profile) saveProfile(profile);
    if (view.name === 'calibrate') {
      if (view.from === 'practice' && view.song) {
        setView({ name: 'practice', song: view.song });
      } else {
        setView({ name: 'library' });
      }
    }
  };

  switch (view.name) {
    case 'library':
      return (
        <SongList
          songs={songs}
          onListen={(song) => setView({ name: 'listen', song })}
          onPractice={(song) => setView({ name: 'practice', song })}
          onFreePlay={() => setView({ name: 'freePlay' })}
          onCalibrate={() => setView({ name: 'calibrate', from: 'library' })}
        />
      );
    case 'listen':
      return <ListenView song={view.song} onBack={() => setView({ name: 'library' })} />;
    case 'practice':
      return (
        <PracticeView
          song={view.song}
          key={view.song.title}
          onBack={() => setView({ name: 'library' })}
          onCalibrate={() => setView({ name: 'calibrate', from: 'practice', song: view.song })}
        />
      );
    case 'calibrate':
      return <CalibrateView onDone={calibrateDone} />;
    case 'freePlay':
      return <FreePlayView onBack={() => setView({ name: 'library' })} />;
  }
}
