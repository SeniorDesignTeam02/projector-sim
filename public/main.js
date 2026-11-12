import { initializeApp } from "firebase/app";
import {
  getDatabase,
  onValue,
  push,
  ref,
  remove,
  set,
  update,
} from "firebase/database";
import { databaseUrl } from "./config.js";
import { setCamera, setGizmoMode, showScene, startView } from "./view.js";

const $ = (id) => document.getElementById(id);
const showError = (message) => {
  $("error").textContent = message;
};
window.addEventListener("error", (event) => showError(event.message));
window.addEventListener("unhandledrejection", (event) =>
  showError(event.reason.message),
);

if (!databaseUrl) {
  throw new Error(
    "No database yet: put your Firebase Realtime Database URL in public/config.js (steps are in AGENTS.md).",
  );
}
const db = getDatabase(initializeApp({ databaseURL: databaseUrl }));

const poseFields = [
  ["x", "X, + right (cm)"],
  ["y", "Y, + up from counter (cm)"],
  ["z", "Z, + toward the front (cm)"],
  ["yaw", "Yaw (°)"],
  ["pitch", "Pitch (°)"],
  ["roll", "Roll (°)"],
];
const mirrorFields = [
  ...poseFields,
  ["width", "Width (cm)", { min: 0.1 }],
  ["height", "Height (cm)", { min: 0.1 }],
  ["reflectivity", "Reflectivity (%)", { min: 0, max: 100 }],
];
const fields = {
  projector: [
    ...poseFields,
    ["throwRatio", "Throw ratio (distance ÷ picture width)", { min: 0.05 }],
    [
      "offset",
      "Lens offset (%), NOT MEASURED YET: 0 = picture centred on the lens, 100 = bottom edge on the lens axis",
    ],
    ["lumens", "Brightness (ANSI lumens)", { min: 0 }],
    [
      "keystoneV",
      "Digital keystone V (°)",
      { min: -45, max: 45, slider: true },
    ],
    [
      "keystoneH",
      "Digital keystone H (°)",
      { min: -45, max: 45, slider: true },
    ],
    ["flipH", "Flip horizontal"],
    ["flipV", "Flip vertical"],
    ["bodyW", "Body width (cm)", { min: 0.1 }],
    ["bodyH", "Body height (cm)", { min: 0.1 }],
    ["bodyD", "Body depth (cm)", { min: 0.1 }],
  ],
  room: [
    ["counterW", "Counter width (cm)", { min: 1 }],
    ["counterD", "Counter depth (cm)", { min: 1 }],
    ["wallOn", "Back wall"],
    ["wallH", "Back wall height (cm)", { min: 1 }],
    ["whiteLux", "Lux drawn as full white", { min: 1 }],
  ],
  flat: mirrorFields,
  spherical: [
    ...mirrorFields,
    ["radius", "Radius of curvature (cm): + convex, − concave"],
  ],
};

let scenes = {};
let selected = "projector";

const sceneRef = (path) => ref(db, `scenes/${location.hash.slice(1)}/${path}`);
const selectedPath = () =>
  selected === "projector" || selected === "room"
    ? selected
    : `mirrors/${selected}`;

function onScenes(snapshot) {
  scenes = snapshot.val() ?? {};
  if (Object.keys(scenes).length === 0) {
    addScene({
      name: "New scene",
      projector: {
        x: 0,
        y: 80,
        z: 0,
        yaw: 0,
        pitch: -90,
        roll: 0,
        throwRatio: 1.36,
        offset: 0,
        lumens: 130,
        keystoneV: 0,
        keystoneH: 0,
        flipH: false,
        flipV: false,
        bodyW: 22.5,
        bodyH: 10.9,
        bodyD: 18.6,
      },
      room: {
        counterW: 150,
        counterD: 63.5,
        wallOn: true,
        wallH: 45,
        whiteLux: 700,
      },
    });
    return;
  }
  window.onhashchange = render;
  render();
}

function onField(key, input, { min = -Infinity, max = Infinity }) {
  const value = input.type === "checkbox" ? input.checked : input.valueAsNumber;
  if (Number.isNaN(value) || value < min || value > max) return;
  set(sceneRef(`${selectedPath()}/${key}`), value);
}

function onAddMirror(shape) {
  selected = push(sceneRef("mirrors")).key;
  set(sceneRef(selectedPath()), {
    x: 0,
    y: 30,
    z: 0,
    yaw: 0,
    pitch: 0,
    roll: 0,
    width: 20,
    height: 15,
    reflectivity: 90,
    ...shape,
  });
}

function onSelect(id) {
  selected = id;
  render();
}

function addScene(scene) {
  const id = push(ref(db, "scenes")).key;
  set(ref(db, `scenes/${id}`), scene);
  location.hash = id;
}

