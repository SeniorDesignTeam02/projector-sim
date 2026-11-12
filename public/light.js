import * as THREE from "three";
import { getContentQuad, getHomography } from "./keystone.js";
import { traceRay } from "./trace.js";

const cols = 160;
const rows = 90;
const rad = THREE.MathUtils.degToRad;

export const getQuaternion = (pose) =>
  new THREE.Quaternion().setFromEuler(
    new THREE.Euler(rad(pose.pitch), rad(pose.yaw), rad(pose.roll), "YXZ"),
  );

// Traces a grid of rays from the projector through the mirrors and returns the
// lit patches as triangle data per surface, the beam's corner rays, the
// keystone homography (picture uv to panel uv) and the brightness numbers.
export function castLight(scene) {
  const { projector, room } = scene;
  const tanW = 0.5 / projector.throwRatio;
  const tanH = tanW * (9 / 16);
  const shift = (projector.offset / 100) * tanH;
  const lens = new THREE.Vector3(projector.x, projector.y, projector.z);
  const aim = getQuaternion(projector);
  const wallZ = room.wallOn ? -room.counterD / 2 : null;
  const mirrors = Object.entries(scene.mirrors ?? {}).map(([id, m]) => {
    const quaternion = getQuaternion(m);
    return {
      id,
      position: new THREE.Vector3(m.x, m.y, m.z),
      quaternion,
      inverse: quaternion.clone().invert(),
      halfW: m.width / 2,
      halfH: m.height / 2,
      radius: m.type === "spherical" ? m.radius : 0,
      gain: m.reflectivity / 100,
    };
  });

  const quad = getContentQuad(projector, tanW, tanH, shift);
  const homography = getHomography(quad);
  const toPicture = homography.clone().invert();
  const used =
    Math.abs(
      quad.reduce((sum, [x, y], i) => {
        const [x2, y2] = quad[(i + 1) % 4];
        return sum + x * y2 - x2 * y;
      }, 0),
    ) / 2;

  const heading = new THREE.Vector3();
  const spot = new THREE.Vector3();
  const triangle = new THREE.Triangle();
  const light = {
    counter: { position: [], uv: [], color: [] },
    wall: { position: [], uv: [], color: [] },
  };
  let lit = 0;
  let delivered = 0;
  let absorbed = 0;
  let area = 0;
  let luxMin = Infinity;
  let luxMax = 0;

  const shoot = (u, v, trail) => {
    heading
      .set((2 * u - 1) * tanW, (2 * v - 1) * tanH + shift, -1)
      .applyQuaternion(aim)
      .normalize();
    return traceRay(lens.clone(), heading, mirrors, wallZ, trail);
  };

  const isInPicture = (u, v) => {
    spot.set(u, v, 1).applyMatrix3(toPicture);
    const s = spot.x / spot.z;
    const t = spot.y / spot.z;
    return s >= 0 && s <= 1 && t >= 0 && t <= 1;
  };

  // Corners run counter-clockwise from (u0, v0). A cell whose corners took
  // different routes straddles a mirror edge, so it is split and retried.
  const addCell = (u0, v0, u1, v1, a, b, c, d, depth) => {
    const isSplit = [b, c, d].some(
      (hit) => hit.surface !== a.surface || hit.path !== a.path,
    );
    if (isSplit) {
      if (depth === 0) return;
      const um = (u0 + u1) / 2;
      const vm = (v0 + v1) / 2;
      const s = shoot(um, v0);
      const e = shoot(u1, vm);
      const n = shoot(um, v1);
      const w = shoot(u0, vm);
      const mid = shoot(um, vm);
      addCell(u0, v0, um, vm, a, s, mid, w, depth - 1);
      addCell(um, v0, u1, vm, s, b, e, mid, depth - 1);
      addCell(um, vm, u1, v1, mid, e, c, n, depth - 1);
      addCell(u0, vm, um, v1, w, mid, n, d, depth - 1);
      return;
    }
    if (!a.surface) return;

    const p = [a.point, b.point, c.point, d.point];
    const cm2 =
      triangle.set(p[0], p[1], p[2]).getArea() +
      triangle.set(p[0], p[2], p[3]).getArea();
    if (cm2 < 1e-9) return;
    const flux = projector.lumens * (u1 - u0) * (v1 - v0);
    const lux = (flux * a.gain) / (cm2 / 1e4);

    const out = light[a.surface];
    const shade = lux / room.whiteLux;
    const uvs = [
      [u0, v0],
      [u1, v0],
      [u1, v1],
      [u0, v1],
    ];
    for (const i of [0, 1, 2, 0, 2, 3]) {
      out.position.push(p[i].x, p[i].y, p[i].z);
      out.uv.push(...uvs[i]);
      out.color.push(shade, shade, shade);
    }

    if (a.surface !== "counter") return;
    const x = (p[0].x + p[1].x + p[2].x + p[3].x) / 4;
    const z = (p[0].z + p[1].z + p[2].z + p[3].z) / 4;
    if (Math.abs(x) > room.counterW / 2 || Math.abs(z) > room.counterD / 2) {
      return;
    }
    if (!isInPicture((u0 + u1) / 2, (v0 + v1) / 2)) return;
    delivered += flux * a.gain;
    absorbed += flux * (1 - a.gain);
    area += cm2;
    luxMin = Math.min(luxMin, lux);
    luxMax = Math.max(luxMax, lux);
  };

  const hits = [];
  for (let j = 0; j <= rows; j++) {
    for (let i = 0; i <= cols; i++) hits.push(shoot(i / cols, j / rows));
  }
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const k = j * (cols + 1) + i;
      if (isInPicture((i + 0.5) / cols, (j + 0.5) / rows)) {
        lit += projector.lumens / (cols * rows);
      }
      addCell(
        i / cols,
        j / rows,
        (i + 1) / cols,
        (j + 1) / rows,
        hits[k],
        hits[k + 1],
        hits[k + cols + 2],
        hits[k + cols + 1],
        2,
      );
    }
  }

  const beam = [];
  for (const [u, v] of [
    [0, 0],
    [1, 0],
    [1, 1],
    [0, 1],
  ]) {
    const trail = [lens];
    shoot(u, v, trail);
    for (let i = 1; i < trail.length; i++) {
      beam.push(...trail[i - 1].toArray(), ...trail[i].toArray());
    }
  }

  const corners = quad.map(([u, v]) => shoot(u, v));
  const edges = corners.every((hit) => hit.surface === "counter")
    ? corners.map((hit, i) => hit.point.distanceTo(corners[(i + 1) % 4].point))
    : null;

  return {
    light,
    beam: { position: beam },
    homography,
    stats: {
      delivered,
      absorbed,
      keystoneLoss: projector.lumens - lit,
      missed: Math.max(0, lit - delivered - absorbed),
      luxMin,
      luxAvg: delivered / (area / 1e4),
      luxMax,
      area,
      edges,
      used,
    },
  };
}
