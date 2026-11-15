import * as THREE from "three";
import { Scene } from "@a/ui";

export default function Enclosure() {
  return (
    <Scene
      title="Sensor enclosure"
      description="An open-topped box 80 by 50 by 24 millimetres with a circuit board on four standoffs. The USB port faces the short side nearest the camera."
      height={280}
      build={({ scene, label, colors }) => {
        // Plain three.js, no solid(): its own materials and lines.
        const shell = new THREE.Mesh(new THREE.BoxGeometry(80, 24, 50), new THREE.MeshLambertMaterial({ color: colors.surface, transparent: true, opacity: 0.35 }));
        shell.position.y = 12;
        scene.add(shell);
        scene.add(new THREE.LineSegments(new THREE.EdgesGeometry(shell.geometry), new THREE.LineBasicMaterial({ color: colors.text })).translateY(12));
        const board = new THREE.Mesh(new THREE.BoxGeometry(60, 1.6, 36), new THREE.MeshLambertMaterial({ color: colors.positive }));
        board.position.y = 7;
        scene.add(board);
        label("Board", board);
        for (const x of [-26, 26]) {
          for (const z of [-14, 14]) {
            const standoff = new THREE.Mesh(new THREE.CylinderGeometry(2, 2, 6, 16), new THREE.MeshLambertMaterial({ color: colors.muted }));
            standoff.position.set(x, 3, z);
            scene.add(standoff);
          }
        }
        const usb = new THREE.Mesh(new THREE.BoxGeometry(9, 3.2, 7), new THREE.MeshLambertMaterial({ color: colors.text }));
        usb.position.set(0, 9.4, 21.5);
        scene.add(usb);
        label("USB-C", usb);
      }}
    />
  );
}
