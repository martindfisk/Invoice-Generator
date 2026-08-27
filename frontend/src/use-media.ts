import { useEffect, useState } from "react";

export function useIsWide(query = "(min-width: 1280px)"): boolean {
  const [wide, setWide] = useState(() =>
    typeof window === "undefined" || typeof window.matchMedia !== "function"
      ? true
      : window.matchMedia(query).matches,
  );
  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const media = window.matchMedia(query);
    const listen = () => setWide(media.matches);
    listen();
    media.addEventListener("change", listen);
    return () => media.removeEventListener("change", listen);
  }, [query]);
  return wide;
}
