import * as THREE from "three";

const aspect = 9 / 16;
const rad = THREE.MathUtils.degToRad;

// Where digital keystone puts the picture inside the panel: the panel uv of the
// picture's bottom-left, bottom-right, top-right and top-left corners.
//
// The H/V angles describe a screen tilted relative to the lens axis, the way a
// projector's keystone setting does: V = +20 squares up the picture when the
// projector is pitched 20 degrees up from perpendicular to the surface, and
// H = +20 when it is yawed 20 degrees to the left. The picture is the largest
// 16:9 rectangle that fits inside the panel's footprint on that screen.
export function getContentQuad(projector, tanW, tanH, shift) {
  const tilt = new THREE.Quaternion().setFromEuler(
    new THREE.Euler(
      rad(-projector.keystoneV),
      rad(-projector.keystoneH),
      0,
      "XYZ",
    ),
  );
  const right = new THREE.Vector3(1, 0, 0).applyQuaternion(tilt);
  const up = new THREE.Vector3(0, 1, 0).applyQuaternion(tilt);
  const facing = new THREE.Vector3(0, 0, 1).applyQuaternion(tilt);
  const centre = new THREE.Vector3(0, 0, -1);

  const footprint = [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1],
  ].map(([x, y]) => {
    const ray = new THREE.Vector3(x * tanW, y * tanH + shift, -1);
    ray.multiplyScalar(centre.dot(facing) / ray.dot(facing)).sub(centre);
    return [ray.dot(right), ray.dot(up)];
  });

  // One row per footprint edge: a rectangle centred (cx, cy) with half width w
  // is inside that edge when row[0] * cx + row[1] * cy + row[2] * w >= row[3].
  const edges = footprint.map(([x, y], i) => {
    const [x2, y2] = footprint[(i + 1) % 4];
    const nx = y - y2;
    const ny = x2 - x;
    return [nx, ny, -(Math.abs(nx) + aspect * Math.abs(ny)), nx * x + ny * y];
  });

  // The largest rectangle touches three edges, so try each set of three.
  let best = new THREE.Vector3();
  for (const spare of edges) {
    const [a, b, c] = edges.filter((edge) => edge !== spare);
    const fit = new THREE.Vector3(a[3], b[3], c[3]).applyMatrix3(
      new THREE.Matrix3()
        .set(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2])
        .invert(),
    );
    const slack =
      spare[0] * fit.x + spare[1] * fit.y + spare[2] * fit.z - spare[3];
    if (fit.z > best.z && slack > -1e-9) best = fit;
  }

  const toPanel = (x, y) => {
    const spot = centre
      .clone()
      .addScaledVector(right, x)
      .addScaledVector(up, y);
    return [
      (-spot.x / spot.z / tanW + 1) / 2,
      ((-spot.y / spot.z - shift) / tanH + 1) / 2,
    ];
  };
  const halfW = projector.flipH ? -best.z : best.z;
  const halfH = (projector.flipV ? -best.z : best.z) * aspect;
  return [
    toPanel(best.x - halfW, best.y - halfH),
    toPanel(best.x + halfW, best.y - halfH),
    toPanel(best.x + halfW, best.y + halfH),
    toPanel(best.x - halfW, best.y + halfH),
  ];
}

// The homography taking the unit square onto `quad` (same corner order).
export function getHomography([[x0, y0], [x1, y1], [x2, y2], [x3, y3]]) {
  const dx1 = x1 - x2;
  const dx2 = x3 - x2;
  const dy1 = y1 - y2;
  const dy2 = y3 - y2;
  const sx = x0 - x1 + x2 - x3;
  const sy = y0 - y1 + y2 - y3;
  const den = dx1 * dy2 - dx2 * dy1;
  const g = (sx * dy2 - dx2 * sy) / den;
  const h = (dx1 * sy - sx * dy1) / den;
  return new THREE.Matrix3().set(
    x1 - x0 + g * x1,
    x3 - x0 + h * x3,
    x0,
    y1 - y0 + g * y1,
    y3 - y0 + h * y3,
    y0,
    g,
    h,
    1,
  );
}
