import { useEffect, useRef } from "react";

function isMobileViewport(): boolean {
  return (
    window.matchMedia("(max-width: 768px)").matches ||
    document.documentElement.classList.contains("is-mobile-view")
  );
}

// On mobile, opening a test case (drawer/overlay) doesn't push a route —
// it's local component state. Without this, the phone's back button falls
// through to the browser's real history and navigates away from the page
// entirely instead of just closing the case. We push a throwaway history
// entry while the overlay is open and close it on `popstate`; if it's
// closed some other way (X button, Escape) we pop that entry ourselves so
// the back button still leaves the page on the next press instead of
// silently no-op'ing once.
export function useBackToClose(isOpen: boolean, onClose: () => void) {
  const closedByPopRef = useRef(false);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!isOpen || !isMobileViewport()) return;

    closedByPopRef.current = false;
    window.history.pushState({ tcOverlay: true }, "");

    const onPopState = () => {
      closedByPopRef.current = true;
      onCloseRef.current();
    };
    window.addEventListener("popstate", onPopState);

    return () => {
      window.removeEventListener("popstate", onPopState);
      if (!closedByPopRef.current) {
        window.history.back();
      }
    };
  }, [isOpen]);
}
