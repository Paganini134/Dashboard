import * as THREE from "three";
import "./style.css";

type BlockId = 0 | 1 | 2 | 3 | 4 | 5 | 6;

type BlockInfo = {
  name: string;
  color: number;
  solid: boolean;
};

type Hit = {
  block: THREE.Vector3;
  place: THREE.Vector3;
};

const CHUNK_SIZE = 16;
const WORLD_HEIGHT = 56;
const LOAD_RADIUS = 3;
const PLAYER_HEIGHT = 1.8;
const EYE_HEIGHT = 1.62;
const PLAYER_RADIUS = 0.32;
const SAVE_KEY = "voxel-sandbox-edits-v1";
const PLAYER_KEY = "voxel-sandbox-player-v1";

const BLOCKS: Record<BlockId, BlockInfo> = {
  0: { name: "Air", color: 0xffffff, solid: false },
  1: { name: "Grass", color: 0x5aa13b, solid: true },
  2: { name: "Dirt", color: 0x8a5a35, solid: true },
  3: { name: "Stone", color: 0x777b7e, solid: true },
  4: { name: "Wood", color: 0x7a5034, solid: true },
  5: { name: "Leaves", color: 0x3f8f4b, solid: true },
  6: { name: "Sand", color: 0xd8c27a, solid: true }
};

const HOTBAR: BlockId[] = [1, 2, 3, 4, 5, 6];
const BLOCK_KEYS = Object.keys(BLOCKS).map(Number) as BlockId[];

const FACE_DEFS = [
  {
    normal: new THREE.Vector3(0, 1, 0),
    shade: 1.08,
    corners: [
      [0, 1, 1],
      [1, 1, 1],
      [1, 1, 0],
      [0, 1, 0]
    ]
  },
  {
    normal: new THREE.Vector3(0, -1, 0),
    shade: 0.55,
    corners: [
      [0, 0, 0],
      [1, 0, 0],
      [1, 0, 1],
      [0, 0, 1]
    ]
  },
  {
    normal: new THREE.Vector3(1, 0, 0),
    shade: 0.82,
    corners: [
      [1, 0, 1],
      [1, 0, 0],
      [1, 1, 0],
      [1, 1, 1]
    ]
  },
  {
    normal: new THREE.Vector3(-1, 0, 0),
    shade: 0.74,
    corners: [
      [0, 0, 0],
      [0, 0, 1],
      [0, 1, 1],
      [0, 1, 0]
    ]
  },
  {
    normal: new THREE.Vector3(0, 0, 1),
    shade: 0.9,
    corners: [
      [0, 0, 1],
      [1, 0, 1],
      [1, 1, 1],
      [0, 1, 1]
    ]
  },
  {
    normal: new THREE.Vector3(0, 0, -1),
    shade: 0.68,
    corners: [
      [1, 0, 0],
      [0, 0, 0],
      [0, 1, 0],
      [1, 1, 0]
    ]
  }
] as const;

const app = document.querySelector<HTMLDivElement>("#app");
if (!app) {
  throw new Error("Missing app root");
}

app.innerHTML = `
  <div class="hud">
    <div class="topbar">
      <div class="badge" id="status">Click to play</div>
    </div>
    <div class="crosshair"></div>
    <div class="block-name" id="block-name"></div>
    <div class="hotbar" id="hotbar"></div>
    <div class="start" id="start">
      <div class="start-panel">
        <h1>Voxel Sandbox</h1>
        <button id="start-button">Enter World</button>
      </div>
    </div>
  </div>
`;

const statusEl = document.querySelector<HTMLDivElement>("#status")!;
const startEl = document.querySelector<HTMLDivElement>("#start")!;
const startButton = document.querySelector<HTMLButtonElement>("#start-button")!;
const hotbarEl = document.querySelector<HTMLDivElement>("#hotbar")!;
const blockNameEl = document.querySelector<HTMLDivElement>("#block-name")!;

function chunkKey(cx: number, cz: number) {
  return `${cx},${cz}`;
}

function blockKey(x: number, y: number, z: number) {
  return `${x},${y},${z}`;
}

function floorDiv(value: number, size: number) {
  return Math.floor(value / size);
}

function localCoord(value: number, size: number) {
  return ((value % size) + size) % size;
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function fade(t: number) {
  return t * t * (3 - 2 * t);
}

function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t;
}

