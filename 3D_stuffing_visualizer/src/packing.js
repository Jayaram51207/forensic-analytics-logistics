/**
 * 3D Bin Packing Algorithm using Extreme Points (EP) heuristic
 * with Deepest-Bottom-Left-Fill (DBLF) and stability checks.
 */

export function packCargo(container, itemTypes, settings = {}) {
  const minSupportNeeded = settings.minSupportNeeded ?? 0.6; // 60% default support needed

  // 1. Flatten itemTypes into individual item instances
  let individualItems = [];
  itemTypes.forEach((type, typeIndex) => {
    for (let i = 0; i < type.quantity; i++) {
      let length = Number(type.length);
      let width = Number(type.width);
      let height = Number(type.height);
      const originalDim = { l: length, w: width, h: height };

      // Apply bulging factor if it is a bag
      if (type.type === 'bag' && type.bulgingFactor) {
        const factor = 1 + (Number(type.bulgingFactor) / 100);
        length = length * factor;
        width = width * factor;
        // height settles/compacts slightly, e.g. -30% of the bulging factor
        height = height * (1 - (Number(type.bulgingFactor) * 0.3) / 100);
      }

      individualItems.push({
        ...type,
        typeIndex,
        itemIndex: i,
        name: type.name,
        length,
        width,
        height,
        weight: Number(type.weight),
        color: type.color || '#3b82f6',
        orientation: type.orientation || 'any', // 'any', 'upright', 'none'
        type: type.type || 'carton',
        material: type.material || null,
        fillingMaterial: type.fillingMaterial || null,
        bulgingFactor: type.bulgingFactor || null,
        originalDim
      });
    }
  });

  // 2. Sort items: Volume descending (largest first)
  individualItems.sort((a, b) => {
    const volA = a.length * a.width * a.height;
    const volB = b.length * b.width * b.height;
    return volB - volA;
  });

  const containerL = Number(container.length);
  const containerW = Number(container.width);
  const containerH = Number(container.height);
  const containerMaxWeight = Number(container.maxWeight);

  let placedBoxes = [];
  let unplacedBoxes = [];
  let currentWeight = 0;

  // Spatial Indexing Structures
  const BUCKET_SIZE = 100; // Bucket size in cm along the X-axis (Length)
  let buckets = [];        // buckets[i] contains array of placed boxes overlapping bucket i
  let placedBoxesByTopZ = {}; // placedBoxesByTopZ[z] contains array of placed boxes whose top is at height z

  function addBoxToSpatialIndex(box) {
    // Add to buckets (X-axis partitioning)
    const startBucket = Math.max(0, Math.floor(box.x / BUCKET_SIZE));
    const endBucket = Math.max(0, Math.floor((box.x + box.l) / BUCKET_SIZE));
    for (let i = startBucket; i <= endBucket; i++) {
      if (!buckets[i]) buckets[i] = [];
      buckets[i].push(box);
    }

    // Add to top-Z index (for stability check)
    const topZ = Math.round((box.z + box.h) * 1000) / 1000;
    if (!placedBoxesByTopZ[topZ]) placedBoxesByTopZ[topZ] = [];
    placedBoxesByTopZ[topZ].push(box);
  }

  // Extreme points list, starting with origin
  let eps = [{ x: 0, y: 0, z: 0 }];

  // Helper to check if two cuboids intersect (with a small epsilon to prevent floating point issues)
  const EPSILON = 0.01;
  function intersect(b1, b2) {
    return (
      b1.x + EPSILON < b2.x + b2.l &&
      b1.x + b1.l - EPSILON > b2.x &&
      b1.y + EPSILON < b2.y + b2.w &&
      b1.y + b1.w - EPSILON > b2.y &&
      b1.z + EPSILON < b2.z + b2.h &&
      b1.z + b1.h - EPSILON > b2.z
    );
  }

  // Helper to check stability / support area (optimized to only query candidate boxes at topZ = z)
  function checkStability(x, y, z, dl, dw) {
    if (z === 0) return true; // Ground is 100% stable

    let supportedArea = 0;
    const bottomMinX = x;
    const bottomMaxX = x + dl;
    const bottomMinY = y;
    const bottomMaxY = y + dw;

    const rz = Math.round(z * 1000) / 1000;
    const candidateSupportBoxes = placedBoxesByTopZ[rz];
    if (!candidateSupportBoxes) return false; // No support underneath

    for (const b of candidateSupportBoxes) {
      // Calculate intersection footprint of new box's bottom and placed box's top
      const interMinX = Math.max(bottomMinX, b.x);
      const interMaxX = Math.min(bottomMaxX, b.x + b.l);
      const interMinY = Math.max(bottomMinY, b.y);
      const interMaxY = Math.min(bottomMaxY, b.y + b.w);

      if (interMinX < interMaxX && interMinY < interMaxY) {
        supportedArea += (interMaxX - interMinX) * (interMaxY - interMinY);
      }
    }

    const totalArea = dl * dw;
    return (supportedArea / totalArea) >= minSupportNeeded;
  }

  // Loop through items and pack them
  for (const item of individualItems) {
    let bestPlacement = null;
    let bestScore = Infinity;

    // Check if item weight would exceed container max payload
    if (currentWeight + item.weight > containerMaxWeight) {
      unplacedBoxes.push(item);
      continue;
    }

    // Determine allowed orientations (size combinations)
    // dl = length (X), dw = width (Y), dh = height (Z)
    let orientations = [];
    const { length: l, width: w, height: h } = item;

    if (item.orientation === 'none') {
      orientations.push({ dl: l, dw: w, dh: h });
    } else if (item.orientation === 'upright') {
      // Height is fixed, can swap length and width (rotation around Z axis)
      orientations.push({ dl: l, dw: w, dh: h });
      if (l !== w) {
        orientations.push({ dl: w, dw: l, dh: h });
      }
    } else {
      // Full 6 orientations
      const uniqueOrientations = new Set();
      const perms = [
        [l, w, h], [l, h, w],
        [w, l, h], [w, h, l],
        [h, l, w], [h, w, l]
      ];
      for (const p of perms) {
        const key = `${p[0]}-${p[1]}-${p[2]}`;
        if (!uniqueOrientations.has(key)) {
          uniqueOrientations.add(key);
          orientations.push({ dl: p[0], dw: p[1], dh: p[2] });
        }
      }
    }

    // Try to place the item at each Extreme Point with each allowed orientation
    for (const ep of eps) {
      for (const orient of orientations) {
        const { dl, dw, dh } = orient;

        // 1. Boundary check
        if (ep.x + dl > containerL || ep.y + dw > containerW || ep.z + dh > containerH) {
          continue;
        }

        // 2. Overlap check (optimized via spatial buckets along X-axis)
        const candidateBox = { x: ep.x, y: ep.y, z: ep.z, l: dl, w: dw, h: dh };
        let hasOverlap = false;

        const startBucket = Math.max(0, Math.floor(candidateBox.x / BUCKET_SIZE));
        const endBucket = Math.max(0, Math.floor((candidateBox.x + candidateBox.l) / BUCKET_SIZE));
        const checkedBoxes = new Set();

        for (let i = startBucket; i <= endBucket; i++) {
          const bucket = buckets[i];
          if (!bucket) continue;
          for (const pb of bucket) {
            if (checkedBoxes.has(pb.id)) continue;
            checkedBoxes.add(pb.id);
            if (intersect(candidateBox, pb)) {
              hasOverlap = true;
              break;
            }
          }
          if (hasOverlap) break;
        }
        if (hasOverlap) continue;

        // 3. Stability check (optimized internally using topZ height map index)
        if (!checkStability(ep.x, ep.y, ep.z, dl, dw)) {
          continue;
        }

        // Calculate placement score (minimize Z first for layer-by-layer, then X, then Y)
        const score = ep.z * 1000000 + ep.x * 1000 + ep.y;

        if (score < bestScore) {
          bestScore = score;
          bestPlacement = {
            x: ep.x,
            y: ep.y,
            z: ep.z,
            l: dl,
            w: dw,
            h: dh,
            item: item
          };
        }
      }
    }

    // Apply best placement if found
    if (bestPlacement) {
      const { x, y, z, l, w, h, item: it } = bestPlacement;
      const newBox = {
        ...it,
        id: `${it.typeIndex}-${it.itemIndex}`,
        name: it.name,
        color: it.color,
        weight: it.weight,
        x, y, z,
        l, w, h,
        typeIndex: it.typeIndex,
        itemIndex: it.itemIndex,
        originalDim: it.originalDim || { l: it.length, w: it.width, h: it.height },
        type: it.type || 'carton',
        material: it.material || null,
        fillingMaterial: it.fillingMaterial || null,
        bulgingFactor: it.bulgingFactor || null
      };

      placedBoxes.push(newBox);
      addBoxToSpatialIndex(newBox);
      currentWeight += it.weight;

      // Add new candidate Extreme Points
      const newEPs = [
        { x: x + l, y: y, z: z },
        { x: x, y: y + w, z: z },
        { x: x, y: y, z: z + h }
      ];

      // Add them to EPs list
      eps.push(...newEPs);

      // Clean up and filter EPs list
      // - Remove duplicates
      // - Remove points that are inside placed boxes (optimized via bucket lookup)
      // - Remove points that are outside container bounds
      const filteredEps = [];
      const seen = new Set();

      for (const p of eps) {
        // Round to 3 decimals to avoid precision issues
        const rx = Math.round(p.x * 1000) / 1000;
        const ry = Math.round(p.y * 1000) / 1000;
        const rz = Math.round(p.z * 1000) / 1000;
        const key = `${rx},${ry},${rz}`;

        if (seen.has(key)) continue;

        // Container boundary check
        if (rx >= containerL || ry >= containerW || rz >= containerH) continue;

        // Check if point is inside any placed box (only query bucket for pt's x coordinate)
        let insideBox = false;
        const ptBucketIdx = Math.max(0, Math.floor(rx / BUCKET_SIZE));
        const ptBucket = buckets[ptBucketIdx];
        if (ptBucket) {
          for (const pb of ptBucket) {
            if (
              rx >= pb.x && rx < pb.x + pb.l - EPSILON &&
              ry >= pb.y && ry < pb.y + pb.w - EPSILON &&
              rz >= pb.z && rz < pb.z + pb.h - EPSILON
            ) {
              insideBox = true;
              break;
            }
          }
        }

        if (!insideBox) {
          seen.add(key);
          filteredEps.push({ x: rx, y: ry, z: rz });
        }
      }

      // Sort extreme points: bottom-to-top (min Z), then back-to-front (min X), then left-to-right (min Y)
      filteredEps.sort((a, b) => a.z - b.z || a.x - b.x || a.y - b.y);
      eps = filteredEps;

    } else {
      // Could not pack item
      unplacedBoxes.push(item);
    }
  }

  // Center cargo along the X-axis (length) and Y-axis (width) for weight balance
  if (placedBoxes.length > 0) {
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;

    placedBoxes.forEach(b => {
      minX = Math.min(minX, b.x);
      maxX = Math.max(maxX, b.x + b.l);
      minY = Math.min(minY, b.y);
      maxY = Math.max(maxY, b.y + b.w);
    });

    const occupiedWidth = maxY - minY;

    const shiftY = (containerW - occupiedWidth) / 2 - minY;

    // Apply translation only to Y-axis for lateral weight balance
    placedBoxes.forEach(b => {
      if (Math.abs(shiftY) > 0.001) {
        b.y = Math.round((b.y + shiftY) * 1000) / 1000;
      }
    });
  }

  // Calculate volume totals
  const containerVol = containerL * containerW * containerH;
  let packedVol = 0;
  placedBoxes.forEach(b => {
    packedVol += b.l * b.w * b.h;
  });

  return {
    placedBoxes,
    unplacedBoxes,
    totalWeight: currentWeight,
    totalVolume: packedVol,
    weightUtilization: (currentWeight / containerMaxWeight) * 100,
    volumeUtilization: (packedVol / containerVol) * 100,
    containerVol,
    containerMaxWeight
  };
}
