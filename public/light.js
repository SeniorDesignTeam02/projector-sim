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
// keystone homography (picture uv to panel uv) and the brightness and blur
// numbers. Each lit vertex carries `blur`: the two panel uv axes of the
// ellipse of pixels whose light lands on that spot.
export function castLight(scene) {
  const { projector, room } = scene;
  const tanW = 0.5 / projector.throwRatio;
  const tanH = tanW * (9 / 16);
  const shift = (projector.offset / 100) * tanH;
  const lens = new THREE.Vector3(projector.x, projector.y, projector.z);
  const aim = getQuaternion(projector);
  const across = new THREE.Vector3(1, 0, 0).applyQuaternion(aim);
  const upward = new THREE.Vector3(0, 1, 0).applyQuaternion(aim);
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

  const start = new THREE.Vector3();
  const heading = new THREE.Vector3();
  const spot = new THREE.Vector3();
  const triangle = new THREE.Triangle();
  const light = {
    counter: { position: [], uv: [], color: [], blur: [] },
    wall: { position: [], uv: [], color: [], blur: [] },
  };
  const counted = [];
  let lit = 0;
  let delivered = 0;
  let absorbed = 0;
  let area = 0;
  let luxMin = Infinity;
  let luxMax = 0;
  let pull = 0;
  let weight = 0;

  const probe = (axis, step) =>
    traceRay(
      lens.clone().addScaledVector(axis, step),
      heading.copy(start),
      mirrors,
      wallZ,
    );

  // Besides the ray itself, traces it again from just beside the lens centre,
  // sideways and upwards. `shifts` is how far those land from the hit per cm
  // moved, which is where light from elsewhere on the lens opening goes.
  const shoot = (u, v, trail) => {
    start
      .set((2 * u - 1) * tanW, (2 * v - 1) * tanH + shift, -1)
      .applyQuaternion(aim)
      .normalize();
    const hit = traceRay(
      lens.clone(),
      heading.copy(start),
      mirrors,
      wallZ,
      trail,
    );
    if (!hit.surface) return hit;
    hit.shifts = [across, upward].map((axis) => {
      let step = 0.01;
      let moved = probe(axis, step);
      // that side fell off a mirror edge, so step the other way
      if (moved.surface !== hit.surface || moved.path !== hit.path) {
        step = -step;
        moved = probe(axis, step);
      }
      return moved.point.sub(hit.point).divideScalar(step);
    });
    return hit;
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
    const share = (u1 - u0) * (v1 - v0);
    const flux = projector.lumens * share;
    const lux = (flux * a.gain) / (cm2 / 1e4);

    // `du` and `dv` are the cm on the surface per unit of panel uv. Undoing
    // them turns each shift into the panel uv that light from 1 cm off the
    // lens centre is displaced by, before focus pulls it back.
    const du = p[1].clone().sub(p[0]).add(p[2]).sub(p[3]);
    const dv = p[3].clone().sub(p[0]).add(p[2]).sub(p[1]);
    du.divideScalar(2 * (u1 - u0));
    dv.divideScalar(2 * (v1 - v0));
    const gram = [du.dot(du), du.dot(dv), dv.dot(dv)];
    const det = gram[0] * gram[2] - gram[1] * gram[1];
    const spread = a.shifts.flatMap((s) => [
      (gram[2] * du.dot(s) - gram[1] * dv.dot(s)) / det,
      (gram[0] * dv.dot(s) - gram[1] * du.dot(s)) / det,
    ]);

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
      out.blur.push(...spread);
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
    counted.push({ at: out.blur.length - 4, gram, share });
    pull += share * (tanW * spread[0] + tanH * spread[3]);
    weight += share;
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

  // Focusing at distance D pulls every spot in by the same panel uv per cm of
  // lens opening, 1 / (2 D tan), so the D with the least mean square blur over
  // the counted picture is a plain average.
  const focus =
    projector.autoFocus && weight > 0
      ? 1 / Math.max(pull / weight, 0)
      : projector.focus;
  const radius = projector.aperture / 2;
  for (const { blur } of Object.values(light)) {
    for (let i = 0; i < blur.length; i += 4) {
      blur[i] = radius * (blur[i] - 0.5 / tanW / focus);
      blur[i + 1] *= radius;
      blur[i + 2] *= radius;
      blur[i + 3] = radius * (blur[i + 3] - 0.5 / tanH / focus);
    }
  }
  const blurPx = [];
  const blurMm = [];
  for (const { at, gram } of counted) {
    const axes = light.counter.blur.slice(at, at + 4);
    blurPx.push(getWidth(axes, 1280 * 1280, 0, 720 * 720));
    blurMm.push(10 * getWidth(axes, ...gram));
  }
  const getRange = (widths) => [
    widths.reduce((min, width) => Math.min(min, width), Infinity),
    widths.reduce((sum, width, i) => sum + width * counted[i].share, 0) /
      weight,
    widths.reduce((max, width) => Math.max(max, width), 0),
  ];

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
      focus,
      blurPx: getRange(blurPx),
      blurMm: getRange(blurMm),
    },
  };
}

// Longest width of the ellipse that the two axes (a, b) and (c, d) make of the
// unit disc, measured with the metric [[uu, uv], [uv, vv]].
function getWidth([a, b, c, d], uu, uv, vv) {
  const p = uu * a * a + 2 * uv * a * b + vv * b * b;
  const r = uu * c * c + 2 * uv * c * d + vv * d * d;
  const q = uu * a * c + uv * (a * d + b * c) + vv * b * d;
  return 2 * Math.sqrt((p + r) / 2 + Math.hypot((p - r) / 2, q));
}