function hash2(x: number, z: number) {
  let n = x * 374761393 + z * 668265263;
  n = (n ^ (n >> 13)) * 1274126177;
  return ((n ^ (n >> 16)) >>> 0) / 4294967295;
}

function valueNoise(x: number, z: number, scale: number) {
  const sx = x / scale;
  const sz = z / scale;
  const x0 = Math.floor(sx);
  const z0 = Math.floor(sz);
  const tx = fade(sx - x0);
  const tz = fade(sz - z0);
  const a = hash2(x0, z0);
  const b = hash2(x0 + 1, z0);
  const c = hash2(x0, z0 + 1);
  const d = hash2(x0 + 1, z0 + 1);
  return lerp(lerp(a, b, tx), lerp(c, d, tx), tz);
}

function terrainHeight(x: number, z: number) {
  const rolling = valueNoise(x, z, 42) * 17;
  const detail = valueNoise(x + 140, z - 80, 13) * 5;
  const ridges = Math.abs(valueNoise(x - 44, z + 91, 28) - 0.5) * 8;
  return clamp(Math.floor(15 + rolling + detail + ridges), 8, WORLD_HEIGHT - 8);
}

function blockAtNatural(x: number, y: number, z: number): BlockId {
  const height = terrainHeight(x, z);
  if (y > height) return 0;
  if (y === height) return height < 17 ? 6 : 1;
  if (y > height - 4) return height < 17 ? 6 : 2;
  return 3;
}

class Chunk {
  readonly data = new Uint8Array(CHUNK_SIZE * WORLD_HEIGHT * CHUNK_SIZE);
  mesh: THREE.Mesh | null = null;

  constructor(
    readonly cx: number,
    readonly cz: number,
    private readonly world: World
  ) {
    this.generate();
  }

  private index(x: number, y: number, z: number) {
    return x + z * CHUNK_SIZE + y * CHUNK_SIZE * CHUNK_SIZE;
  }

  getLocal(x: number, y: number, z: number): BlockId {
    if (y < 0 || y >= WORLD_HEIGHT) return 0;
    return this.data[this.index(x, y, z)] as BlockId;
  }

  setLocal(x: number, y: number, z: number, id: BlockId) {
    if (y < 0 || y >= WORLD_HEIGHT) return;
    this.data[this.index(x, y, z)] = id;
  }

  private generate() {
    const startX = this.cx * CHUNK_SIZE;
    const startZ = this.cz * CHUNK_SIZE;

    for (let lx = 0; lx < CHUNK_SIZE; lx += 1) {
      for (let lz = 0; lz < CHUNK_SIZE; lz += 1) {
        const wx = startX + lx;
        const wz = startZ + lz;
        const height = terrainHeight(wx, wz);
        for (let y = 0; y < WORLD_HEIGHT; y += 1) {
          this.setLocal(lx, y, lz, blockAtNatural(wx, y, wz));
        }

        const treeRoll = hash2(wx * 9 + 23, wz * 9 - 17);
        if (height > 18 && treeRoll > 0.965) {
          this.placeTree(lx, height + 1, lz);
        }
      }
    }

    this.world.applySavedEdits(this);
  }

  private placeTree(x: number, y: number, z: number) {
    const height = 4 + Math.floor(hash2(this.cx + x, this.cz - z) * 3);
    for (let dy = 0; dy < height; dy += 1) {
      this.setLocal(x, y + dy, z, 4);
    }

    for (let dx = -2; dx <= 2; dx += 1) {
      for (let dz = -2; dz <= 2; dz += 1) {
        for (let dy = height - 2; dy <= height + 1; dy += 1) {
          if (Math.abs(dx) + Math.abs(dz) + Math.max(0, dy - height) > 4) continue;
          const lx = x + dx;
          const lz = z + dz;
          if (lx < 0 || lx >= CHUNK_SIZE || lz < 0 || lz >= CHUNK_SIZE) continue;
          if (this.getLocal(lx, y + dy, lz) === 0) {
            this.setLocal(lx, y + dy, lz, 5);
          }
        }
      }
    }
  }

