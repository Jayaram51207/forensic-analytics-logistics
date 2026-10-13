import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

let scene, camera, renderer, controls;
let containerGroup; // Holds the wireframe and dimensions
let cargoGroup; // Holds the packed boxes meshes
let currentContainer = null;
let currentPlacedBoxes = [];
let currentStepLimit = 0;

export function initVisualizer(containerElementId) {
  const containerEl = document.getElementById(containerElementId);
  if (!containerEl) return;

  // 1. Create Scene
  scene = new THREE.Scene();
  scene.background = new THREE.Color('#0b0f19'); // matching styles

  // 2. Create Camera
  camera = new THREE.PerspectiveCamera(
    45,
    containerEl.clientWidth / containerEl.clientHeight,
    0.1,
    1000
  );
  // Default position: diagonal isometric view
  resetCameraPosition();

  // 3. Create Renderer
  renderer = new THREE.WebGLRenderer({
    antialias: true,
    preserveDrawingBuffer: true // CRITICAL: allows html2canvas / toDataURL screenshots!
  });
  renderer.setSize(containerEl.clientWidth, containerEl.clientHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  // Clear container and append canvas
  containerEl.innerHTML = '';
  containerEl.appendChild(renderer.domElement);

  // 4. Create Orbit Controls
  controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.05;
  controls.maxPolarAngle = Math.PI / 2 - 0.05; // Don't let user go below floor level
  controls.minDistance = 2;
  controls.maxDistance = 100;

  // 5. Add Lights
  const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
  scene.add(ambientLight);

  const dirLight1 = new THREE.DirectionalLight(0xffffff, 0.8);
  dirLight1.position.set(30, 40, 20);
  dirLight1.castShadow = true;
  dirLight1.shadow.mapSize.width = 2048;
  dirLight1.shadow.mapSize.height = 2048;
  dirLight1.shadow.camera.near = 0.5;
  dirLight1.shadow.camera.far = 150;
  
  const d = 30;
  dirLight1.shadow.camera.left = -d;
  dirLight1.shadow.camera.right = d;
  dirLight1.shadow.camera.top = d;
  dirLight1.shadow.camera.bottom = -d;
  scene.add(dirLight1);

  const dirLight2 = new THREE.DirectionalLight(0xffffff, 0.3);
  dirLight2.position.set(-30, 20, -20);
  scene.add(dirLight2);

  // 6. Create groups
  containerGroup = new THREE.Group();
  cargoGroup = new THREE.Group();
  scene.add(containerGroup);
  scene.add(cargoGroup);

  // 7. Add a subtle grid/floor plane underneath the container
  const floorHelper = new THREE.GridHelper(100, 100, 0x1f2937, 0x111827);
  floorHelper.position.y = -0.01;
  scene.add(floorHelper);

  // 8. Start animation loop
  animate();

  // 9. Handle window resize
  window.addEventListener('resize', handleResize);
}

function animate() {
  requestAnimationFrame(animate);
  if (controls) controls.update();
  if (renderer && scene && camera) {
    renderer.render(scene, camera);
  }
}

function handleResize() {
  if (!renderer || !camera) return;
  const canvas = renderer.domElement;
  const containerEl = canvas.parentElement;
  if (!containerEl) return;

  camera.aspect = containerEl.clientWidth / containerEl.clientHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(containerEl.clientWidth, containerEl.clientHeight);
}

export function resetCameraPosition() {
  if (!camera || !controls) return;

  if (currentContainer) {
    // Focus camera based on container length (Z coordinates)
    const L = currentContainer.length / 100; // cm to m
    const W = currentContainer.width / 100;
    const H = currentContainer.height / 100;

    camera.position.set(L * 1.2, H * 1.8, W * 1.5);
    controls.target.set(0, H / 2, 0); // Focus center
  } else {
    camera.position.set(12, 10, 15);
    controls.target.set(0, 0, 0);
  }
  controls.update();
}

/**
 * Setup a container outline and dimensions
 * dimensions in cm, we map 100cm = 1 unit in Three.js (1 meter)
 */
export function renderContainer(container) {
  currentContainer = container;
  
  // Clear previous container details
  while (containerGroup.children.length > 0) {
    containerGroup.remove(containerGroup.children[0]);
  }

  const L = container.length / 100; // length (X)
  const W = container.width / 100;  // width (Y)
  const H = container.height / 100; // height (Z)
  
  // Align container so the bottom-back-left corner (0,0,0) in our packing algorithm
  // corresponds to coordinates: X starting from -L/2 to L/2, Y from 0 to H, Z from -W/2 to W/2.
  // This centers the container on X and Z axis and keeps Y on the floor.
  
  // Container Box (Semi-transparent walls + Wireframe)
  const geom = new THREE.BoxGeometry(L, H, W);
  
  // Wireframe helper
  const edges = new THREE.EdgesGeometry(geom);
  const line = new THREE.LineSegments(
    edges,
    new THREE.LineBasicMaterial({ color: 0x38bdf8, linewidth: 2 })
  );
  line.position.set(0, H / 2, 0);
  containerGroup.add(line);

  // Translucent back, bottom and side panels to give it depth
  const wallMat = new THREE.MeshPhysicalMaterial({
    color: 0x1e293b,
    transparent: true,
    opacity: 0.1,
    roughness: 0.5,
    metalness: 0.1,
    side: THREE.BackSide,
    depthWrite: false
  });
  const wallMesh = new THREE.Mesh(geom, wallMat);
  wallMesh.position.set(0, H / 2, 0);
  containerGroup.add(wallMesh);

  // Draw door indicator at the front end (X = +L/2)
  const doorGeom = new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(L/2, 0, -W/2),
    new THREE.Vector3(L/2, H, -W/2),
    new THREE.Vector3(L/2, H, W/2),
    new THREE.Vector3(L/2, 0, W/2),
    new THREE.Vector3(L/2, 0, -W/2)
  ]);
  const doorLine = new THREE.Line(
    doorGeom,
    new THREE.LineBasicMaterial({ color: 0xef4444, linewidth: 2 })
  );
  containerGroup.add(doorLine);

  // Add grid ruler lines on the floor to show 1-meter packing depth markers
  for (let x = -L/2; x <= L/2; x += 1) {
    const points = [
      new THREE.Vector3(x, 0, -W/2),
      new THREE.Vector3(x, 0, W/2)
    ];
    const gridGeom = new THREE.BufferGeometry().setFromPoints(points);
    const gridLine = new THREE.Line(
      gridGeom,
      new THREE.LineBasicMaterial({ color: 0x334155, opacity: 0.4, transparent: true })
    );
    containerGroup.add(gridLine);
  }

  resetCameraPosition();
}

