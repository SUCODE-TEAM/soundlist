import { formatDuration } from '../api';

export default function MusicCard({ track, onPlay, isPlaying }) {
  return (
    <div
      className={`music-card${isPlaying ? ' playing' : ''}`}
      onClick={() => onPlay(track)}
    >
      <div className="card-art-wrap">
        <img
          className="card-art"
          src={track.thumbnail}
          alt={track.title}
          loading="lazy"
          onError={(e) => { e.target.style.display = 'none'; }}
        />
        <div className="card-play-btn">
          <span className="material-symbols-rounded">
            {isPlaying ? 'pause' : 'play_arrow'}
          </span>
        </div>
      </div>
      <div className="card-title" title={track.title}>{track.title}</div>
      <div className="card-artist">{track.artist} • {formatDuration(track.duration)}</div>
    </div>
  );
}
