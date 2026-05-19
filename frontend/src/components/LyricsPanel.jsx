import { useEffect, useRef } from 'react';

export default function LyricsPanel({ isOpen, onClose, lyricsData, currentTime, onSeek }) {
  const containerRef = useRef(null);
  const activeRef = useRef(null);

  useEffect(() => {
    if (activeRef.current && containerRef.current) {
      activeRef.current.scrollIntoView({
        behavior: 'smooth',
        block: 'center',
      });
    }
  }, [currentTime, lyricsData?.currentIndex]);

  if (!isOpen) return null;

  const { synced, lines, plainLyrics, loading, error, found } = lyricsData || {};

  let currentIndex = -1;
  if (synced && lines?.length) {
    for (let i = lines.length - 1; i >= 0; i--) {
      if (currentTime >= lines[i].time) {
        currentIndex = i;
        break;
      }
    }
  }

  return (
    <aside className={`lyrics-panel${isOpen ? ' open' : ''}`}>
      <div className="lyrics-header">
        <h3>
          <span className="material-symbols-rounded">lyrics</span> Lyrics
        </h3>
        <button className="btn-icon" onClick={onClose}>
          <span className="material-symbols-rounded">close</span>
        </button>
      </div>
      <div className="lyrics-content" ref={containerRef}>
        {loading ? (
          <div className="lyrics-placeholder">
            <div className="spinner"></div>
            <p>Finding lyrics...</p>
          </div>
        ) : error || !found ? (
          <div className="lyrics-placeholder">
            <span className="material-symbols-rounded" style={{ fontSize: 48, opacity: 0.3 }}>
              lyrics
            </span>
            <p>Lyrics not available for this song</p>
          </div>
        ) : synced && lines?.length ? (
          <div className="lyrics-synced">
            {lines.map((line, i) => (
              <div
                key={i}
                ref={i === currentIndex ? activeRef : null}
                className={`lyrics-line${i === currentIndex ? ' active' : ''}${i < currentIndex ? ' past' : ''}`}
                onClick={() => onSeek && onSeek(line.time)}
              >
                {line.text}
              </div>
            ))}
          </div>
        ) : plainLyrics ? (
          <div className="lyrics-plain">{plainLyrics}</div>
        ) : (
          <div className="lyrics-placeholder">
            <span className="material-symbols-rounded" style={{ fontSize: 48, opacity: 0.3 }}>
              lyrics
            </span>
            <p>No lyrics found</p>
          </div>
        )}
      </div>
    </aside>
  );
}
