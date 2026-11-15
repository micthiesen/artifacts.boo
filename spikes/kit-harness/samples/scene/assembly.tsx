import * as THREE from "three";
import { Scene } from "@a/ui";

export default function Assembly() {
  return (
    <Scene
      title="How the sensor goes together"
      description="Three parts stacked in order: a base with four standoffs, the circuit board that sits on them, and a lid that closes the top."
      steps={[
        { title: "Three parts", text: "The base, the board and the lid, apart." },
        { title: "Board in", text: "The board drops onto the four standoffs." },
        { title: "Lid on", text: "The lid closes the top, 12 millimetres above the board.", view: "front" },
      ]}
      build={({ scene, solid, label, colors, step }) => {
        const base = solid(new THREE.BoxGeometry(80, 4, 50));
        base.position.y = 2;
        scene.add(base);
        for (const x of [-26, 26]) {
          for (const z of [-14, 14]) {
            const standoff = solid(new THREE.CylinderGeometry(2, 2, 6, 16), colors.muted);
            standoff.position.set(x, 7, z);
            scene.add(standoff);
          }
        }
        // A part keeps its name from step to step, so it glides to where it now is.
        const board = solid(new THREE.BoxGeometry(60, 1.6, 36), colors.positive);
        board.name = "board";
        board.position.y = step >= 1 ? 10.8 : 38;
        scene.add(board);
        label("Board", board);
        const lid = solid(new THREE.BoxGeometry(80, 3, 50), colors.series[0]);
        lid.name = "lid";
        lid.position.y = step >= 2 ? 24 : 66;
        scene.add(lid);
        label("Lid", lid);
      }}
    />
  );
}
