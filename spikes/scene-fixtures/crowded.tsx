import * as THREE from "three";
import { Scene } from "@a/ui";

const STEPS = [
  {
    title: "Mount the new head",
    text: "Screw the bracket to the cabinet wall with the two ports facing up. Find the IN and OUT marks: this picture puts IN on the left, yours may differ.",
  },
  {
    title: "Nipple into IN",
    text: "Wrap the 3/8 end of the stainless nipple with 4 to 5 turns of tape. Thread it into IN hand-tight, then 1 to 2 turns with a wrench.",
  },
  {
    title: "Old adapter into OUT",
    text: "Clean and re-tape the brass compression adapter you saved. Thread it into OUT hand-tight, then 1 to 2 turns.",
  },
  {
    title: "Supply hose onto the nipple",
    text: "Screw the braided hose's nut onto the top of the nipple. No tape: its rubber washer seals. Hand-tight, then a quarter turn.",
  },
  {
    title: "Add-a-tee onto the adapter",
    text: "Screw the tee's swivel nut onto the adapter. No tape. Point the small side outlet toward the copper line before the last quarter turn.",
  },
  {
    title: "Connect both lines",
    text: "White 3/8 faucet tube onto the tee's top outlet. 1/4 copper line onto the small side outlet. Use the nuts and sleeves already on the tubes.",
  },
  {
    title: "Cartridge in, then flush",
    text: "Push the 4FC up into the head and twist until it locks. Open the shut-off slowly, check every joint, then flush for five minutes.",
  },
];

