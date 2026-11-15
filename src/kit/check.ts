// The render check publishes its result a moment after the first render (runtime.tsx). A component that only
// knows later whether it drew (a <Scene> waits for three.js and its first frame) holds the result until it has
// said so, or the check would pass a page whose scene then turns out blank.
let holds = 0;

/** Keeps the render check's result back; call the returned function once this component has reported. */
export function holdCheck(): () => void {
  holds++;
  let held = true;
  return () => {
    if (!held) return;
    held = false;
    holds--;
  };
}

export const checkHeld = () => holds > 0;
