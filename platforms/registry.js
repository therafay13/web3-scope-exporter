import cantina from "./cantina.js";
import hackenproof from "./hackenproof.js";
import immunefi from "./immunefi.js";

const adapters = [cantina, hackenproof, immunefi];

export function getAdapter(url) {
  for (const adapter of adapters) {
    try {
      if (adapter.matches(url)) return adapter;
    } catch {
      // A hostile URL must never break adapter lookup.
    }
  }
  return null;
}

export default adapters;
