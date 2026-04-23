"use client";

import { useEffect } from "react";
import { WebHaptics } from "web-haptics";

export function HapticsProvider() {
  useEffect(() => {
    const haptics = new WebHaptics();

    function handleClick(e: MouseEvent) {
      const target = (e.target as HTMLElement)?.closest(
        'button, [role="button"], a, input[type="submit"]',
      );
      if (target && !target.closest("[data-no-haptic]")) {
        haptics.trigger("nudge");
      }
    }

    document.addEventListener("click", handleClick, true);
    return () => {
      document.removeEventListener("click", handleClick, true);
      haptics.destroy();
    };
  }, []);

  return null;
}
