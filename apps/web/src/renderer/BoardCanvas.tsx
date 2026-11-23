// The board canvas as a React component: it owns the PixiJS scene's lifetime and redraws it when the seat view or the
// canvas size changes. PixiJS starts asynchronously, so a scene that finishes starting after the component has gone
// (React's StrictMode mounts twice in development) is destroyed at once rather than left as a second canvas.

import type { SeatView } from "@mtg/engine";
import { useEffect, useRef, useState } from "react";
import { type BoardSize, boardModel } from "../board-model/board-model.ts";
import { type BoardScene, createBoardScene } from "./board-scene.ts";

export function BoardCanvas({ shown, onError }: { shown: SeatView; onError: (message: string) => void }) {
  const host = useRef<HTMLDivElement>(null);
  const [scene, setScene] = useState<BoardScene | null>(null);
  const [size, setSize] = useState<BoardSize | null>(null);

  useEffect(() => {
    const element = host.current;
    if (element === null) return;
    let gone = false;
    let started: BoardScene | null = null;
    createBoardScene(element).then(
      (s) => {
        if (gone) s.destroy();
        else {
          started = s;
          setScene(s);
        }
      },
      (error) => onError(`the board couldn't start: ${error instanceof Error ? error.message : String(error)}`),
    );
    const observer = new ResizeObserver(([entry]) => {
      if (entry !== undefined) setSize({ width: entry.contentRect.width, height: entry.contentRect.height });
    });
    observer.observe(element);
    return () => {
      gone = true;
      observer.disconnect();
      started?.destroy();
      // A hot reload runs this cleanup and then the effects again: no drawing on the destroyed scene meanwhile.
      setScene(null);
    };
  }, [onError]);

  useEffect(() => {
    if (scene !== null && size !== null) scene.draw(boardModel(shown, size));
  }, [scene, size, shown]);

  return <div ref={host} className="board" role="img" aria-label="Board" />;
}
