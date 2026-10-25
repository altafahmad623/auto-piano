import { useNavigate } from 'react-router-dom';

/** Shown for unknown URLs and song ids that don't match a bundled song. */
export function NotFoundView() {
  const navigate = useNavigate();
  return (
    <div className="view">
      <header className="view-header">
        <h2>Not found</h2>
      </header>
      <p className="hint">
        That page doesn't exist — the song may have been removed or the link is
        out of date.
      </p>
      <div className="actions-row">
        <button onClick={() => navigate('/')}>← Library</button>
      </div>
    </div>
  );
}
