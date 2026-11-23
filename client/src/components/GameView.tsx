import { useEffect, useRef } from 'react';
import Phaser from 'phaser';
import { OfficeScene } from '../game/OfficeScene';

export function GameView() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const game = new Phaser.Game({
      type: Phaser.AUTO,
      parent: ref.current!,
      backgroundColor: '#0b1220',
      pixelArt: true,
      roundPixels: true,
      scale: { mode: Phaser.Scale.RESIZE, width: '100%', height: '100%' },
      scene: [OfficeScene],
      disableContextMenu: true,
      fps: { target: 60 },
      banner: false,
    });
    return () => game.destroy(true);
  }, []);
  return <div ref={ref} className="absolute inset-0" data-testid="game" />;
}
