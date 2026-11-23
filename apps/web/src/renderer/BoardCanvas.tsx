// The board canvas as a React component: it owns the PixiJS scene's lifetime and draws each board model it's given.
// PixiJS starts asynchronously, so a scene that finishes starting after the component has gone (React's StrictMode
// mounts twice in development) is destroyed at once rather than left as a second canvas.

import { useEffect, useRef, useState } from "react";
import type { BoardModel } from "../board-model/board-model.ts";
import { type BoardScene, createBoardScene } from "./board-scene.ts";

export function BoardCanvas({ model, onError }: { model: BoardModel | null; onError: (message: string) => void }) {
  const host = useRef<HTMLDivElement>(null);
  const [scene, setScene] = useState<BoardScene | null>(null);

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
    return () => {
      gone = true;
      started?.destroy();
      // A hot reload runs this cleanup and then the effects again: no drawing on the destroyed scene meanwhile.
      setScene(null);
    };
  }, [onError]);

  useEffect(() => {
    if (scene !== null && model !== null) scene.draw(model);
  }, [scene, model]);

  return <div ref={host} className="board" role="img" aria-label="Board" />;
}
