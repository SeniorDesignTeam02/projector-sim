import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { TransformControls } from "three/addons/controls/TransformControls.js";
import { castLight, getQuaternion } from "./light.js";
import { drawPattern } from "./pattern.js";

const canvas = document.getElementById("view");
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(devicePixelRatio);
renderer.localClippingEnabled = true;

const world = new THREE.Scene();
world.background = new THREE.Color(0x1c1c1c);
world.add(new THREE.HemisphereLight(0xffffff, 0x555555, 3));
const camera = new THREE.PerspectiveCamera(45, 1, 1, 5000);
const orbit = new OrbitControls(camera, canvas);
orbit.zoomToCursor = true;
const gizmo = new TransformControls(camera, canvas);
world.add(gizmo.getHelper());

// What the projector's 1280x720 panel shows: the chosen picture squeezed into
// the keystone quad, black elsewhere. Rendering it at panel resolution is what
// makes digital keystone cost real pixels.
const panel = new THREE.WebGLRenderTarget(1280, 720, {
  colorSpace: THREE.SRGBColorSpace,
  magFilter: THREE.NearestFilter,
  minFilter: THREE.LinearMipmapLinearFilter,
  generateMipmaps: true,
});
const panelScene = new THREE.Scene();
panelScene.background = new THREE.Color(0x000000);
const panelCamera = new THREE.OrthographicCamera(0, 1, 1, 0, -1, 1);
const pictures = {};
const picture = new THREE.Mesh(
  new THREE.PlaneGeometry(1, 1).translate(0.5, 0.5, 0),
  new THREE.MeshBasicMaterial({
    map: getPicture("pattern"),
    side: THREE.DoubleSide,
  }),
);
picture.matrixAutoUpdate = false;
picture.frustumCulled = false;
panelScene.add(picture);

const counter = new THREE.Mesh(
  new THREE.BoxGeometry(1, 1, 1),
  new THREE.MeshLambertMaterial({ color: 0x2c2c2c }),
);
const wall = new THREE.Mesh(
  new THREE.PlaneGeometry(1, 1),
  new THREE.MeshLambertMaterial({ color: 0x343434 }),
);
world.add(counter, wall);

// The tracer treats the counter and wall as unbounded planes; these planes
// cut the lit patches back to the real edges.
const sides = [
  new THREE.Plane(new THREE.Vector3(1, 0, 0)),
  new THREE.Plane(new THREE.Vector3(-1, 0, 0)),
];
const ends = [
  new THREE.Plane(new THREE.Vector3(0, 0, 1)),
  new THREE.Plane(new THREE.Vector3(0, 0, -1)),
];
const wallTop = new THREE.Plane(new THREE.Vector3(0, -1, 0));
const makeLight = (clippingPlanes) =>
  new THREE.Mesh(
    new THREE.BufferGeometry(),
    new THREE.MeshBasicMaterial({
      map: panel.texture,
      vertexColors: true,
      blending: THREE.AdditiveBlending,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      clippingPlanes,
      onBeforeCompile: blurPicture,
    }),
  );
const counterLight = makeLight([...sides, ...ends]);
const wallLight = makeLight([...sides, wallTop]);
// lifted off the surfaces so they don't z-fight
counterLight.position.y = 0.05;
wallLight.position.z = 0.05;
const beam = new THREE.LineSegments(
  new THREE.BufferGeometry(),
  new THREE.LineBasicMaterial({ color: 0xffcc00 }),
);
world.add(counterLight, wallLight, beam);

// the hardware is see-through so it never hides the picture on the counter
const seeThrough = { transparent: true, opacity: 0.4, depthWrite: false };
const groups = new Map();
const projectorGroup = addGroup("projector");
const body = new THREE.Mesh(
  new THREE.BoxGeometry(1, 1, 1),
  new THREE.MeshLambertMaterial({ color: 0x7f8fb0, ...seeThrough }),
);
const lens = new THREE.Mesh(
  new THREE.CylinderGeometry(2, 2, 2),
  new THREE.MeshLambertMaterial({ color: 0x111111 }),
);
lens.rotation.x = Math.PI / 2;
projectorGroup.add(body, lens);

const mirrorFront = new THREE.MeshBasicMaterial({
  color: 0x9fd0ff,
  ...seeThrough,
});
const mirrorBack = new THREE.MeshBasicMaterial({
  color: 0x777777,
  side: THREE.BackSide,
  ...seeThrough,
});