  rebuild(scene: THREE.Scene) {
    if (this.mesh) {
      scene.remove(this.mesh);
      this.mesh.geometry.dispose();
      this.mesh = null;
    }

    const positions: number[] = [];
    const normals: number[] = [];
    const colors: number[] = [];
    const indices: number[] = [];
    const color = new THREE.Color();
    const startX = this.cx * CHUNK_SIZE;
    const startZ = this.cz * CHUNK_SIZE;

    for (let lx = 0; lx < CHUNK_SIZE; lx += 1) {
      for (let y = 0; y < WORLD_HEIGHT; y += 1) {
        for (let lz = 0; lz < CHUNK_SIZE; lz += 1) {
          const id = this.getLocal(lx, y, lz);
          if (!BLOCKS[id].solid) continue;

          const wx = startX + lx;
          const wz = startZ + lz;
          for (const face of FACE_DEFS) {
            const neighbor = this.world.getBlock(
              wx + face.normal.x,
              y + face.normal.y,
              wz + face.normal.z
            );
            if (BLOCKS[neighbor].solid) continue;

            const baseIndex = positions.length / 3;
            color.setHex(BLOCKS[id].color).multiplyScalar(face.shade);

            for (const corner of face.corners) {
              positions.push(wx + corner[0], y + corner[1], wz + corner[2]);
              normals.push(face.normal.x, face.normal.y, face.normal.z);
              colors.push(color.r, color.g, color.b);
            }

            indices.push(baseIndex, baseIndex + 1, baseIndex + 2);
            indices.push(baseIndex, baseIndex + 2, baseIndex + 3);
          }
        }
      }
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute("normal", new THREE.Float32BufferAttribute(normals, 3));
    geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
    geometry.setIndex(indices);
    geometry.computeBoundingSphere();

    this.mesh = new THREE.Mesh(geometry, World.material);
    this.mesh.frustumCulled = true;
    this.mesh.receiveShadow = true;
    scene.add(this.mesh);
  }
}

class World {
  static readonly material = new THREE.MeshLambertMaterial({
    vertexColors: true,
    side: THREE.FrontSide
  });

  private readonly chunks = new Map<string, Chunk>();
  private readonly edits = new Map<string, BlockId>();

  constructor(private readonly scene: THREE.Scene) {
    this.loadEdits();
  }

  ensureChunk(cx: number, cz: number) {
    const key = chunkKey(cx, cz);
    let chunk = this.chunks.get(key);
    if (!chunk) {
      chunk = new Chunk(cx, cz, this);
      this.chunks.set(key, chunk);
    }
    return chunk;
  }

  loadAround(x: number, z: number) {
    const pcx = floorDiv(Math.floor(x), CHUNK_SIZE);
    const pcz = floorDiv(Math.floor(z), CHUNK_SIZE);
    const keep = new Set<string>();

    for (let dx = -LOAD_RADIUS; dx <= LOAD_RADIUS; dx += 1) {
      for (let dz = -LOAD_RADIUS; dz <= LOAD_RADIUS; dz += 1) {
        const cx = pcx + dx;
        const cz = pcz + dz;
        const key = chunkKey(cx, cz);
        keep.add(key);
        const chunk = this.ensureChunk(cx, cz);
        if (!chunk.mesh) {
          chunk.rebuild(this.scene);
        }
      }
    }

    for (const [key, chunk] of this.chunks) {
      if (keep.has(key)) continue;
      if (chunk.mesh) {
        this.scene.remove(chunk.mesh);
        chunk.mesh.geometry.dispose();
      }
      this.chunks.delete(key);
    }
  }

  getBlock(x: number, y: number, z: number): BlockId {
    x = Math.floor(x);
    y = Math.floor(y);
    z = Math.floor(z);
    if (y < 0 || y >= WORLD_HEIGHT) return 0;
    const cx = floorDiv(x, CHUNK_SIZE);
    const cz = floorDiv(z, CHUNK_SIZE);
    const chunk = this.ensureChunk(cx, cz);
    return chunk.getLocal(localCoord(x, CHUNK_SIZE), y, localCoord(z, CHUNK_SIZE));
  }

  setBlock(x: number, y: number, z: number, id: BlockId) {
    x = Math.floor(x);
    y = Math.floor(y);
    z = Math.floor(z);
    if (y < 0 || y >= WORLD_HEIGHT) return;

    const cx = floorDiv(x, CHUNK_SIZE);
    const cz = floorDiv(z, CHUNK_SIZE);
    const lx = localCoord(x, CHUNK_SIZE);
    const lz = localCoord(z, CHUNK_SIZE);
    const chunk = this.ensureChunk(cx, cz);
    chunk.setLocal(lx, y, lz, id);

    const natural = blockAtNatural(x, y, z);
    const key = blockKey(x, y, z);
    if (id === natural) {
      this.edits.delete(key);
    } else {
      this.edits.set(key, id);
    }
    this.saveEdits();

    this.rebuildChunkAndNeighbors(cx, cz, lx, lz);
  }