/**
 * Render the packed boxes in the container
 * box values are in cm
 */
// Helper for checking horizontal overlap of two cargo items (values in cm)
function horizontalOverlap(b1, b2) {
  const EPS = 0.5; // cm margin
  return (
    b1.x + EPS < b2.x + b2.l &&
    b1.x + b1.l - EPS > b2.x &&
    b1.y + EPS < b2.y + b2.w &&
    b1.y + b1.w - EPS > b2.y
  );
}

export function renderCargo(placedBoxes, stepLimit = null) {
  currentPlacedBoxes = placedBoxes;
  currentStepLimit = stepLimit === null ? placedBoxes.length : stepLimit;

  // Clear previous cargo meshes
  while (cargoGroup.children.length > 0) {
    cargoGroup.remove(cargoGroup.children[0]);
  }

  if (!currentContainer) return;

  const L = currentContainer.length / 100;
  const W = currentContainer.width / 100;
  const H = currentContainer.height / 100;

  // 1. Copy the subset of boxes to render and initialize their render attributes
  const renderedBoxes = [];
  for (let i = 0; i < currentStepLimit; i++) {
    renderedBoxes.push({
      ...placedBoxes[i],
      renderX: placedBoxes[i].x,
      renderY: placedBoxes[i].y,
      renderZ: placedBoxes[i].z,
      renderL: placedBoxes[i].l,
      renderW: placedBoxes[i].w,
      renderH: placedBoxes[i].h
    });
  }

  // 2. Physics pass for Bag Compression and Stacking Shifting
  // Sort by z coordinate ascending so we process support heights bottom-to-top
  const sortedRendered = [...renderedBoxes].sort((a, b) => a.z - b.z);

  for (let i = 0; i < sortedRendered.length; i++) {
    const b = sortedRendered[i];
    
    // Ground level items stay at z = 0
    if (b.z < 1.0) {
      b.renderZ = 0;
    } else {
      // Find supporting parents
      const bottomZ = b.z;
      const parents = sortedRendered.filter(p => {
        return Math.abs((p.z + p.h) - bottomZ) < 1.0 && horizontalOverlap(p, b);
      });
      
      if (parents.length > 0) {
        // Position rests on top of the highest shifted support
        b.renderZ = Math.max(...parents.map(p => p.renderZ + p.renderH));
      } else {
        b.renderZ = b.z;
      }
    }

    // Determine if this item has anything stacked on top of it
    const topZ = b.z + b.h;
    const hasTopCargo = sortedRendered.some(t => {
      return Math.abs(t.z - topZ) < 1.0 && horizontalOverlap(b, t);
    });

    // If it is a bag and supporting cargo on top, compress it
    if (b.type === 'bag' && hasTopCargo) {
      b.renderH = b.h * 0.93; // 7% compression
      b.renderL = b.l * 1.06; // 6% horizontal expansion (length)
      b.renderW = b.w * 1.06; // 6% horizontal expansion (width)
    } else {
      b.renderH = b.h;
      b.renderL = b.l;
      b.renderW = b.w;
    }
  }

  // 3. Render each box using its solved rendering dimensions and coordinates
  for (let i = 0; i < renderedBoxes.length; i++) {
    const box = renderedBoxes[i];
    
    // Scale dimensions from cm to m
    const bl = box.renderL / 100;
    const bw = box.renderW / 100;
    const bh = box.renderH / 100;
    
    // Center positions (using original horizontal centers to preserve packing grid, and shifted vertical position)
    const bx = (box.x / 100) + (box.l / 200) - (L / 2); // X-axis (Length)
    const bz = (box.y / 100) + (box.w / 200) - (W / 2); // Z-axis (Width)
    const by = (box.renderZ / 100) + (bh / 2);           // Y-axis (Height, starts at floor=0)

    let mesh;

    if (box.type === 'barrel') {
      mesh = new THREE.Group();
      mesh.position.set(bx, by, bz);

      const pSizeId = box.palletSizeId || 'us_std';
      const pMaterial = box.palletMaterial || 'wood';
      const rows = box.layoutRows || 1;
      const cols = box.layoutCols || 1;
      const bDia = (box.barrelDiameter || 58.4) / 100;
      const bH = (box.barrelHeight || 87.6) / 100;

      let pL = 121.9 / 100;
      let pW = 101.6 / 100;
      if (pSizeId === 'eur1') {
        pL = 120 / 100;
        pW = 80 / 100;
      } else if (pSizeId === 'eur2') {
        pL = 120 / 100;
        pW = 100 / 100;
      }

      // 1. Add Pallet Base
      const palletH = 0.144; // 14.4 cm
      const palletBase = createPalletBaseMesh(pL, pW, palletH, pMaterial);
      palletBase.position.y = -bh / 2;
      mesh.add(palletBase);

      // 2. Add Barrels in grid layout
      const barrelRadius = bDia / 2;
      const geom = new THREE.CylinderGeometry(barrelRadius, barrelRadius, bH, 24);
      
      const mat = new THREE.MeshStandardMaterial({
        color: new THREE.Color(box.color),
        roughness: 0.35,
        metalness: 0.3,
        transparent: true,
        opacity: 0.9,
        side: THREE.DoubleSide
      });

      const ringMat = new THREE.MeshStandardMaterial({
        color: 0x1e293b,
        roughness: 0.5,
        metalness: 0.8
      });

      const bandGeom = new THREE.CylinderGeometry(barrelRadius * 1.02, barrelRadius * 1.02, bH * 0.03, 24);
      const rimGeom = new THREE.CylinderGeometry(barrelRadius * 1.03, barrelRadius * 1.03, bH * 0.02, 24);
      const edgeGeom = new THREE.EdgesGeometry(geom);

      const barrelY = -bh / 2 + palletH + bH / 2;
      const startX = -(rows - 1) * bDia / 2;
      const startZ = -(cols - 1) * bDia / 2;

      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const barrelMesh = new THREE.Mesh(geom, mat);
          const xPos = startX + r * bDia;
          const zPos = startZ + c * bDia;
          barrelMesh.position.set(xPos, barrelY, zPos);
          barrelMesh.castShadow = true;
          barrelMesh.receiveShadow = true;

          // Cylinder outline
          const border = new THREE.LineSegments(
            edgeGeom,
            new THREE.LineBasicMaterial({ color: 0x0f172a, linewidth: 1 })
          );
          barrelMesh.add(border);

          // Metal bands
          const band1 = new THREE.Mesh(bandGeom, ringMat);
          band1.position.y = bH * 0.22;
          barrelMesh.add(band1);

          const band2 = new THREE.Mesh(bandGeom, ringMat);
          band2.position.y = -bH * 0.22;
          barrelMesh.add(band2);

          // Top/bottom rims
          const topRim = new THREE.Mesh(rimGeom, ringMat);
          topRim.position.y = bH * 0.49;
          barrelMesh.add(topRim);

          const bottomRim = new THREE.Mesh(rimGeom, ringMat);
          bottomRim.position.y = -bH * 0.49;
          barrelMesh.add(bottomRim);

          mesh.add(barrelMesh);
        }
      }

    } else if (box.type === 'pallet') {
      // Pallet: wood or plastic base + wrapped cargo block on top
      mesh = new THREE.Group();
      mesh.position.set(bx, by, bz);

      const ol = box.originalDim.l / 100;
      const ow = box.originalDim.w / 100;
      const oh = box.originalDim.h / 100;

      // Pallet base height
      const palletH = Math.min(0.144, oh * 0.2);
      const cargoH = oh - palletH;

      const innerGroup = new THREE.Group();

      // Create Pallet Base
      const palletBase = createPalletBaseMesh(ol, ow, palletH, box.material);
      palletBase.position.y = -oh / 2;
      innerGroup.add(palletBase);

      if (box.palletCartonCalc && box.cartonPositions && box.cartonPositions.length > 0) {
        // Render stacked cartons on pallet
        const ch = (box.cartonHeight || (cargoH * 100)) / 100;
        const layers = box.cartonLayers || 1;

        const cartonMat = new THREE.MeshStandardMaterial({
          color: new THREE.Color(box.color),
          roughness: 0.5,
          metalness: 0.1,
          transparent: true,
          opacity: 0.9,
          side: THREE.DoubleSide
        });

        for (let layer = 0; layer < layers; layer++) {
          box.cartonPositions.forEach(cPos => {
            const cl = cPos.l / 100;
            const cw = cPos.w / 100;
            
            const cartonGeom = new THREE.BoxGeometry(cl, ch, cw);
            const cartonMesh = new THREE.Mesh(cartonGeom, cartonMat);
            
            const posX = (cPos.x + cPos.l / 2) / 100 - ol / 2;
            const posZ = (cPos.y + cPos.w / 2) / 100 - ow / 2;
            const posY = -oh / 2 + palletH + layer * ch + ch / 2;
            
            cartonMesh.position.set(posX, posY, posZ);
            cartonMesh.castShadow = true;
            cartonMesh.receiveShadow = true;

            const edgeGeom = new THREE.EdgesGeometry(cartonGeom);
            const border = new THREE.LineSegments(
              edgeGeom,
              new THREE.LineBasicMaterial({ color: 0x0f172a, linewidth: 1 })
            );
            cartonMesh.add(border);

            innerGroup.add(cartonMesh);
          });
        }
      } else {
        // Cargo on top of the pallet base (Solid block)
        const cargoGeom = new THREE.BoxGeometry(ol, cargoH, ow);
        const cargoMat = new THREE.MeshStandardMaterial({
          color: new THREE.Color(box.color),
          roughness: 0.4,
          metalness: 0.1,
          transparent: true,
          opacity: 0.9,
          side: THREE.DoubleSide
        });
        const cargoMesh = new THREE.Mesh(cargoGeom, cargoMat);
        cargoMesh.position.set(0, -oh/2 + palletH + cargoH/2, 0);
        cargoMesh.castShadow = true;
        cargoMesh.receiveShadow = true;
        
        const cargoEdge = new THREE.EdgesGeometry(cargoGeom);
        const cargoBorder = new THREE.LineSegments(
          cargoEdge,
          new THREE.LineBasicMaterial({ color: 0x0f172a, linewidth: 1.5 })
        );
        cargoMesh.add(cargoBorder);
        innerGroup.add(cargoMesh);
      }

      mesh.add(innerGroup);

      // Solve rotation permutation to align local group axes to placed dimensions
      const matchPerm = (v1, v2) => Math.abs(v1 - v2) < 0.02;
      let rotX = 0, rotY = 0, rotZ = 0;
      
      if (matchPerm(bh, oh)) {
        if (matchPerm(bl, ow)) {
          rotY = Math.PI / 2;
        }
      } else if (matchPerm(bl, oh)) {
        rotZ = Math.PI / 2;
        if (matchPerm(bw, ol)) {
          rotY = Math.PI / 2;
        }
      } else if (matchPerm(bw, oh)) {
        rotX = -Math.PI / 2;
        if (matchPerm(bl, ow)) {
          rotY = Math.PI / 2;
        }
      }
      
      innerGroup.rotation.set(rotX, rotY, rotZ);

    } else if (box.type === 'bag') {
      // One-Ton Bag: cream body with loops and color strip
      mesh = new THREE.Group();
      mesh.position.set(bx, by, bz);

      const bagGeom = new THREE.BoxGeometry(bl, bh, bw);
      const bagMat = new THREE.MeshStandardMaterial({
        color: 0xf8fafc,
        roughness: 0.85,
        metalness: 0.05,
        transparent: true,
        opacity: 0.95
      });
      const bagMesh = new THREE.Mesh(bagGeom, bagMat);
      bagMesh.castShadow = true;
      bagMesh.receiveShadow = true;

      const bagEdge = new THREE.EdgesGeometry(bagGeom);
      const bagBorder = new THREE.LineSegments(
        bagEdge,
        new THREE.LineBasicMaterial({ color: 0xcbd5e1, linewidth: 1 })
      );
      bagMesh.add(bagBorder);
      mesh.add(bagMesh);

      // Colored band in middle
      const bandGeom = new THREE.BoxGeometry(bl * 1.01, bh * 0.15, bw * 1.01);
      const bandMat = new THREE.MeshStandardMaterial({
        color: new THREE.Color(box.color),
        roughness: 0.6,
        metalness: 0.1
      });
      const idBand = new THREE.Mesh(bandGeom, bandMat);
      idBand.position.set(0, 0, 0);
      mesh.add(idBand);

      // 4 lift loops
      const loopRadius = Math.min(bl, bw) * 0.07;
      const loopTube = loopRadius * 0.25;
      const torusGeom = new THREE.TorusGeometry(loopRadius, loopTube, 8, 12, Math.PI);
      const strapMat = new THREE.MeshStandardMaterial({
        color: new THREE.Color(box.color),
        roughness: 0.7,
        metalness: 0.1
      });

      const corners = [
        { x: -bl*0.4, z: -bw*0.4 },
        { x: bl*0.4, z: -bw*0.4 },
        { x: -bl*0.4, z: bw*0.4 },
        { x: bl*0.4, z: bw*0.4 }
      ];

      corners.forEach(c => {
        const loop = new THREE.Mesh(torusGeom, strapMat);
        loop.position.set(c.x, bh/2 - loopTube, c.z);
        mesh.add(loop);
      });

    } else {
      // Carton Box (default)
      const geom = new THREE.BoxGeometry(bl, bh, bw);
      const mat = new THREE.MeshStandardMaterial({
        color: new THREE.Color(box.color),
        roughness: 0.3,
        metalness: 0.1,
        transparent: true,
        opacity: 0.9,
        side: THREE.DoubleSide
      });
      
      mesh = new THREE.Mesh(geom, mat);
      mesh.position.set(bx, by, bz);
      mesh.castShadow = true;
      mesh.receiveShadow = true;

      const edgeGeom = new THREE.EdgesGeometry(geom);
      const border = new THREE.LineSegments(
        edgeGeom,
        new THREE.LineBasicMaterial({ color: 0x0f172a, linewidth: 1.5 })
      );
      mesh.add(border);
    }

    cargoGroup.add(mesh);
  }
}