// `onPose` gets the new position and angles while an object is dragged;
// `onPick` gets the id of an object clicked in the 3D view.
export function startView(onPose, onPick) {
  const round = (value) => Math.round(value * 10) / 10;
  const deg = THREE.MathUtils.radToDeg;
  const raycaster = new THREE.Raycaster();
  let downX = 0;
  let downY = 0;

  gizmo.addEventListener("dragging-changed", (event) => {
    orbit.enabled = !event.value;
  });
  gizmo.addEventListener("objectChange", () => {
    const { position, rotation, userData } = gizmo.object;
    const last = [userData.pose.yaw, userData.pose.pitch, userData.pose.roll];
    const yaw = deg(rotation.y);
    const pitch = deg(rotation.x);
    const roll = deg(rotation.z);
    // Two sets of angles describe every orientation. Take the one nearest the
    // current values so the fields don't jump when pitch passes 90 degrees.
    const turns = [
      [yaw, pitch, roll],
      [yaw + 180, 180 - pitch, roll + 180],
    ].map((angles) =>
      angles.map(
        (angle, i) =>
          THREE.MathUtils.euclideanModulo(angle - last[i] + 180, 360) - 180,
      ),
    );
    const getSize = (turn) =>
      Math.abs(turn[0]) + Math.abs(turn[1]) + Math.abs(turn[2]);
    const turn = getSize(turns[0]) <= getSize(turns[1]) ? turns[0] : turns[1];
    onPose({
      x: round(position.x),
      y: round(position.y),
      z: round(position.z),
      yaw: round(last[0] + turn[0]),
      pitch: round(last[1] + turn[1]),
      roll: round(last[2] + turn[2]),
    });
  });

  canvas.addEventListener("pointerdown", (event) => {
    downX = event.clientX;
    downY = event.clientY;
  });
  canvas.addEventListener("pointerup", (event) => {
    const moved = Math.hypot(event.clientX - downX, event.clientY - downY);
    if (moved > 4 || gizmo.axis) return;
    const box = canvas.getBoundingClientRect();
    raycaster.setFromCamera(
      new THREE.Vector2(
        ((event.clientX - box.left) / box.width) * 2 - 1,
        1 - ((event.clientY - box.top) / box.height) * 2,
      ),
      camera,
    );
    const hit = raycaster.intersectObjects([...groups.values()])[0];
    if (hit) onPick(hit.object.parent.userData.id);
  });

  new ResizeObserver(() => {
    renderer.setSize(canvas.clientWidth, canvas.clientHeight, false);
    camera.aspect = canvas.clientWidth / canvas.clientHeight;
    camera.updateProjectionMatrix();
  }).observe(canvas);

  setCamera(false);
  renderer.setAnimationLoop(() => {
    renderer.setRenderTarget(panel);
    renderer.render(panelScene, panelCamera);
    renderer.setRenderTarget(null);
    renderer.render(world, camera);
  });
}

// Draws the scene with `selected` holding the drag handles, and returns the
// brightness numbers.
export function showScene(scene, selected) {
  const { projector, room } = scene;
  const mirrors = scene.mirrors ?? {};

  counter.scale.set(room.counterW, 4, room.counterD);
  counter.position.y = -2;
  wall.visible = room.wallOn;
  wall.scale.set(room.counterW, room.wallH, 1);
  wall.position.set(0, room.wallH / 2, -room.counterD / 2);
  sides[0].constant = sides[1].constant = room.counterW / 2;
  ends[0].constant = ends[1].constant = room.counterD / 2;
  wallTop.constant = room.wallH;

  body.scale.set(projector.bodyW, projector.bodyH, projector.bodyD);
  body.position.z = projector.bodyD / 2;
  placeGroup(projectorGroup, projector);

  for (const [id, mirror] of Object.entries(mirrors)) {
    const group = groups.get(id) ?? addMirror(id);
    group.children[0].geometry.dispose();
    group.children[0].geometry = group.children[1].geometry =
      shapeMirror(mirror);
    placeGroup(group, mirror);
  }
  for (const [id, group] of groups) {
    if (id === "projector" || mirrors[id]) continue;
    group.children[0].geometry.dispose();
    world.remove(group);
    groups.delete(id);
  }

  const target = groups.get(selected);
  if (target) gizmo.attach(target);
  else gizmo.detach();

  picture.material.map = getPicture(projector.picture);
  const cast = castLight(scene);
  setGeometry(counterLight, cast.light.counter);
  setGeometry(wallLight, cast.light.wall);
  setGeometry(beam, cast.beam);
  const h = cast.homography.elements;
  picture.matrix.set(
    ...[h[0], h[3], 0, h[6]],
    ...[h[1], h[4], 0, h[7]],
    ...[0, 0, 1, 0],
    ...[h[2], h[5], 0, h[8]],
  );
  picture.matrixWorldNeedsUpdate = true;
  return cast.stats;
}

