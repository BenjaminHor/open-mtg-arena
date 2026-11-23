// Whether the viewport is a phone in portrait now (`orientation.ts`), following turns of the phone and a resized
// window.

import { useEffect, useState } from "react";
import { isPortraitPhone } from "./orientation.ts";

export function usePortraitPhone(): boolean {
  const [portrait, setPortrait] = useState(() => isPortraitPhone(window.innerWidth, window.innerHeight));
  useEffect(() => {
    const update = () => setPortrait(isPortraitPhone(window.innerWidth, window.innerHeight));
    window.addEventListener("resize", update);
    window.addEventListener("orientationchange", update);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("orientationchange", update);
    };
  }, []);
  return portrait;
}
