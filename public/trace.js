import * as THREE from "three";

const origin = new THREE.Vector3();
const dir = new THREE.Vector3();
const normal = new THREE.Vector3();
const hitNormal = new THREE.Vector3();

// Follows one ray until it lands on the counter plane (y = 0) or the back wall
// plane (z = wallZ). Both planes are unbounded here; callers clip to the real
// extents. `point` and `heading` are mutated, and `point` ends where the ray
// stopped.
export function traceRay(point, heading, mirrors, wallZ, trail) {
  let gain = 1;
  let path = "";
  for (let bounce = 0; bounce < 16; bounce++) {
    let nearest = Infinity;
    let surface = null;
    let mirror = null;
    if (heading.y < 0 && point.y > 0) {
      nearest = -point.y / heading.y;
      surface = "counter";
    }
    if (wallZ !== null && heading.z < 0 && point.z > wallZ) {
      const t = (wallZ - point.z) / heading.z;
      if (t < nearest) {
        nearest = t;
        surface = "wall";
      }
    }
    for (const m of mirrors) {
      const t = hitMirror(m, point, heading);
      if (t < nearest) {
        nearest = t;
        mirror = m;
        hitNormal.copy(normal);
      }
    }
    if (nearest === Infinity) {
      trail?.push(point.clone().addScaledVector(heading, 300));
      break;
    }

    point.addScaledVector(heading, nearest);
    trail?.push(point.clone());
    if (!mirror) return { surface, point, gain, path };
    // the back of a mirror absorbs
    if (heading.dot(hitNormal) >= 0) break;
    heading.reflect(hitNormal);
    gain *= mirror.gain;
    path += `${mirror.id} `;
  }
  return { surface: null, point, gain: 0, path: "" };
}

// Distance along the ray to the mirror, or Infinity. Leaves the world-space
// surface normal (pointing out of the reflective side) in `normal`.
function hitMirror(m, point, heading) {
  origin.copy(point).sub(m.position).applyQuaternion(m.inverse);
  dir.copy(heading).applyQuaternion(m.inverse);

  if (m.radius === 0) {
    const t = -origin.z / dir.z;
    if (!(t > 1e-6)) return Infinity;
    if (Math.abs(origin.x + t * dir.x) > m.halfW) return Infinity;
    if (Math.abs(origin.y + t * dir.y) > m.halfH) return Infinity;
    normal.set(0, 0, 1).applyQuaternion(m.quaternion);
    return t;
  }

  // sphere centred at local (0, 0, -radius), so its apex sits on the mirror's
  // position; `origin` becomes relative to that centre
  origin.z += m.radius;
  const b = origin.dot(dir);
  const disc = b * b - origin.dot(origin) + m.radius * m.radius;
  if (disc < 0) return Infinity;
  const root = Math.sqrt(disc);
  for (let sign = -1; sign <= 1; sign += 2) {
    const t = -b + sign * root;
    if (t <= 1e-6) continue;
    normal.copy(origin).addScaledVector(dir, t);
    // only the half of the sphere that holds the apex is mirror
    if (normal.z * m.radius <= 0) continue;
    if (Math.abs(normal.x) > m.halfW || Math.abs(normal.y) > m.halfH) continue;
    normal.divideScalar(m.radius).applyQuaternion(m.quaternion);
    return t;
  }
  return Infinity;
}