  applySavedEdits(chunk: Chunk) {
    const minX = chunk.cx * CHUNK_SIZE;
    const maxX = minX + CHUNK_SIZE - 1;
    const minZ = chunk.cz * CHUNK_SIZE;
    const maxZ = minZ + CHUNK_SIZE - 1;

    for (const [key, id] of this.edits) {
      const [x, y, z] = key.split(",").map(Number);
      if (x < minX || x > maxX || z < minZ || z > maxZ || y < 0 || y >= WORLD_HEIGHT) {
        continue;
      }
      chunk.setLocal(localCoord(x, CHUNK_SIZE), y, localCoord(z, CHUNK_SIZE), id);
    }
  }

  private rebuildChunkAndNeighbors(cx: number, cz: number, lx: number, lz: number) {
    this.chunks.get(chunkKey(cx, cz))?.rebuild(this.scene);
    if (lx === 0) this.chunks.get(chunkKey(cx - 1, cz))?.rebuild(this.scene);
    if (lx === CHUNK_SIZE - 1) this.chunks.get(chunkKey(cx + 1, cz))?.rebuild(this.scene);
    if (lz === 0) this.chunks.get(chunkKey(cx, cz - 1))?.rebuild(this.scene);
    if (lz === CHUNK_SIZE - 1) this.chunks.get(chunkKey(cx, cz + 1))?.rebuild(this.scene);
  }

  private loadEdits() {
    try {
      const raw = localStorage.getItem(SAVE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as Array<[string, BlockId]>;
      for (const [key, id] of parsed) {
        if (BLOCK_KEYS.includes(id)) {
          this.edits.set(key, id);
        }
      }
    } catch {
      localStorage.removeItem(SAVE_KEY);
    }
  }

  private saveEdits() {
    localStorage.setItem(SAVE_KEY, JSON.stringify([...this.edits.entries()]));
  }
}

class Player {
  readonly position = new THREE.Vector3(8, 34, 8);
  readonly velocity = new THREE.Vector3();
  yaw = 0;
  pitch = 0;
  onGround = false;

  constructor(private readonly world: World) {
    this.load();
    if (this.position.y < 2 || this.position.y > WORLD_HEIGHT) {
      this.position.set(8, terrainHeight(8, 8) + 2, 8);
    }
  }

