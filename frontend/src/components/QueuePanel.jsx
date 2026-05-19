import { formatDuration } from '../api';

export default function QueuePanel({ isOpen, onClose, queue, currentIndex, onPlayIndex }) {
  if (!isOpen) return null;

  return (
    <div className={`queue-panel${isOpen ? ' open' : ''}`}>
      <div className="queue-header">
        <h3>Queue ({queue.length} songs)</h3>
        <button className="btn-icon" onClick={onClose}>
          <span className="material-symbols-rounded">close</span>
        </button>
      </div>
      <div className="queue-list">
        {queue.length === 0 ? (
          <div className="empty-state">
            <span className="material-symbols-rounded">queue_music</span>
            <p>Queue is empty</p>
          </div>
        ) : (
          queue.map((track, i) => (
            <div
              key={`${track.id}-${i}`}
              className={`queue-item${i === currentIndex ? ' active' : ''}`}
              onClick={() => onPlayIndex(i)}
            >
              <img className="queue-thumb" src={track.thumbnail} alt="" />
              <div className="queue-info">
                <div className="queue-title">{track.title}</div>
                <div className="queue-artist">{track.artist}</div>
              </div>
              <span className="result-duration">{formatDuration(track.duration)}</span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
