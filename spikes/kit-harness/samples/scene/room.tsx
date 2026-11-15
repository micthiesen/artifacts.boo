import { useState } from "react";
import * as THREE from "three";
import { Scene, Slider } from "@a/ui";

const ROOM = { width: 3.2, depth: 2.6, wall: 2.4 };

export default function Room() {
  const [desk, setDesk] = useState(1.6);
  const gap = ROOM.width - 0.9 - desk;
  return (
    <div>
      <Scene
        title="Does the desk fit beside the shelf?"
        description={`A 3.2 by 2.6 metre room from above the door. A 0.9 metre shelf stands against the back wall on the left; a ${desk.toFixed(1)} metre desk goes to its right and ${gap >= 0 ? `leaves ${gap.toFixed(2)} metres spare` : `is ${(-gap).toFixed(2)} metres too wide`}.`}
        view="top"
        deps={[desk]}
        build={({ scene, solid, label, colors }) => {
          const floor = solid(new THREE.BoxGeometry(ROOM.width, 0.02, ROOM.depth), colors.line);
          floor.position.y = -0.01;
          scene.add(floor);
          // The back wall as an outline, so it doesn't hide what stands against it.
          const wall = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(ROOM.width, ROOM.wall, 0.02)), new THREE.LineBasicMaterial({ color: colors.edge }));
          wall.position.set(0, ROOM.wall / 2, -ROOM.depth / 2);
          scene.add(wall);
          const shelf = solid(new THREE.BoxGeometry(0.9, 1.8, 0.35));
          shelf.position.set(-ROOM.width / 2 + 0.45, 0.9, -ROOM.depth / 2 + 0.2);
          scene.add(shelf);
          label("Shelf", shelf);
          const top = solid(new THREE.BoxGeometry(desk, 0.04, 0.7), gap >= 0.1 ? colors.positive : colors.negative);
          top.position.set(ROOM.width / 2 - desk / 2 - Math.max(gap, 0) / 2, 0.74, -ROOM.depth / 2 + 0.4);
          scene.add(top);
          label(gap >= 0 ? `Desk, ${gap.toFixed(2)} m spare` : `Desk, ${(-gap).toFixed(2)} m too wide`, top);
        }}
      />
      <div className="flex items-center gap-3">
        <span className="shrink-0 text-[13px] whitespace-nowrap text-muted-foreground tabular-nums">Desk {desk.toFixed(1)} m</span>
        <Slider aria-label="Desk width in metres" min={1} max={2.6} step={0.1} value={desk} onValueChange={(v) => setDesk(Number(v))} />
      </div>
    </div>
  );
}