  update(dt: number, keys: Set<string>) {
    const speed = keys.has("ShiftLeft") || keys.has("ShiftRight") ? 8.2 : 5.4;
    const forward = new THREE.Vector3(Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    const right = new THREE.Vector3(Math.cos(this.yaw), 0, Math.sin(this.yaw));
    const move = new THREE.Vector3();

    if (keys.has("KeyW")) move.add(forward);
    if (keys.has("KeyS")) move.sub(forward);
    if (keys.has("KeyD")) move.add(right);
    if (keys.has("KeyA")) move.sub(right);

    if (move.lengthSq() > 0) move.normalize().multiplyScalar(speed);
    this.velocity.x = move.x;
    this.velocity.z = move.z;

    if (keys.has("Space") && this.onGround) {
      this.velocity.y = 7.4;
      this.onGround = false;
    }

    this.velocity.y = Math.max(this.velocity.y - 22 * dt, -28);
    this.moveAxis("x", this.velocity.x * dt);
    this.moveAxis("z", this.velocity.z * dt);
    this.moveAxis("y", this.velocity.y * dt);
  }

  applyToCamera(camera: THREE.PerspectiveCamera) {
    camera.position.set(this.position.x, this.position.y + EYE_HEIGHT, this.position.z);
    camera.rotation.set(this.pitch, this.yaw, 0, "YXZ");
  }

  intersectsAt(position: THREE.Vector3) {
    const minX = Math.floor(position.x - PLAYER_RADIUS);
    const maxX = Math.floor(position.x + PLAYER_RADIUS);
    const minY = Math.floor(position.y);
    const maxY = Math.floor(position.y + PLAYER_HEIGHT);
    const minZ = Math.floor(position.z - PLAYER_RADIUS);
    const maxZ = Math.floor(position.z + PLAYER_RADIUS);

    for (let x = minX; x <= maxX; x += 1) {
      for (let y = minY; y <= maxY; y += 1) {
        for (let z = minZ; z <= maxZ; z += 1) {
          if (BLOCKS[this.world.getBlock(x, y, z)].solid) {
            return true;
          }
        }
      }
    }
    return false;
  }

  save() {
    localStorage.setItem(
      PLAYER_KEY,
      JSON.stringify({
        x: this.position.x,
        y: this.position.y,
        z: this.position.z,
        yaw: this.yaw,
        pitch: this.pitch
      })
    );
  }

  private moveAxis(axis: "x" | "y" | "z", amount: number) {
    if (amount === 0) return;
    this.position[axis] += amount;
    if (!this.intersectsAt(this.position)) {
      return;
    }

    const sign = Math.sign(amount);
    let guard = 0;
    while (this.intersectsAt(this.position) && guard < 80) {
      this.position[axis] -= sign * 0.01;
      guard += 1;
    }

    if (axis === "y") {
      if (amount < 0) this.onGround = true;
      this.velocity.y = 0;
    }

    if (axis === "x") this.velocity.x = 0;
    if (axis === "z") this.velocity.z = 0;
  }

  private load() {
    try {
      const raw = localStorage.getItem(PLAYER_KEY);
      if (!raw) {
        this.position.set(8, terrainHeight(8, 8) + 3, 8);
        return;
      }
      const parsed = JSON.parse(raw) as {
        x: number;
        y: number;
        z: number;
        yaw: number;
        pitch: number;
      };
      this.position.set(parsed.x, parsed.y, parsed.z);
      this.yaw = parsed.yaw;
      this.pitch = parsed.pitch;
    } catch {
      this.position.set(8, terrainHeight(8, 8) + 3, 8);
    }
  }
}

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
app.prepend(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x8fc9ff);
scene.fog = new THREE.Fog(0x8fc9ff, 45, 145);

const camera = new THREE.PerspectiveCamera(72, window.innerWidth / window.innerHeight, 0.05, 350);
const world = new World(scene);
const player = new Player(world);

const ambient = new THREE.HemisphereLight(0xdbefff, 0x4d3f33, 1.45);
scene.add(ambient);

const sun = new THREE.DirectionalLight(0xfff4cf, 1.2);
sun.position.set(32, 70, 24);
sun.castShadow = true;
scene.add(sun);

const outline = new THREE.LineSegments(
  new THREE.EdgesGeometry(new THREE.BoxGeometry(1.015, 1.015, 1.015)),
  new THREE.LineBasicMaterial({ color: 0xf8f2cf, linewidth: 2 })
);
outline.visible = false;
scene.add(outline);

const keys = new Set<string>();
let selectedSlot = 0;
let targetHit: Hit | null = null;
let lastSave = 0;

const inventory = new Map<BlockId, number>(
  HOTBAR.map((id) => [id, id === 5 ? 24 : 48])
);

function renderHotbar() {
  hotbarEl.innerHTML = HOTBAR.map((id, index) => {
    const selected = index === selectedSlot ? " selected" : "";
    const count = inventory.get(id) ?? 0;
    return `
      <div class="slot${selected}">
        <span class="key">${index + 1}</span>
        <span class="swatch" style="background:#${BLOCKS[id].color.toString(16).padStart(6, "0")}"></span>
        <span class="count">${count}</span>
      </div>
    `;
  }).join("");

  blockNameEl.textContent = BLOCKS[HOTBAR[selectedSlot]].name;
}

function raycastBlock(): Hit | null {
  const origin = camera.position.clone();
  const direction = new THREE.Vector3();
  camera.getWorldDirection(direction);

  let x = Math.floor(origin.x);
  let y = Math.floor(origin.y);
  let z = Math.floor(origin.z);

  const stepX = direction.x > 0 ? 1 : -1;
  const stepY = direction.y > 0 ? 1 : -1;
  const stepZ = direction.z > 0 ? 1 : -1;

  const tDeltaX = Math.abs(1 / (direction.x || 0.00001));
  const tDeltaY = Math.abs(1 / (direction.y || 0.00001));
  const tDeltaZ = Math.abs(1 / (direction.z || 0.00001));

  let tMaxX =
    direction.x > 0 ? (Math.floor(origin.x) + 1 - origin.x) * tDeltaX : (origin.x - Math.floor(origin.x)) * tDeltaX;
  let tMaxY =
    direction.y > 0 ? (Math.floor(origin.y) + 1 - origin.y) * tDeltaY : (origin.y - Math.floor(origin.y)) * tDeltaY;
  let tMaxZ =
    direction.z > 0 ? (Math.floor(origin.z) + 1 - origin.z) * tDeltaZ : (origin.z - Math.floor(origin.z)) * tDeltaZ;

  let place = new THREE.Vector3(x, y, z);
  let distance = 0;

  for (let i = 0; i < 96 && distance < 8; i += 1) {
    if (BLOCKS[world.getBlock(x, y, z)].solid) {
      return { block: new THREE.Vector3(x, y, z), place };
    }

    place = new THREE.Vector3(x, y, z);
    if (tMaxX < tMaxY && tMaxX < tMaxZ) {
      x += stepX;
      distance = tMaxX;
      tMaxX += tDeltaX;
    } else if (tMaxY < tMaxZ) {
      y += stepY;
      distance = tMaxY;
      tMaxY += tDeltaY;
    } else {
      z += stepZ;
      distance = tMaxZ;
      tMaxZ += tDeltaZ;
    }
  }

  return null;
}

function mineBlock() {
  if (!targetHit) return;
  const current = world.getBlock(targetHit.block.x, targetHit.block.y, targetHit.block.z);
  if (current === 0) return;

  world.setBlock(targetHit.block.x, targetHit.block.y, targetHit.block.z, 0);
  inventory.set(current, (inventory.get(current) ?? 0) + 1);
  renderHotbar();
}

function placeBlock() {
  if (!targetHit) return;
  const id = HOTBAR[selectedSlot];
  const count = inventory.get(id) ?? 0;
  if (count <= 0) return;
  if (world.getBlock(targetHit.place.x, targetHit.place.y, targetHit.place.z) !== 0) return;

  world.setBlock(targetHit.place.x, targetHit.place.y, targetHit.place.z, id);
  if (player.intersectsAt(player.position)) {
    world.setBlock(targetHit.place.x, targetHit.place.y, targetHit.place.z, 0);
    return;
  }

  inventory.set(id, count - 1);
  renderHotbar();
}

function updateTarget() {
  targetHit = raycastBlock();
  if (!targetHit) {
    outline.visible = false;
    return;
  }
  outline.visible = true;
  outline.position.set(targetHit.block.x + 0.5, targetHit.block.y + 0.5, targetHit.block.z + 0.5);
}

function updateStatus() {
  const locked = document.pointerLockElement === renderer.domElement;
  statusEl.textContent = locked
    ? `XYZ ${player.position.x.toFixed(1)}, ${player.position.y.toFixed(1)}, ${player.position.z.toFixed(1)}`
    : "Click to play";
  startEl.classList.toggle("hidden", locked);
}

function requestPlay() {
  renderer.domElement.requestPointerLock();
}

startButton.addEventListener("click", requestPlay);
renderer.domElement.addEventListener("click", requestPlay);

document.addEventListener("pointerlockchange", updateStatus);
document.addEventListener("contextmenu", (event) => event.preventDefault());

document.addEventListener("keydown", (event) => {
  keys.add(event.code);
  const number = Number(event.key);
  if (number >= 1 && number <= HOTBAR.length) {
    selectedSlot = number - 1;
    renderHotbar();
  }
});

document.addEventListener("keyup", (event) => {
  keys.delete(event.code);
});

document.addEventListener("mousemove", (event) => {
  if (document.pointerLockElement !== renderer.domElement) return;
  player.yaw -= event.movementX * 0.0024;
  player.pitch -= event.movementY * 0.0024;
  player.pitch = clamp(player.pitch, -Math.PI / 2 + 0.05, Math.PI / 2 - 0.05);
});

document.addEventListener("mousedown", (event) => {
  if (document.pointerLockElement !== renderer.domElement) return;
  if (event.button === 0) mineBlock();
  if (event.button === 2) placeBlock();
});

window.addEventListener("resize", () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

let previous = performance.now();

function animate(now: number) {
  const dt = Math.min((now - previous) / 1000, 0.05);
  previous = now;

  player.update(dt, keys);
  player.applyToCamera(camera);
  world.loadAround(player.position.x, player.position.z);
  updateTarget();
  updateStatus();

  if (now - lastSave > 1500) {
    player.save();
    lastSave = now;
  }

  renderer.render(scene, camera);
  requestAnimationFrame(animate);
}

renderHotbar();
world.loadAround(player.position.x, player.position.z);
player.applyToCamera(camera);
requestAnimationFrame(animate);
