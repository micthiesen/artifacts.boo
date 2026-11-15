import * as THREE from "three";
import { Scene } from "@a/ui";

const U = 0.0445; // one rack unit, in metres
const WIDTH = 0.48;
const DEPTH = 0.6;

const UNITS: { name: string; at: number; size: number; series?: number }[] = [
  { name: "UPS", at: 0, size: 2, series: 2 },
  { name: "NAS", at: 2, size: 4, series: 0 },
  { name: "Server", at: 6, size: 1 },
  { name: "Switch", at: 10, size: 1, series: 1 },
  { name: "Patch panel", at: 11, size: 1 },
];

export default function Rack() {
  return (
    <Scene
      title="Home rack, 12U"
      description="A 12U rack seen from the front left. The UPS sits at the bottom with the NAS above it; the switch and patch panel are at the top, and units 8 to 10 are free."
      build={({ scene, solid, label, colors }) => {
        const height = 12 * U;
        for (const x of [-WIDTH / 2, WIDTH / 2]) {
          for (const z of [-DEPTH / 2, DEPTH / 2]) {
            const post = solid(new THREE.BoxGeometry(0.02, height, 0.02), colors.line);
            post.position.set(x, height / 2, z);
            scene.add(post);
          }
        }
        for (const unit of UNITS) {
          const box = solid(new THREE.BoxGeometry(WIDTH - 0.04, unit.size * U - 0.004, DEPTH - 0.08), unit.series === undefined ? undefined : colors.series[unit.series]);
          box.position.set(0, (unit.at + unit.size / 2) * U, 0);
          scene.add(box);
          label(unit.name, box);
        }
      }}
    />
  );
}