export function setGizmoMode(mode) {
  gizmo.setMode(mode);
  gizmo.setSpace(mode === "rotate" ? "local" : "world");
}

export function setCamera(isTop) {
  camera.position.set(...(isTop ? [0, 260, 0.01] : [140, 130, 190]));
  orbit.target.set(0, isTop ? 0 : 20, 0);
  orbit.update();
}

// The picture called `name`: the drawn test pattern, or a surface screen from
// `screens/`, which is fetched the first time it is chosen.
function getPicture(name) {
  if (pictures[name]) return pictures[name];
  const texture =
    name === "pattern"
      ? new THREE.CanvasTexture(drawPattern())
      : new THREE.TextureLoader().load(`screens/${name}.png`);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = renderer.capabilities.getMaxAnisotropy();
  pictures[name] = texture;
  return texture;
}

function addGroup(id) {
  const group = new THREE.Group();
  group.rotation.order = "YXZ";
  group.userData.id = id;
  groups.set(id, group);
  world.add(group);
  return group;
}

function addMirror(id) {
  const group = addGroup(id);
  group.add(new THREE.Mesh(undefined, mirrorFront));
  group.add(new THREE.Mesh(undefined, mirrorBack));
  return group;
}

function placeGroup(group, pose) {
  group.userData.pose = pose;
  group.position.set(pose.x, pose.y, pose.z);
  group.quaternion.copy(getQuaternion(pose));
}

function shapeMirror(mirror) {
  const geometry = new THREE.PlaneGeometry(mirror.width, mirror.height, 24, 24);
  if (mirror.type !== "spherical") return geometry;
  const at = geometry.attributes.position;
  for (let i = 0; i < at.count; i++) {
    const rest = mirror.radius ** 2 - at.getX(i) ** 2 - at.getY(i) ** 2;
    at.setZ(
      i,
      Math.sign(mirror.radius) * Math.sqrt(Math.max(rest, 0)) - mirror.radius,
    );
  }
  return geometry;
}

function setGeometry(mesh, data) {
  mesh.geometry.dispose();
  mesh.geometry = new THREE.BufferGeometry();
  for (const [name, values] of Object.entries(data)) {
    mesh.geometry.setAttribute(
      name,
      new THREE.Float32BufferAttribute(values, { uv: 2, blur: 4 }[name] ?? 3),
    );
  }
}

// Makes a lit patch show the average of the panel over its blur spot instead
// of one point of it: 32 samples spread evenly over the ellipse whose two
// panel uv axes are in `blur`. Each sample reads a mip level as coarse as the
// gap between samples, so a wide spot smears rather than showing 32 copies.
function blurPicture(shader) {
  shader.vertexShader = shader.vertexShader.replace(
    "void main() {",
    `attribute vec4 blur;
    varying vec4 vBlur;
    void main() {
      vBlur = blur;`,
  );
  shader.fragmentShader = shader.fragmentShader
    .replace(
      "void main() {",
      `varying vec4 vBlur;
      void main() {`,
    )
    .replace(
      "#include <map_fragment>",
      `vec2 across = dFdx(vMapUv) * vec2(1280.0, 720.0);
      vec2 down = dFdy(vMapUv) * vec2(1280.0, 720.0);
      float gap =
        3.1416 * abs(vBlur.x * vBlur.w - vBlur.y * vBlur.z) * 1280.0 * 720.0 / 32.0;
      float level =
        0.5 * log2(max(max(dot(across, across), dot(down, down)), gap));
      vec4 seen = vec4(0.0);
      for (int i = 0; i < 32; i++) {
        float turn = float(i) * 2.39996;
        vec2 at = sqrt((float(i) + 0.5) / 32.0) * vec2(cos(turn), sin(turn));
        seen += textureLod(map, vMapUv + vBlur.xy * at.x + vBlur.zw * at.y, level);
      }
      diffuseColor *= seen / 32.0;`,
    );
}
