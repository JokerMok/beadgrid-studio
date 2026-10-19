import { deserialize } from "./model";
import pattern from "./assets/raiden-demo.json";
import source from "./assets/raiden-shogun.png?inline";

// Stable palette codes and the embedded source keep the example fully editable.
// Draft restoration still takes precedence over this first-visit example.
export function makeDemo() {
  return deserialize({
    ...pattern,
    id: crypto.randomUUID(),
    updatedAt: Date.now(),
    source,
  });
}