/**
 * Capture a PNG screenshot of the current 3D canvas viewport
 */
export function getSnapshot() {
  if (!renderer || !scene || !camera) return null;
  
  // Render immediately to ensure the drawing buffer is fresh
  renderer.render(scene, camera);
  
  // Get data URL from renderer canvas
  return renderer.domElement.toDataURL('image/png');
}

/**
 * Set a specific camera viewpoint angle
 * useful for pdf generation
 */
export function setCameraAngle(angleName) {
  if (!camera || !controls || !currentContainer) return;

  const L = currentContainer.length / 100;
  const W = currentContainer.width / 100;
  const H = currentContainer.height / 100;

  if (angleName === 'isometric') {
    camera.position.set(L * 1.1, H * 1.5, W * 1.4);
  } else if (angleName === 'top') {
    camera.position.set(0, H * 2.5, 0);
  } else if (angleName === 'side') {
    camera.position.set(0, H / 2, W * 2.0);
  } else if (angleName === 'back') {
    camera.position.set(-L * 1.5, H / 2, 0);
  }

  controls.target.set(0, H / 2, 0);
  controls.update();
  renderer.render(scene, camera);
}

function createPalletBaseMesh(pL, pW, pH, material) {
  const palletGroup = new THREE.Group();

  if (material === 'plastic') {
    const plasticMat = new THREE.MeshStandardMaterial({
      color: 0x1e293b,
      roughness: 0.5,
      metalness: 0.2
    });
    
    // Grid plate
    const plateGeom = new THREE.BoxGeometry(pL, pH * 0.2, pW);
    const plate = new THREE.Mesh(plateGeom, plasticMat);
    plate.position.set(0, pH - (pH * 0.1), 0);
    plate.castShadow = true;
    plate.receiveShadow = true;
    palletGroup.add(plate);
    
    // 9 legs
    const legW = pL * 0.12;
    const legD = pW * 0.12;
    const legH = pH * 0.8;
    const legGeom = new THREE.BoxGeometry(legW, legH, legD);
    
    const xOffsets = [-pL * 0.4, 0, pL * 0.4];
    const zOffsets = [-pW * 0.4, 0, pW * 0.4];
    
    xOffsets.forEach(x => {
      zOffsets.forEach(z => {
        const leg = new THREE.Mesh(legGeom, plasticMat);
        leg.position.set(x, legH / 2, z);
        leg.castShadow = true;
        leg.receiveShadow = true;
        palletGroup.add(leg);
      });
    });
  } else {
    // Wooden pallet base
    const woodMat = new THREE.MeshStandardMaterial({
      color: 0x8c6239,
      roughness: 0.9,
      metalness: 0.05
    });
    
    const stringerW = pW * 0.08;
    const stringerH = pH * 0.6;
    const stringerGeom = new THREE.BoxGeometry(pL, stringerH, stringerW);
    
    const centerStr = new THREE.Mesh(stringerGeom, woodMat);
    centerStr.position.set(0, stringerH / 2 + pH * 0.15, 0);
    palletGroup.add(centerStr);

    const leftStr = new THREE.Mesh(stringerGeom, woodMat);
    leftStr.position.set(0, stringerH / 2 + pH * 0.15, -pW / 2 + stringerW / 2 + pW * 0.04);
    palletGroup.add(leftStr);

    const rightStr = new THREE.Mesh(stringerGeom, woodMat);
    rightStr.position.set(0, stringerH / 2 + pH * 0.15, pW / 2 - stringerW / 2 - pW * 0.04);
    palletGroup.add(rightStr);

    const boardW = pL * 0.12;
    const boardH = pH * 0.15;
    const boardGeom = new THREE.BoxGeometry(boardW, boardH, pW);

    for (let j = 0; j < 5; j++) {
      const board = new THREE.Mesh(boardGeom, woodMat);
      const boardX = -pL / 2 + boardW / 2 + (pL * 0.04) + j * ((pL - boardW - pL * 0.08) / 4);
      board.position.set(boardX, pH - boardH / 2, 0);
      board.castShadow = true;
      board.receiveShadow = true;
      palletGroup.add(board);
    }

    const bottomBoardGeom = new THREE.BoxGeometry(pL, pH * 0.1, pW * 0.12);
    
    const bCenter = new THREE.Mesh(bottomBoardGeom, woodMat);
    bCenter.position.set(0, pH * 0.05, 0);
    palletGroup.add(bCenter);

    const bLeft = new THREE.Mesh(bottomBoardGeom, woodMat);
    bLeft.position.set(0, pH * 0.05, -pW / 2 + pW * 0.06);
    palletGroup.add(bLeft);

    const bRight = new THREE.Mesh(bottomBoardGeom, woodMat);
    bRight.position.set(0, pH * 0.05, pW / 2 - pW * 0.06);
    palletGroup.add(bRight);
  }

  return palletGroup;
}
