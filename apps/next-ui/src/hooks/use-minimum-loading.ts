import { useState, useEffect, useRef } from "react";

export function useMinimumLoading(isLoading: boolean, minDuration = 2000) {
  const [showLoading, setShowLoading] = useState(isLoading);
  const startTime = useRef<number>(0);

  useEffect(() => {
    if (isLoading) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setShowLoading(true);
      startTime.current = Date.now();
    } else {
      const elapsed = Date.now() - startTime.current;
      if (elapsed < minDuration && startTime.current !== 0) {
        const timer = setTimeout(
          () => setShowLoading(false),
          minDuration - elapsed,
        );
        return () => clearTimeout(timer);
      } else {
        setShowLoading(false);
      }
    }
  }, [isLoading, minDuration]);

  return showLoading;
}
