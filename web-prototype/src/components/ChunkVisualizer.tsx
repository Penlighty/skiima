import React from 'react';

interface ChunkVisualizerProps {
  progress: number;
  isTransferring: boolean;
}

export const ChunkVisualizer: React.FC<ChunkVisualizerProps> = ({ progress, isTransferring }) => {
  const totalBlocks = 100;
  const filledBlocks = Math.floor((progress / 100) * totalBlocks);
  const currentBlockIndex = isTransferring && progress < 100 ? filledBlocks : -1;

  return (
    <div style={{
      background: 'rgba(255, 255, 255, 0.01)',
      border: '1px solid var(--border-muted)',
      borderRadius: '16px',
      padding: '1.25rem',
      marginTop: '1.25rem',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      gap: '0.85rem'
    }}>
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        width: '100%',
        fontSize: '0.8rem',
        color: 'var(--text-secondary)',
        fontWeight: 500,
        textTransform: 'uppercase',
        letterSpacing: '0.05em'
      }}>
        <span>Live Stream Chunk Map</span>
        <span style={{ color: 'var(--accent-cyan)' }}>{Math.round(progress)}% compiled</span>
      </div>

      {/* 10x10 Glowing Block Grid */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(10, 1fr)',
        gap: '6px',
        width: '100%',
        maxWidth: '220px',
        margin: '0 auto',
        padding: '0.5rem',
        background: 'rgba(0, 0, 0, 0.2)',
        borderRadius: '12px',
        border: '1px solid rgba(255, 255, 255, 0.03)'
      }}>
        {Array.from({ length: totalBlocks }).map((_, idx) => {
          const isFilled = idx < filledBlocks;
          const isCurrent = idx === currentBlockIndex;

          let bg = 'rgba(255, 255, 255, 0.05)';
          let border = '1px solid rgba(255, 255, 255, 0.02)';
          let shadow = 'none';
          let scale = '1';

          if (isFilled) {
            bg = 'linear-gradient(135deg, var(--accent-cyan), var(--accent-purple))';
            border = 'none';
            shadow = '0 0 6px rgba(6, 182, 212, 0.6)';
          } else if (isCurrent) {
            bg = '#ffffff';
            border = 'none';
            shadow = '0 0 10px #ffffff, 0 0 20px var(--accent-cyan)';
            scale = '1.15';
          }

          return (
            <div
              key={idx}
              style={{
                aspectRatio: '1',
                borderRadius: '3px',
                background: bg,
                border: border,
                boxShadow: shadow,
                transform: `scale(${scale})`,
                transition: 'all 0.2s cubic-bezier(0.4, 0, 0.2, 1)',
                animation: isCurrent ? 'streamPulse 0.8s infinite alternate' : 'none'
              }}
            />
          );
        })}
      </div>

      <div style={{ display: 'flex', gap: '1rem', fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
          <div style={{ width: '8px', height: '8px', background: 'linear-gradient(135deg, var(--accent-cyan), var(--accent-purple))', borderRadius: '2px' }} />
          <span>Processed ({filledBlocks} chunks)</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
          <div style={{ width: '8px', height: '8px', background: 'rgba(255, 255, 255, 0.05)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '2px' }} />
          <span>Pending ({totalBlocks - filledBlocks} chunks)</span>
        </div>
      </div>

      <style>{`
        @keyframes streamPulse {
          0% {
            transform: scale(1);
            filter: brightness(1);
          }
          100% {
            transform: scale(1.2);
            filter: brightness(1.3);
            box-shadow: 0 0 14px #ffffff, 0 0 24px var(--accent-cyan);
          }
        }
      `}</style>
    </div>
  );
};
