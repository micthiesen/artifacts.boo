import * as THREE from "three";
import { Scene } from "@a/ui";

export default function Pair() {
  return (
    <Scene
      title="Two fittings 4 units apart"
      description="A filter head 12 units wide with two small fittings on top, 4 units apart, each with its own label."
      height={320}
      build={({ scene, solid, label, colors }: any) => {
        const head = solid(new THREE.CylinderGeometry(6, 6, 5, 32), colors.surface);
        head.position.set(0, 2.5, 0);
        scene.add(head);
        const left = solid(new THREE.CylinderGeometry(0.9, 0.9, 1.6, 16), colors.series[1]);
        left.position.set(-2, 5.8, 0);
        const right = solid(new THREE.CylinderGeometry(0.9, 0.9, 1.6, 16), colors.series[2]);
        right.position.set(2, 5.8, 0);
        scene.add(left, right);
        label("Inlet fitting", left);
        label("Outlet fitting", right);
      }}
    />
  );
}