export default function Assembly() {
  return (
    <Scene
      title="New filter plumbing, in order"
      description="A filter head with two ports on top. A stainless nipple goes into the inlet and the saved brass adapter into the outlet, both with tape. The braided supply hose screws onto the nipple. An add-a-tee screws onto the adapter and splits to the faucet's white tube on top and the instant-hot copper line on the side. The cartridge twists in from below last."
      height={420}
      steps={STEPS}
      build={({ scene, solid, label, colors, step }: any) => {
        const brass = colors.caution;
        const steel = colors.text;
        const tape = colors.series[2];

        const cyl = (r: number, h: number, color: any, seg = 24) =>
          solid(new THREE.CylinderGeometry(r, r, h, seg), color);
        const part = (name: string) => {
          const g = new THREE.Group();
          g.name = name;
          return g;
        };
        const put = (g: any, m: any, x: number, y: number, z: number) => {
          m.position.set(x, y, z);
          g.add(m);
          return m;
        };
        const tube = (pts: number[][], r: number, color: any) =>
          solid(
            new THREE.TubeGeometry(
              new THREE.CatmullRomCurve3(pts.map((p) => new THREE.Vector3(p[0], p[1], p[2]))),
              48,
              r,
              10,
              false,
            ),
            color,
          );

        // Head on its bracket: always there.
        const head = part("head");
        put(head, solid(new THREE.BoxGeometry(11, 8, 0.4), colors.line), 0, 3.5, -5.3);
        put(head, cyl(4.8, 5, colors.surface), 0, 2.5, 0);
        put(head, cyl(1.25, 1.2, colors.muted), -2, 5.6, 0);
        put(head, cyl(1.25, 1.2, colors.muted), 2, 5.6, 0);
        put(head, solid(new THREE.BoxGeometry(3.5, 1, 1.2), colors.muted), 0, 3.2, 5.3);
        scene.add(head);

        // Cartridge: waits below, twists in last.
        const cart = part("cartridge");
        put(cart, cyl(4.4, 1.6, colors.muted), 0, -0.8, 0);
        put(cart, cyl(4.1, 20, colors.surface), 0, -11.6, 0);
        cart.position.set(0, step >= 6 ? 0 : -9, 0);
        scene.add(cart);

        // Stainless reducing nipple: taped 3/8 end down.
        const nipple = part("nipple");
        put(nipple, cyl(0.85, 1.4, tape), 0, 0.5, 0);
        put(nipple, cyl(1.45, 1.0, steel, 6), 0, 1.7, 0);
        put(nipple, cyl(1.07, 1.8, steel), 0, 3.1, 0);
        if (step >= 1) nipple.position.set(-2, 6.2, 0);
        else nipple.position.set(-11, 11, 4);
        scene.add(nipple);

        // Saved brass compression adapter: taped pipe thread down.
        const adapter = part("adapter");
        put(adapter, cyl(0.85, 1.4, tape), 0, 0.5, 0);
        put(adapter, cyl(1.3, 0.9, brass, 6), 0, 1.65, 0);
        put(adapter, cyl(0.8, 1.3, brass), 0, 2.75, 0);
        if (step >= 2) adapter.position.set(2, 6.2, 0);
        else adapter.position.set(11, 11, 4);
        scene.add(adapter);

        // Braided supply hose with its swivel nut.
        const hose = part("hose");
        put(hose, cyl(1.6, 1.8, colors.muted, 6), 0, 0, 0);
        put(hose, cyl(1.0, 1.6, steel), 0, 1.7, 0);
        hose.add(
          tube(
            [
              [0, 2.4, 0],
              [0, 6, 0],
              [-3, 11, -1],
              [-9, 14, -2],
              [-14, 13, -3],
            ],
            0.75,
            colors.muted,
          ),
        );
        if (step >= 3) hose.position.set(-2, 9.3, 0);
        else hose.position.set(-7, 18, 0);
        scene.add(hose);

        // Add-a-tee: swivel nut below, 3/8 outlet on top, 1/4 outlet to the side.
        const tee = part("tee");
        put(tee, cyl(1.5, 1.6, brass, 6), 0, 0, 0);
        put(tee, cyl(0.95, 3.4, brass), 0, 2.5, 0);
        put(tee, cyl(0.8, 1.2, brass), 0, 4.8, 0);
        const branch = put(tee, cyl(0.6, 2.2, brass), 2.0, 2.8, 0);
        branch.rotation.z = Math.PI / 2;
        if (step >= 4) tee.position.set(2, 9.0, 0);
        else tee.position.set(12, 18, 4);
        scene.add(tee);

        // White 3/8 faucet tube onto the tee's top outlet.
        const faucet = part("faucet");
        put(faucet, cyl(1.2, 1.3, brass, 6), 0, 0, 0);
        faucet.add(
          tube(
            [
              [0, 0.6, 0],
              [0, 5, 0],
              [1, 10, -1],
              [1.5, 14, -2],
            ],
            0.48,
            colors.text,
          ),
        );
        if (step >= 5) faucet.position.set(2, 13.8, 0);
        else faucet.position.set(6, 22, 0);
        scene.add(faucet);

        // 1/4 copper line onto the tee's side outlet.
        const copper = part("copper");
        const cnut = put(copper, cyl(0.95, 1.1, brass, 6), 0, 0, 0);
        cnut.rotation.z = Math.PI / 2;
        copper.add(
          tube(
            [
              [0.5, 0, 0],
              [4, 0, 0],
              [8, -1.5, -1.5],
              [11, -5, -3],
              [12, -10, -4],
            ],
            0.32,
            colors.series[4],
          ),
        );
        if (step >= 5) copper.position.set(5.1, 11.8, 0);
        else copper.position.set(13, 14, 4);
        scene.add(copper);

        // Labels: only what this step is about.
        if (step <= 2) {
          label("IN", [-2, 6.4, 1.2]);
          label("OUT", [2, 6.4, 1.2]);
        }
        if (step === 0) label("New head", [0, 2.5, 4.8]);
        if (step === 1) {
          label("Stainless nipple", [-2, 10.2, 0]);
          label("Tape here", [-2.9, 6.9, 0]);
        }
        if (step === 2) {
          label("Saved adapter", [2, 9.6, 0]);
          label("Tape here", [2.9, 6.9, 0]);
        }
        if (step === 3) label("Supply hose", [-5, 20.3, -1]);
        if (step === 4) {
          label("Add-a-tee", [2, 14.4, 0]);
          label("1/4 outlet", [5.1, 11.8, 0]);
        }
        if (step === 5) {
          label("Faucet tube 3/8", [3.5, 27.8, -2]);
          label("Copper 1/4", [16.1, 6.8, -3]);
        }
        if (step === 6) label("4FC cartridge", [0, -12, 4.2]);
      }}
    />
  );
}
