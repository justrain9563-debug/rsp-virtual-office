import { useEffect, useRef, useState } from 'react';
import Phaser from 'phaser';
import { OfficeScene } from '../game/OfficeScene';

export function GameView() {
  const ref = useRef<HTMLDivElement>(null);
  // bumping this rebuilds the game (used when the graphics setting changes)
  const [gen, setGen] = useState(0);
  useEffect(() => {
    const onGfx = () => setGen((g) => g + 1);
    window.addEventListener('rsp:gfx', onGfx);
    return () => window.removeEventListener('rsp:gfx', onGfx);
  }, []);
  useEffect(() => {
    let game: Phaser.Game | null = null;
    let cancelled = false;
    // wait (briefly) for the pixel font so in-game name tags use it
    const fonts = Promise.all([document.fonts.load('500 12px "Pixelify Sans"'), document.fonts.load('600 12px "Pixelify Sans"')]).catch(() => {});
    Promise.race([fonts, new Promise((r) => setTimeout(r, 1500))]).then(() => {
      if (cancelled) return;
      game = new Phaser.Game({
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
    });
    return () => { cancelled = true; game?.destroy(true); };
  }, [gen]);
  return <div ref={ref} className="absolute inset-0" data-testid="game" />;
}