function render() {
  const id = location.hash.slice(1);
  const ids = Object.keys(scenes);
  if (!scenes[id]) {
    location.hash = ids[0];
    return;
  }
  const scene = scenes[id];
  const mirrors = Object.entries(scene.mirrors ?? {});
  if (selected !== "room" && !scene.mirrors?.[selected]) selected = "projector";
  const object = scene[selected] ?? scene.mirrors[selected];

  fill(
    $("scenes"),
    JSON.stringify([id, ids.map((key) => scenes[key].name)]),
    () =>
      ids.map((key) => new Option(scenes[key].name, key, false, key === id)),
  );

  const objects = [
    ["projector", "Projector"],
    ["room", "Counter & wall"],
    ...mirrors.map(([key, m], i) => [key, `Mirror ${i + 1} (${m.type})`]),
  ];
  fill($("objects"), JSON.stringify([selected, objects]), () =>
    objects.map(([key, text]) => {
      const button = document.createElement("button");
      button.textContent = text;
      button.className = key === selected ? "on" : "";
      button.onclick = () => onSelect(key);
      return button;
    }),
  );
  $("deleteMirror").disabled = selected === "projector" || selected === "room";

  const kind = object.type ?? selected;
  fill($("fields"), `${selected} ${kind}`, () =>
    fields[kind].map(([key, text, limits = {}]) => {
      const label = document.createElement("label");
      const types =
        typeof object[key] === "boolean"
          ? ["checkbox"]
          : limits.slider
            ? ["range", "number"]
            : ["number"];
      label.append(
        text,
        ...types.map((type) => {
          const input = document.createElement("input");
          input.type = type;
          input.step = type === "range" ? 0.5 : "any";
          input.min = limits.min ?? "";
          input.max = limits.max ?? "";
          input.dataset.key = key;
          input.oninput = () => onField(key, input, limits);
          return input;
        }),
      );
      return label;
    }),
  );
  for (const input of $("fields").querySelectorAll("input")) {
    if (input === document.activeElement) continue;
    if (input.type === "checkbox") input.checked = object[input.dataset.key];
    else input.value = object[input.dataset.key];
  }

  const stats = showScene(scene, selected);
  const { lumens } = scene.projector;
  const n = (value) => (Number.isFinite(value) ? value.toFixed(1) : "–");
  const scale = Math.sqrt(stats.used);
  $("stats").textContent = [
    `Picture on counter: ${n(stats.delivered)} lm`,
    `  of ${n(lumens)} lm (${n((stats.delivered / lumens) * 100)}%), lost to:`,
    `  keystone black pixels  ${n(stats.keystoneLoss)} lm`,
    `  mirror absorption      ${n(stats.absorbed)} lm`,
    `  missing the counter    ${n(stats.missed)} lm`,
    `Lux min ${n(stats.luxMin)}  avg ${n(stats.luxAvg)}  max ${n(stats.luxMax)}`,
    `Picture area ${n(stats.area)} cm²`,
    ...(stats.edges
      ? [
          `Edges (cm) top ${n(stats.edges[2])}  bottom ${n(stats.edges[0])}`,
          `           left ${n(stats.edges[3])}  right ${n(stats.edges[1])}`,
        ]
      : ["Edges: a corner is off the counter"]),
    `Panel pixels used ${n(stats.used * 100)}%`,
    `  ≈ ${Math.round(1280 * scale)} × ${Math.round(720 * scale)} of 1280 × 720`,
  ].join("\n");
}

// Rebuilds an element's children only when `key` changes, so live updates
// from other people don't swallow clicks or close an open dropdown.
function fill(element, key, build) {
  if (element.dataset.key === key) return;
  element.dataset.key = key;
  element.replaceChildren(...build());
}

$("scenes").onchange = (event) => {
  location.hash = event.target.value;
};
$("newScene").onclick = () => {
  const { projector, room } = scenes[location.hash.slice(1)];
  addScene({ name: "New scene", projector, room });
};
$("copyScene").onclick = () => {
  const scene = scenes[location.hash.slice(1)];
  addScene({ ...scene, name: `${scene.name} copy` });
};
$("renameScene").onclick = () => {
  const name = prompt("Scene name", scenes[location.hash.slice(1)].name);
  if (name) set(sceneRef("name"), name);
};
$("deleteScene").onclick = () => {
  if (confirm("Delete this scene for everyone?")) remove(sceneRef(""));
};
$("addFlat").onclick = () => onAddMirror({ type: "flat" });
$("addSpherical").onclick = () =>
  onAddMirror({ type: "spherical", radius: 50 });
$("deleteMirror").onclick = () => remove(sceneRef(selectedPath()));
$("move").onclick = () => setGizmoMode("translate");
$("rotate").onclick = () => setGizmoMode("rotate");
$("view3d").onclick = () => setCamera(false);
$("viewTop").onclick = () => setCamera(true);

startView((pose) => update(sceneRef(selectedPath()), pose), onSelect);
onValue(ref(db, "scenes"), onScenes, (error) => showError(error.message));
