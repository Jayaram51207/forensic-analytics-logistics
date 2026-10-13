import { packCargo } from './packing';
import { initVisualizer, renderContainer, renderCargo, resetCameraPosition, setCameraAngle } from './visualizer';
import { exportStuffingReport } from './projectionExporter';


// --- STATE MANAGEMENT ---
let manifestList = [
  { name: "Euro Pallet: Wood Crates", length: 120, width: 80, height: 160, weight: 400, quantity: 12, color: "#b58a63", orientation: "upright", type: "pallet", material: "wood", sizeId: "eur1" },
  { name: "Standard Cartons", length: 60, width: 40, height: 40, weight: 18, quantity: 80, color: "#0ea5e9", orientation: "any", type: "carton" },
  { name: "FIBC Grain Bags", length: 110, width: 90, height: 90, weight: 1000, quantity: 12, color: "#cbd5e1", orientation: "upright", type: "bag", sizeId: "fibc_std", fillingMaterial: "seeds", bulgingFactor: 15 },
  { name: "55-Gal Oil Barrels", length: 121.9, width: 116.8, height: 102, weight: 910, quantity: 8, color: "#1e293b", orientation: "upright", type: "barrel", sizeId: "drum_55g", palletSizeId: "us_std", palletMaterial: "wood", barrelDiameter: 58.4, barrelHeight: 87.6, barrelWeight: 220, palletLength: 121.9, palletWidth: 101.6, layoutRows: 2, layoutCols: 2 }
];

const predefinedContainers = [
  { id: "20std", name: "20' Standard Container", length: 589, width: 235, height: 239, maxWeight: 28200, desc: "20ft General Purpose ISO Container" },
  { id: "40std", name: "40' Standard Container", length: 1203, width: 235, height: 239, maxWeight: 28800, desc: "40ft General Purpose ISO Container" },
  { id: "40hc", name: "40' High Cube Container", length: 1203, width: 235, height: 269, maxWeight: 27800, desc: "40ft High Cube ISO Container (Extra Height)" },
  { id: "45hc", name: "45' High Cube Container", length: 1355, width: 235, height: 269, maxWeight: 27700, desc: "45ft High Cube ISO Container" },
  { id: "20ot", name: "20' Open Top Container", length: 589, width: 235, height: 236, maxWeight: 28200, desc: "20ft Open Top ISO Container (Top Loading)" },
  { id: "40ot", name: "40' Open Top Container", length: 1203, width: 235, height: 236, maxWeight: 26600, desc: "40ft Open Top ISO Container (Top Loading)" }
];

let selectedContainer = predefinedContainers[2]; // Default: 40' High Cube
let currentUnit = 'cm'; // Dimension unit state: 'cm', 'in', or 'mm'
let packingResults = null;
let currentStep = 0;
let isPlaying = false;
let playInterval = null;

// --- INITIALIZATION ---
document.addEventListener('DOMContentLoaded', () => {
  // Initialize Three.js visualizer
  initVisualizer('viewport-3d');
  
  // Render Predefined Containers list
  renderContainersGrid();

  // Render Cargo Manifest Table
  renderManifestTable();

  // Bind all UI interaction event listeners
  bindEventListeners();

  // Perform initial packing calculation
  calculateStuffing();
});

// --- RENDER DYNAMIC UI COMPONENTS ---

function renderManifestTable() {
  const tbody = document.querySelector('#products-table tbody');
  tbody.innerHTML = '';

  if (manifestList.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="7" class="text-center text-muted" style="padding: 2rem 0;">
          No items in cargo manifest. Add items using the sidebar form!
        </td>
      </tr>
    `;
    return;
  }

  manifestList.forEach((item, index) => {
    const tr = document.createElement('tr');
    
    let orientationLabel = 'Full';
    if (item.orientation === 'upright') orientationLabel = 'Upright';
    if (item.orientation === 'none') orientationLabel = 'None';

    let dimStr = '';
    if (currentUnit === 'in') {
      dimStr = `${(item.length / 2.54).toFixed(1)} x ${(item.width / 2.54).toFixed(1)} x ${(item.height / 2.54).toFixed(1)} in`;
    } else if (currentUnit === 'mm') {
      dimStr = `${(item.length * 10).toFixed(0)} x ${(item.width * 10).toFixed(0)} x ${(item.height * 10).toFixed(0)} mm`;
    } else {
      dimStr = `${item.length} x ${item.width} x ${item.height} cm`;
    }

    let typeLabel = 'Carton';
    if (item.type === 'pallet') {
      const mat = item.material === 'plastic' ? 'Plastic Pallet' : 'Wood Pallet';
      typeLabel = item.palletCartonCalc ? `${mat} (${item.cartonsCount} cartons)` : mat;
    } else if (item.type === 'bag') {
      const matNames = {
        seeds: 'Seeds/Grains',
        sand: 'Sand/Gravel',
        powder: 'Powders/Flour',
        solid: 'Baffled/Solid',
        custom: 'Custom'
      };
      const mat = item.fillingMaterial ? (matNames[item.fillingMaterial] || item.fillingMaterial) : 'Seeds/Grains';
      const bulge = item.bulgingFactor !== undefined ? item.bulgingFactor : 15;
      typeLabel = `FIBC Bag (${mat}, +${bulge}%)`;
    } else if (item.type === 'barrel') {
      const palletNames = { us_std: 'US Pallet', eur1: 'EUR 1 Pallet', eur2: 'EUR 2 Pallet', custom: 'Custom Pallet' };
      const pName = palletNames[item.palletSizeId] || 'Pallet';
      const numB = (item.layoutRows || 1) * (item.layoutCols || 1);
      typeLabel = `Palletized Barrels (${numB} drums on ${pName})`;
    }

    tr.innerHTML = `
      <td><div class="color-badge" style="background-color: ${item.color};"></div></td>
      <td style="font-weight: 600;">
        ${item.name}
        <div style="font-size: 0.75rem; color: var(--text-muted); font-weight: normal; margin-top: 0.15rem;">
          Shape: ${typeLabel}
        </div>
      </td>
      <td>${dimStr}</td>
      <td>${item.weight} kg</td>
      <td><span class="badge-count">${item.quantity} pcs</span></td>
      <td><span style="font-size: 0.8rem; color: var(--text-secondary);">${orientationLabel}</span></td>
      <td>
        <div class="actions-cell">
          <button class="btn-icon btn-edit" data-index="${index}" title="Edit Item">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 1 1 3 3L12 15l-4 1 1-4Z"></path></svg>
          </button>
          <button class="btn-icon delete btn-delete" data-index="${index}" title="Delete Item">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
          </button>
        </div>
      </td>
    `;
    tbody.appendChild(tr);
  });

  // Bind edit & delete buttons
  document.querySelectorAll('.btn-edit').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const idx = e.currentTarget.getAttribute('data-index');
      editManifestItem(idx);
    });
  });

  document.querySelectorAll('.btn-delete').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const idx = e.currentTarget.getAttribute('data-index');
      deleteManifestItem(idx);
    });
  });
}

function renderContainersGrid() {
  const grid = document.getElementById('containers-grid');
  grid.innerHTML = '';

  predefinedContainers.forEach(c => {
    const card = document.createElement('div');
    card.className = `container-card ${selectedContainer.id === c.id ? 'selected' : ''}`;
    card.setAttribute('data-id', c.id);
    
    // Draw wireframe SVG based on container length ratio
    const svgL = c.length === 589 ? 110 : 150;
    
    let dimText = '';
    if (currentUnit === 'in') {
      dimText = `${(c.length / 2.54).toFixed(1)}x${(c.width / 2.54).toFixed(1)}x${(c.height / 2.54).toFixed(1)} in`;
    } else if (currentUnit === 'mm') {
      dimText = `${(c.length * 10).toFixed(0)}x${(c.width * 10).toFixed(0)}x${(c.height * 10).toFixed(0)} mm`;
    } else {
      dimText = `${(c.length/100).toFixed(2)}x${(c.width/100).toFixed(2)}x${(c.height/100).toFixed(2)} m`;
    }

    card.innerHTML = `
      <div class="container-icon">
        <svg class="wireframe-container-svg" style="width: ${svgL}px" viewBox="0 0 100 50">
          <!-- Back wall -->
          <rect x="5" y="10" width="70" height="30" opacity="0.3"></rect>
          <!-- Front face outline -->
          <rect x="25" y="5" width="70" height="30"></rect>
          <!-- Connecting edges -->
          <line x1="5" y1="10" x2="25" y2="5"></line>
          <line x1="75" y1="10" x2="95" y2="5"></line>
          <line x1="5" y1="40" x2="25" y2="35"></line>
          <line x1="75" y1="40" x2="95" y2="35"></line>
        </svg>
      </div>
      <div class="container-details">
        <h3>${c.name}</h3>
        <p class="text-muted" style="font-size: 0.75rem; margin-bottom: 0.5rem;">${c.desc}</p>
        <div class="container-spec-row">
          <span>Dimensions:</span>
          <span class="container-spec-val">${dimText}</span>
        </div>
        <div class="container-spec-row">
          <span>Max Payload:</span>
          <span class="container-spec-val">${c.maxWeight.toLocaleString()} kg</span>
        </div>
      </div>
    `;
    grid.appendChild(card);
    
    card.addEventListener('click', () => {
      document.querySelectorAll('.container-card').forEach(x => x.classList.remove('selected'));
      card.classList.add('selected');
      selectedContainer = c;
      calculateStuffing();
    });
  });
}

function renderLoadedList() {
  const loadedList = document.getElementById('loaded-cargo-list');
  loadedList.innerHTML = '';

  const unpackedList = document.getElementById('unpacked-cargo-list');
  unpackedList.innerHTML = '';
  
  const unpackedCard = document.getElementById('unpacked-cargo-card');

  if (!packingResults) return;

  // 1. Group loaded items by manifest item index
  const { placedBoxes, unplacedBoxes } = packingResults;
  
  manifestList.forEach((item, index) => {
    const loadedCount = placedBoxes.filter(b => b.typeIndex === index).length;
    if (loadedCount > 0) {
      const volM3 = (item.length * item.width * item.height * loadedCount) / 1000000;
      const wtKg = item.weight * loadedCount;

      let dimStr = '';
      if (currentUnit === 'in') {
        dimStr = `${(item.length / 2.54).toFixed(1)}x${(item.width / 2.54).toFixed(1)}x${(item.height / 2.54).toFixed(1)} in`;
      } else if (currentUnit === 'mm') {
        dimStr = `${(item.length * 10).toFixed(0)}x${(item.width * 10).toFixed(0)}x${(item.height * 10).toFixed(0)} mm`;
      } else {
        dimStr = `${item.length}x${item.width}x${item.height} cm`;
      }

      const volUnit = currentUnit === 'in' ? 'ft³' : 'm³';
      const volVal = currentUnit === 'in' ? volM3 * 35.3147 : volM3;

      let typeLabel = 'Carton';
      if (item.type === 'pallet') {
        const mat = item.material === 'plastic' ? 'Plastic Pallet' : 'Wood Pallet';
        typeLabel = item.palletCartonCalc ? `${mat} (${item.cartonsCount} cartons)` : mat;
      } else if (item.type === 'bag') {
        const matNames = {
          seeds: 'Seeds/Grains',
          sand: 'Sand/Gravel',
          powder: 'Powders/Flour',
          solid: 'Baffled/Solid',
          custom: 'Custom'
        };
        const mat = item.fillingMaterial ? (matNames[item.fillingMaterial] || item.fillingMaterial) : 'Seeds/Grains';
        const bulge = item.bulgingFactor !== undefined ? item.bulgingFactor : 15;
        typeLabel = `FIBC Bag (${mat}, +${bulge}%)`;
      } else if (item.type === 'barrel') {
        const palletNames = { us_std: 'US Pallet', eur1: 'EUR 1 Pallet', eur2: 'EUR 2 Pallet', custom: 'Custom Pallet' };
        const pName = palletNames[item.palletSizeId] || 'Pallet';
        const numB = (item.layoutRows || 1) * (item.layoutCols || 1);
        typeLabel = `Palletized Barrels (${numB} drums on ${pName})`;
      }

      const div = document.createElement('div');
      div.className = 'detail-item';
      div.innerHTML = `
        <div class="detail-item-left">
          <div class="color-badge" style="background-color: ${item.color};"></div>
          <div class="detail-item-info">
            <span class="detail-item-name">${item.name}</span>
            <span class="detail-item-sub">${typeLabel} • ${dimStr} • ${item.weight}kg</span>
          </div>
        </div>
        <div class="detail-item-right">
          ${loadedCount} / ${item.quantity}
          <span class="badge-count" style="font-size: 0.7rem; margin-left: 0.25rem;">${volVal.toFixed(1)} ${volUnit}</span>
        </div>
      `;
      loadedList.appendChild(div);
    }
  });

  // 2. Group unpacked leftovers
  if (unplacedBoxes.length > 0) {
    unpackedCard.style.display = 'block';
    
    manifestList.forEach((item, index) => {
      const unplacedCount = unplacedBoxes.filter(b => b.typeIndex === index).length;
      if (unplacedCount > 0) {
        let dimStr = '';
        if (currentUnit === 'in') {
          dimStr = `${(item.length / 2.54).toFixed(1)}x${(item.width / 2.54).toFixed(1)}x${(item.height / 2.54).toFixed(1)} in`;
        } else if (currentUnit === 'mm') {
          dimStr = `${(item.length * 10).toFixed(0)}x${(item.width * 10).toFixed(0)}x${(item.height * 10).toFixed(0)} mm`;
        } else {
          dimStr = `${item.length}x${item.width}x${item.height} cm`;
        }

        let typeLabel = 'Carton';
        if (item.type === 'pallet') {
          const mat = item.material === 'plastic' ? 'Plastic Pallet' : 'Wood Pallet';
          typeLabel = item.palletCartonCalc ? `${mat} (${item.cartonsCount} cartons)` : mat;
        } else if (item.type === 'bag') {
          const matNames = {
            seeds: 'Seeds/Grains',
            sand: 'Sand/Gravel',
            powder: 'Powders/Flour',
            solid: 'Baffled/Solid',
            custom: 'Custom'
          };
          const mat = item.fillingMaterial ? (matNames[item.fillingMaterial] || item.fillingMaterial) : 'Seeds/Grains';
          const bulge = item.bulgingFactor !== undefined ? item.bulgingFactor : 15;
          typeLabel = `FIBC Bag (${mat}, +${bulge}%)`;
        } else if (item.type === 'barrel') {
          const palletNames = { us_std: 'US Pallet', eur1: 'EUR 1 Pallet', eur2: 'EUR 2 Pallet', custom: 'Custom Pallet' };
          const pName = palletNames[item.palletSizeId] || 'Pallet';
          const numB = (item.layoutRows || 1) * (item.layoutCols || 1);
          typeLabel = `Palletized Barrels (${numB} drums on ${pName})`;
        }

        const div = document.createElement('div');
        div.className = 'detail-item';
        div.innerHTML = `
          <div class="detail-item-left">
            <div class="color-badge" style="background-color: ${item.color};"></div>
            <div class="detail-item-info">
              <span class="detail-item-name">${item.name}</span>
              <span class="detail-item-sub">${typeLabel} • ${dimStr}</span>
            </div>
          </div>
          <div class="detail-item-right text-danger">
            ${unplacedCount} Leftover
          </div>
        `;
        unpackedList.appendChild(div);
      }
    });
  } else {
    unpackedCard.style.display = 'none';
  }
}

// --- LOGIC ACTIONS ---

function calculateStuffing() {
  console.log("calculateStuffing triggered, manifest length =", manifestList.length, "container =", selectedContainer ? selectedContainer.name : "null");
  const spinner = document.getElementById('calc-spinner');
  const emptyState = document.getElementById('empty-visualizer');
  
  if (manifestList.length === 0) {
    emptyState.classList.remove('hidden');
    return;
  }
  
  emptyState.classList.add('hidden');
  spinner.classList.add('active');

  // Small delay to let the spinner render before blocking CPU with calculations
  setTimeout(() => {
    try {
      console.log("Starting packCargo...");
      // Calculate optimal packing
      packingResults = packCargo(selectedContainer, manifestList);
      console.log("packCargo completed. placedBoxes length =", packingResults.placedBoxes.length);
      
      const { placedBoxes, volumeUtilization, weightUtilization, totalVolume, totalWeight } = packingResults;

      // Update 3D Container render
      console.log("Rendering container wireframe...");
      renderContainer(selectedContainer);
      console.log("Rendering cargo boxes...");
      renderCargo(placedBoxes);
      console.log("3D rendering steps completed.");

      // Update stats text
      document.getElementById('overlay-container-name').textContent = selectedContainer.name;
      document.getElementById('overlay-vol-util').textContent = `${volumeUtilization.toFixed(1)}%`;
      document.getElementById('overlay-wt-util').textContent = `${weightUtilization.toFixed(1)}%`;

      document.getElementById('txt-vol-percent').textContent = `${volumeUtilization.toFixed(1)}%`;
      
      const totalVolM3 = selectedContainer.length * selectedContainer.width * selectedContainer.height / 1000000;
      const totalVolVal = currentUnit === 'in' ? totalVolM3 * 35.3147 : totalVolM3;
      const packedVolVal = currentUnit === 'in' ? (totalVolume / 1000000) * 35.3147 : (totalVolume / 1000000);
      const volUnit = currentUnit === 'in' ? 'ft³' : 'm³';

      document.getElementById('txt-vol-used').textContent = packedVolVal.toFixed(2);
      document.getElementById('txt-vol-total').textContent = totalVolVal.toFixed(2);
      document.getElementById('txt-vol-unit').textContent = volUnit;
      
      document.getElementById('txt-wt-percent').textContent = `${weightUtilization.toFixed(1)}%`;
      document.getElementById('txt-wt-used').textContent = totalWeight.toLocaleString();
      document.getElementById('txt-wt-total').textContent = selectedContainer.maxWeight.toLocaleString();

      document.getElementById('txt-total-packed-qty').textContent = placedBoxes.length;

      // Progress bars
      document.getElementById('bar-vol').style.width = `${Math.min(volumeUtilization, 100)}%`;
      document.getElementById('bar-wt').style.width = `${Math.min(weightUtilization, 100)}%`;

      // Update Step slider bounds
      const totalSteps = placedBoxes.length;
      currentStep = totalSteps;
      
      const slider = document.getElementById('step-slider');
      slider.max = totalSteps;
      slider.value = totalSteps;
      
      document.getElementById('lbl-current-step').textContent = totalSteps;
      document.getElementById('lbl-total-steps').textContent = totalSteps;
      
      // Update loaded details manifests lists
      renderLoadedList();

    } catch (err) {
      console.error("Packing calculation failed:", err.message, err.stack);
      alert("Error occurred during packing calculation: " + err.message);
    } finally {
      spinner.classList.remove('active');
    }
  }, 150);
}

function addManifestItem(name, l, w, h, wt, qty, color, orientation, type = 'carton', sizeId = null, material = null, fillingMaterial = null, bulgingFactor = null, barrelPallet = null) {
  manifestList.push({ name, length: l, width: w, height: h, weight: wt, quantity: qty, color, orientation, type, sizeId, material, fillingMaterial, bulgingFactor, ...barrelPallet });
  renderManifestTable();
  calculateStuffing();
}

function editManifestItem(index) {
  const item = manifestList[index];
  const scale = currentUnit === 'in' ? 1 / 2.54 : 1;
  const decimals = currentUnit === 'mm' ? 0 : 1;
  
  // Set type dropdown
  const typeSelect = document.getElementById('prod-type');
  typeSelect.value = item.type || 'carton';
  typeSelect.dispatchEvent(new Event('change'));

  // Set sizeId dropdown if applicable
  if (item.type && item.type !== 'carton') {
    const sizeSelect = document.getElementById('prod-predefined-size');
    sizeSelect.value = item.sizeId || 'custom';
    sizeSelect.dispatchEvent(new Event('change'));
  }

  // Set material dropdown and carton calculation settings if applicable
  if (item.type === 'pallet') {
    if (item.material) {
      document.getElementById('prod-pallet-material').value = item.material;
    }
    const calcEnable = !!item.palletCartonCalc;
    const calcEnableCheckbox = document.getElementById('prod-pallet-calc-enable');
    if (calcEnableCheckbox) {
      calcEnableCheckbox.checked = calcEnable;
      calcEnableCheckbox.dispatchEvent(new Event('change'));
      
      if (calcEnable) {
        document.getElementById('prod-pallet-carton-l').value = (item.cartonLength * scale).toFixed(decimals);
        document.getElementById('prod-pallet-carton-w').value = (item.cartonWidth * scale).toFixed(decimals);
        document.getElementById('prod-pallet-carton-h').value = (item.cartonHeight * scale).toFixed(decimals);
        document.getElementById('prod-pallet-carton-wt').value = item.cartonWeight;
        document.getElementById('prod-pallet-max-h').value = (item.maxPalletHeight * scale).toFixed(decimals);
        document.getElementById('prod-pallet-carton-orient').value = item.cartonOrientation || 'upright';
        
        // Let it recalculate
        setTimeout(updatePalletCartonCalculation, 20);
      }
    }
  }

  // Set fillingMaterial and bulgingFactor if applicable
  if (item.type === 'bag') {
    document.getElementById('prod-bag-material').value = item.fillingMaterial || 'seeds';
    document.getElementById('prod-bag-material').dispatchEvent(new Event('change'));
    document.getElementById('prod-bulging-factor').value = item.bulgingFactor !== undefined ? item.bulgingFactor : 15;
    document.getElementById('lbl-prod-bulging-factor').textContent = `${item.bulgingFactor !== undefined ? item.bulgingFactor : 15}%`;
  }

  // Set barrel pallet parameters if applicable
  if (item.type === 'barrel') {
    document.getElementById('prod-barrel-pallet-size').value = item.palletSizeId || 'us_std';
    document.getElementById('prod-barrel-pallet-material').value = item.palletMaterial || 'wood';
    document.getElementById('prod-length').value = ((item.barrelDiameter || 58.4) * scale).toFixed(decimals);
    document.getElementById('prod-width').value = ((item.barrelDiameter || 58.4) * scale).toFixed(decimals);
    document.getElementById('prod-height').value = ((item.barrelHeight || 87.6) * scale).toFixed(decimals);
    document.getElementById('prod-weight').value = item.barrelWeight || 220;
    setTimeout(updateBarrelPalletLayout, 20);
  } else {
    document.getElementById('prod-length').value = (item.length * scale).toFixed(decimals);
    document.getElementById('prod-width').value = (item.width * scale).toFixed(decimals);
    document.getElementById('prod-height').value = (item.height * scale).toFixed(decimals);
    document.getElementById('prod-weight').value = item.weight;
  }

  document.getElementById('prod-name').value = item.name;
  document.getElementById('prod-qty').value = item.quantity;
  document.getElementById('prod-color').value = item.color;
  document.getElementById('prod-orientation').value = item.orientation;

  // Remove the old item from list, and let user submit the edited form as a "new" item
  manifestList.splice(index, 1);
  renderManifestTable();
  calculateStuffing();

  // Scroll back up to form
  document.querySelector('.panel-sidebar').scrollTop = 0;
}

function deleteManifestItem(index) {
  if (confirm(`Remove "${manifestList[index].name}" from manifest?`)) {
    manifestList.splice(index, 1);
    renderManifestTable();
    calculateStuffing();
  }
}

// --- EVENT BINDING ---

function bindEventListeners() {
  // 1. Tab Navigation
  const tabButtons = document.querySelectorAll('.tab-btn');
  const tabPanels = document.querySelectorAll('.tab-panel');

  tabButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      const targetPanelId = btn.getAttribute('data-tab');

      tabButtons.forEach(b => b.classList.remove('active'));
      tabPanels.forEach(p => p.classList.remove('active'));

      btn.classList.add('active');
      const panel = document.getElementById(targetPanelId);
      panel.classList.add('active');

      // Trigger scene resize when Result tab becomes visible
      if (targetPanelId === 'tab-result') {
        setTimeout(() => {
          window.dispatchEvent(new Event('resize'));
          resetCameraPosition();
        }, 100);
      }
    });
  });

  // Dynamic Form Behaviors & Predefined Sizes configuration
  const typeSelect = document.getElementById('prod-type');
  const sizeSelect = document.getElementById('prod-predefined-size');
  const lengthInput = document.getElementById('prod-length');
  const widthInput = document.getElementById('prod-width');
  const orientationSelect = document.getElementById('prod-orientation');
  
  const predefinedSizes = {
    pallet: [
      { id: 'eur1', name: 'Euro EUR 1 (120x80 cm)', l: 120, w: 80 },
      { id: 'eur2', name: 'Euro EUR 2 (120x100 cm)', l: 120, w: 100 },
      { id: 'eur3', name: 'Euro EUR 3 (100x120 cm)', l: 100, w: 120 },
      { id: 'eur6', name: 'Euro EUR 6 (80x60 cm)', l: 80, w: 60 },
      { id: 'us_std', name: 'US Standard (121.9x101.6 cm)', l: 121.9, w: 101.6 },
      { id: 'industrial', name: 'Industrial (120x100 cm)', l: 120, w: 100 },
      { id: 'custom', name: 'Custom Pallet Size', l: 120, w: 80 }
    ],
    bag: [
      { id: 'fibc_std', name: 'Standard FIBC (110x90 cm)', l: 110, w: 90 },
      { id: 'fibc_large', name: 'Large FIBC (100x100 cm)', l: 100, w: 100 },
      { id: 'fibc_slim', name: 'Slim FIBC (90x90 cm)', l: 90, w: 90 },
      { id: 'custom', name: 'Custom Bag Size', l: 90, w: 90 }
    ],
    barrel: [
      { id: 'drum_55g', name: '55-Gallon Drum (Dia: 58.4 cm)', l: 58.4, w: 58.4 },
      { id: 'drum_30g', name: '30-Gallon Drum (Dia: 46 cm)', l: 46, w: 46 },
      { id: 'custom', name: 'Custom Drum Size', l: 58.4, w: 58.4 }
    ]
  };

  typeSelect.addEventListener('change', () => {
    const type = typeSelect.value;
    
    // Reset inputs read-only state and enabled states
    lengthInput.removeAttribute('readonly');
    widthInput.removeAttribute('readonly');
    document.getElementById('prod-height').removeAttribute('readonly');
    document.getElementById('prod-weight').removeAttribute('readonly');
    orientationSelect.disabled = false;
    
    if (type === 'carton') {
      document.getElementById('group-prod-predefined').style.display = 'none';
      document.getElementById('group-prod-material').style.display = 'none';
      document.getElementById('group-prod-bag-material').style.display = 'none';
      document.getElementById('group-prod-bulging-factor').style.display = 'none';
      document.getElementById('group-prod-barrel-pallet-size').style.display = 'none';
      document.getElementById('group-prod-barrel-pallet-material').style.display = 'none';
      document.getElementById('group-prod-barrel-layout').style.display = 'none';
      document.getElementById('group-prod-pallet-calc').style.display = 'none';
      document.getElementById('group-prod-width').style.display = 'block';
      document.getElementById('lbl-prod-length').textContent = `Length (${currentUnit})`;
    } else {
      document.getElementById('group-prod-predefined').style.display = 'block';
      
      // Populate size options
      sizeSelect.innerHTML = '';
      const sizes = predefinedSizes[type] || [];
      sizes.forEach(s => {
        const opt = document.createElement('option');
        opt.value = s.id;
        opt.textContent = s.name;
        sizeSelect.appendChild(opt);
      });
      
      if (type === 'pallet') {
        document.getElementById('group-prod-material').style.display = 'block';
        document.getElementById('group-prod-bag-material').style.display = 'none';
        document.getElementById('group-prod-bulging-factor').style.display = 'none';
        document.getElementById('group-prod-barrel-pallet-size').style.display = 'none';
        document.getElementById('group-prod-barrel-pallet-material').style.display = 'none';
        document.getElementById('group-prod-barrel-layout').style.display = 'none';
        document.getElementById('group-prod-pallet-calc').style.display = 'block';
        document.getElementById('group-prod-width').style.display = 'block';
        document.getElementById('lbl-prod-length').textContent = `Length (${currentUnit})`;
        
        // Run pallet calculator setup
        setTimeout(updatePalletCartonCalculation, 15);
      } else if (type === 'bag') {
        document.getElementById('group-prod-material').style.display = 'none';
        document.getElementById('group-prod-bag-material').style.display = 'block';
        document.getElementById('group-prod-bulging-factor').style.display = 'block';
        document.getElementById('group-prod-barrel-pallet-size').style.display = 'none';
        document.getElementById('group-prod-barrel-pallet-material').style.display = 'none';
        document.getElementById('group-prod-barrel-layout').style.display = 'none';
        document.getElementById('group-prod-pallet-calc').style.display = 'none';
        document.getElementById('group-prod-width').style.display = 'block';
        document.getElementById('lbl-prod-length').textContent = `Length (${currentUnit})`;
        
        // Lock orientation to upright
        orientationSelect.value = 'upright';
        orientationSelect.disabled = true;
      } else if (type === 'barrel') {
        document.getElementById('group-prod-material').style.display = 'none';
        document.getElementById('group-prod-bag-material').style.display = 'none';
        document.getElementById('group-prod-bulging-factor').style.display = 'none';
        document.getElementById('group-prod-barrel-pallet-size').style.display = 'block';
        document.getElementById('group-prod-barrel-pallet-material').style.display = 'block';
        document.getElementById('group-prod-barrel-layout').style.display = 'block';
        document.getElementById('group-prod-pallet-calc').style.display = 'none';
        document.getElementById('group-prod-width').style.display = 'none';
        document.getElementById('lbl-prod-length').textContent = `Diameter (${currentUnit})`;
        
        // Lock orientation to upright
        orientationSelect.value = 'upright';
        orientationSelect.disabled = true;
      }
      
      // Trigger size change to populate initial size
      sizeSelect.dispatchEvent(new Event('change'));
    }
  });

  sizeSelect.addEventListener('change', () => {
    const type = typeSelect.value;
    const sizeId = sizeSelect.value;
    
    if (sizeId === 'custom') {
      lengthInput.removeAttribute('readonly');
      if (type !== 'barrel') {
        widthInput.removeAttribute('readonly');
      }
      return;
    }
    
    const sizes = predefinedSizes[type];
    if (!sizes) return;
    const size = sizes.find(s => s.id === sizeId);
    if (!size) return;
    
    let scale = 1;
    if (currentUnit === 'in') scale = 1 / 2.54;
    else if (currentUnit === 'mm') scale = 10;
    
    const decimals = currentUnit === 'mm' ? 0 : 1;
    lengthInput.value = (size.l * scale).toFixed(decimals);
    widthInput.value = (size.w * scale).toFixed(decimals);
    
    lengthInput.setAttribute('readonly', 'true');
    widthInput.setAttribute('readonly', 'true');
  });

  // Barrel Diameter sync
  lengthInput.addEventListener('input', () => {
    if (typeSelect.value === 'barrel') {
      widthInput.value = lengthInput.value;
    }
  });

  // 2. Add Cargo Item Form Submission
  const form = document.getElementById('product-form');
  form.addEventListener('submit', (e) => {
    e.preventDefault();

    const name = document.getElementById('prod-name').value;
    const l = parseFloat(document.getElementById('prod-length').value);
    const w = parseFloat(document.getElementById('prod-width').value);
    const h = parseFloat(document.getElementById('prod-height').value);
    const wt = parseFloat(document.getElementById('prod-weight').value);
    const qty = parseInt(document.getElementById('prod-qty').value);
    const color = document.getElementById('prod-color').value;
    const orientation = document.getElementById('prod-orientation').value;
    const type = typeSelect.value;
    const sizeId = type !== 'carton' ? sizeSelect.value : null;
    const material = type === 'pallet' ? document.getElementById('prod-pallet-material').value : null;
    const fillingMaterial = type === 'bag' ? document.getElementById('prod-bag-material').value : null;
    const bulgingFactor = type === 'bag' ? parseFloat(document.getElementById('prod-bulging-factor').value) : null;

    let factor = 1;
    if (currentUnit === 'in') factor = 2.54;
    else if (currentUnit === 'mm') factor = 0.1;

    let barrelPallet = null;
    let l_eff = l * factor;
    let w_eff = w * factor;
    let h_eff = h * factor;
    let wt_eff = wt;

    if (type === 'barrel') {
      const palletSizeSelect = document.getElementById('prod-barrel-pallet-size');
      const palletMaterialSelect = document.getElementById('prod-barrel-pallet-material');

      const diaCm = l * factor;
      const hCm = h * factor;

      const pSizeId = palletSizeSelect.value;
      let pL = 121.9;
      let pW = 101.6;
      if (pSizeId === 'eur1') {
        pL = 120;
        pW = 80;
      } else if (pSizeId === 'eur2') {
        pL = 120;
        pW = 100;
      }

      let rows = 1;
      let cols = 1;
      const tolerance = 18;
      if (2 * diaCm <= pL + tolerance && 2 * diaCm <= pW + tolerance) {
        rows = 2;
        cols = 2;
      } else if (2 * diaCm <= pL + tolerance) {
        rows = 2;
        cols = 1;
      } else if (2 * diaCm <= pW + tolerance) {
        rows = 1;
        cols = 2;
      }

      const palletTare = palletMaterialSelect.value === 'plastic' ? 15 : 30;

      barrelPallet = {
        palletSizeId: pSizeId,
        palletMaterial: palletMaterialSelect.value,
        layoutRows: rows,
        layoutCols: cols,
        palletLength: pL,
        palletWidth: pW,
        barrelDiameter: diaCm,
        barrelHeight: hCm,
        barrelWeight: wt
      };

      l_eff = Math.max(pL, rows * diaCm);
      w_eff = Math.max(pW, cols * diaCm);
      h_eff = hCm + 14.4;
      wt_eff = (rows * cols * wt) + palletTare;
    } else if (type === 'pallet' && document.getElementById('prod-pallet-calc-enable').checked) {
      const cL = parseFloat(document.getElementById('prod-pallet-carton-l').value) * factor;
      const cW = parseFloat(document.getElementById('prod-pallet-carton-w').value) * factor;
      const cH = parseFloat(document.getElementById('prod-pallet-carton-h').value) * factor;
      const cWt = parseFloat(document.getElementById('prod-pallet-carton-wt').value);
      const maxH = parseFloat(document.getElementById('prod-pallet-max-h').value) * factor;
      const cOrient = document.getElementById('prod-pallet-carton-orient').value;

      const result = runCartonPalletCalculationMath(l_eff, w_eff, cL, cW, cH, maxH, cOrient);
      
      barrelPallet = {
        palletCartonCalc: true,
        cartonLength: cL,
        cartonWidth: cW,
        cartonHeight: cH,
        cartonWeight: cWt,
        maxPalletHeight: maxH,
        cartonOrientation: cOrient,
        cartonsCount: result.totalCartons,
        cartonLayers: result.layers,
        cartonsPerLayer: result.countPerLayer,
        cartonPositions: result.positions
      };
    }

    addManifestItem(name, l_eff, w_eff, h_eff, wt_eff, qty, color, orientation, type, sizeId, material, fillingMaterial, bulgingFactor, barrelPallet);
    
    // Clear name, but keep numbers for faster additions
    document.getElementById('prod-name').value = 'Cargo Box ' + (manifestList.length + 1);
  });

  // 3. Preset Cargo Clicks
  const presets = {
    carton_std: { type: 'carton', name: 'Standard Carton Box', l: 60, w: 40, h: 40, wt: 15, qty: 50, color: '#38bdf8', orient: 'any' },
    carton_small: { type: 'carton', name: 'Small Parcel Box', l: 30, w: 20, h: 20, wt: 3, qty: 100, color: '#0ea5e9', orient: 'any' },
    pallet_eur1: { type: 'pallet', sizeId: 'eur1', material: 'wood', name: 'Euro EUR 1 Wood Pallet', l: 120, w: 80, h: 160, wt: 400, qty: 12, color: '#b58a63', orient: 'upright' },
    pallet_eur2: { type: 'pallet', sizeId: 'eur2', material: 'wood', name: 'Euro EUR 2 Wood Pallet', l: 120, w: 100, h: 160, wt: 500, qty: 10, color: '#8d6e63', orient: 'upright' },
    pallet_us_plastic: { type: 'pallet', sizeId: 'us_std', material: 'plastic', name: 'US Std Plastic Pallet', l: 121.9, w: 101.6, h: 160, wt: 600, qty: 10, color: '#0284c7', orient: 'upright' },
    bag_fibc: { type: 'bag', sizeId: 'fibc_std', name: 'Standard FIBC 1-Ton Bag', l: 110, w: 90, h: 90, wt: 1000, qty: 16, color: '#cbd5e1', orient: 'upright', fillingMaterial: 'seeds', bulgingFactor: 15 },
    bag_fibc_large: { type: 'bag', sizeId: 'fibc_large', name: 'Large FIBC 1.2-Ton Bag', l: 100, w: 100, h: 120, wt: 1200, qty: 12, color: '#94a3b8', orient: 'upright', fillingMaterial: 'seeds', bulgingFactor: 15 },
    drum_55g: { type: 'barrel', sizeId: 'drum_55g', name: '55-Gal Oil Barrel Palletized', l: 58.4, w: 58.4, h: 87.6, wt: 220, qty: 8, color: '#1e293b', orient: 'upright', palletSizeId: 'us_std', palletMaterial: 'wood' },
    drum_30g: { type: 'barrel', sizeId: 'drum_30g', name: '30-Gal Drum Palletized', l: 46, w: 46, h: 74, wt: 110, qty: 12, color: '#475569', orient: 'upright', palletSizeId: 'us_std', palletMaterial: 'wood' }
  };

  document.querySelectorAll('.btn-preset').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const presetKey = btn.getAttribute('data-preset');
      const p = presets[presetKey];
      if (!p) return;
      
      // Update cargo type select
      const tSelect = document.getElementById('prod-type');
      tSelect.value = p.type;
      tSelect.dispatchEvent(new Event('change'));

      // Update predefined size select if applicable
      const sSelect = document.getElementById('prod-predefined-size');
      if (p.sizeId) {
        sSelect.value = p.sizeId;
        sSelect.dispatchEvent(new Event('change'));
      } else {
        sSelect.value = 'custom';
        sSelect.dispatchEvent(new Event('change'));
      }

      // Update material if applicable
      if (p.type === 'pallet' && p.material) {
        document.getElementById('prod-pallet-material').value = p.material;
      }

      // Update fillingMaterial and bulgingFactor if applicable
      if (p.type === 'bag') {
        document.getElementById('prod-bag-material').value = p.fillingMaterial || 'seeds';
        document.getElementById('prod-bag-material').dispatchEvent(new Event('change'));
        document.getElementById('prod-bulging-factor').value = p.bulgingFactor !== undefined ? p.bulgingFactor : 15;
        document.getElementById('lbl-prod-bulging-factor').textContent = `${p.bulgingFactor !== undefined ? p.bulgingFactor : 15}%`;
      }

      // Update barrel pallet fields if applicable
      if (p.type === 'barrel') {
        document.getElementById('prod-barrel-pallet-size').value = p.palletSizeId || 'us_std';
        document.getElementById('prod-barrel-pallet-material').value = p.palletMaterial || 'wood';
      }

      let scale = 1;
      if (currentUnit === 'in') scale = 1 / 2.54;
      else if (currentUnit === 'mm') scale = 10;
      
      document.getElementById('prod-name').value = p.name;
      const decimals = currentUnit === 'mm' ? 0 : 1;
      document.getElementById('prod-length').value = (p.l * scale).toFixed(decimals);
      document.getElementById('prod-width').value = (p.w * scale).toFixed(decimals);
      document.getElementById('prod-height').value = (p.h * scale).toFixed(decimals);
      document.getElementById('prod-weight').value = p.wt;
      document.getElementById('prod-qty').value = p.qty;
      document.getElementById('prod-color').value = p.color;
      document.getElementById('prod-orientation').value = p.orient;
    });
  });

  // 4. Custom Container Form
  const customContainerForm = document.getElementById('custom-container-form');
  customContainerForm.addEventListener('submit', (e) => {
    e.preventDefault();
    
    const name = document.getElementById('cc-name').value;
    const l = parseFloat(document.getElementById('cc-length').value);
    const w = parseFloat(document.getElementById('cc-width').value);
    const h = parseFloat(document.getElementById('cc-height').value);
    const wt = parseFloat(document.getElementById('cc-payload').value);

    // Remove previous custom containers if any
    const existingIdx = predefinedContainers.findIndex(c => c.id === 'custom');
    if (existingIdx !== -1) {
      predefinedContainers.splice(existingIdx, 1);
    }

    let factor = 1;
    if (currentUnit === 'in') factor = 2.54;
    else if (currentUnit === 'mm') factor = 0.1;
    const newContainer = { id: 'custom', name, length: l * factor, width: w * factor, height: h * factor, maxWeight: wt, desc: "User-defined custom vehicle" };
    predefinedContainers.push(newContainer);
    selectedContainer = newContainer;

    // Redraw and recalculate
    renderContainersGrid();
    calculateStuffing();

    // Switch tab to visualizer results to see custom vehicle
    document.getElementById('tab-result-btn').click();
  });

  // 5. Manifest Actions Header Buttons
  document.getElementById('btn-clear-manifest').addEventListener('click', () => {
    if (confirm("Are you sure you want to delete ALL cargo items from the manifest?")) {
      manifestList = [];
      renderManifestTable();
      calculateStuffing();
    }
  });

  document.getElementById('btn-recalculate').addEventListener('click', () => {
    calculateStuffing();
  });

  document.getElementById('btn-export-pdf').addEventListener('click', () => {
    if (!packingResults || packingResults.placedBoxes.length === 0) {
      alert("No stuffing results available to export. Please add cargo items and calculate first.");
      return;
    }

    const { placedBoxes, volumeUtilization, weightUtilization, totalVolume, totalWeight, unplacedBoxes } = packingResults;
    
    const totalVolM3 = selectedContainer.length * selectedContainer.width * selectedContainer.height / 1000000;
    const totalVolVal = currentUnit === 'in' ? totalVolM3 * 35.3147 : totalVolM3;
    const packedVolVal = currentUnit === 'in' ? (totalVolume / 1000000) * 35.3147 : (totalVolume / 1000000);
    const volUnit = currentUnit === 'in' ? 'ft³' : 'm³';

    const stats = {
      volPercent: volumeUtilization.toFixed(1),
      wtPercent: weightUtilization.toFixed(1),
      volUsed: packedVolVal,
      volTotal: totalVolVal,
      volUnit: volUnit,
      wtUsed: totalWeight,
      wtTotal: selectedContainer.maxWeight,
      totalQty: placedBoxes.length
    };

    exportStuffingReport(
      selectedContainer, 
      placedBoxes, 
      manifestList, 
      currentUnit, 
      stats, 
      unplacedBoxes ? unplacedBoxes.length : 0
    );
  });

  // 6. Visualizer Slider Event
  const slider = document.getElementById('step-slider');
  slider.addEventListener('input', (e) => {
    const val = parseInt(e.target.value);
    currentStep = val;
    document.getElementById('lbl-current-step').textContent = val;
    
    if (packingResults) {
      renderCargo(packingResults.placedBoxes, val);
    }
  });

  // 7. Step controls buttons
  document.getElementById('btn-step-prev').addEventListener('click', () => {
    pauseAnimation();
    if (currentStep > 0) {
      currentStep--;
      slider.value = currentStep;
      document.getElementById('lbl-current-step').textContent = currentStep;
      renderCargo(packingResults.placedBoxes, currentStep);
    }
  });

  document.getElementById('btn-step-next').addEventListener('click', () => {
    pauseAnimation();
    if (packingResults && currentStep < packingResults.placedBoxes.length) {
      currentStep++;
      slider.value = currentStep;
      document.getElementById('lbl-current-step').textContent = currentStep;
      renderCargo(packingResults.placedBoxes, currentStep);
    }
  });

  document.getElementById('btn-step-play').addEventListener('click', () => {
    if (isPlaying) {
      pauseAnimation();
    } else {
      playAnimation();
    }
  });

  document.getElementById('btn-reset-view').addEventListener('click', () => {
    resetCameraPosition();
  });

  document.getElementById('btn-view-iso').addEventListener('click', () => {
    setCameraAngle('isometric');
  });

  document.getElementById('btn-view-top').addEventListener('click', () => {
    setCameraAngle('top');
  });

  document.getElementById('btn-view-side').addEventListener('click', () => {
    setCameraAngle('side');
  });

  // 8. Unit toggles
  const btnCm = document.getElementById('btn-unit-cm');
  const btnIn = document.getElementById('btn-unit-in');
  const btnMm = document.getElementById('btn-unit-mm');
  if (btnCm) btnCm.addEventListener('click', () => setUnit('cm'));
  if (btnIn) btnIn.addEventListener('click', () => setUnit('in'));
  if (btnMm) btnMm.addEventListener('click', () => setUnit('mm'));

  // Bag material and bulging factor inputs event listeners
  const bagMaterialSelect = document.getElementById('prod-bag-material');
  const bulgingFactorInput = document.getElementById('prod-bulging-factor');
  const bulgingFactorLabel = document.getElementById('lbl-prod-bulging-factor');

  if (bagMaterialSelect && bulgingFactorInput && bulgingFactorLabel) {
    bagMaterialSelect.addEventListener('change', () => {
      const val = bagMaterialSelect.value;
      if (val === 'seeds') {
        bulgingFactorInput.value = 15;
      } else if (val === 'sand') {
        bulgingFactorInput.value = 5;
      } else if (val === 'powder') {
        bulgingFactorInput.value = 8;
      } else if (val === 'solid') {
        bulgingFactorInput.value = 0;
      }
      bulgingFactorLabel.textContent = `${bulgingFactorInput.value}%`;
      updateBagEffectiveDimensions();
    });

    bulgingFactorInput.addEventListener('input', () => {
      bulgingFactorLabel.textContent = `${bulgingFactorInput.value}%`;
      if (bagMaterialSelect.value !== 'custom') {
        const currentVal = parseInt(bulgingFactorInput.value);
        if (currentVal === 15) bagMaterialSelect.value = 'seeds';
        else if (currentVal === 5) bagMaterialSelect.value = 'sand';
        else if (currentVal === 8) bagMaterialSelect.value = 'powder';
        else if (currentVal === 0) bagMaterialSelect.value = 'solid';
        else bagMaterialSelect.value = 'custom';
      }
      updateBagEffectiveDimensions();
    });

    // Re-run helper dimensions on input changes
    const lengthInput = document.getElementById('prod-length');
    const widthInput = document.getElementById('prod-width');
    const heightInput = document.getElementById('prod-height');
    const sizeSelect = document.getElementById('prod-predefined-size');
    const typeSelect = document.getElementById('prod-type');

    if (lengthInput) lengthInput.addEventListener('input', updateBagEffectiveDimensions);
    if (widthInput) widthInput.addEventListener('input', updateBagEffectiveDimensions);
    if (heightInput) heightInput.addEventListener('input', updateBagEffectiveDimensions);
    if (sizeSelect) {
      sizeSelect.addEventListener('change', () => {
        setTimeout(updateBagEffectiveDimensions, 10);
      });
    }
    if (typeSelect) {
      typeSelect.addEventListener('change', () => {
        setTimeout(updateBagEffectiveDimensions, 10);
      });
    }
  }

  // Barrel pallet inputs event listeners
  const palletSizeSelect = document.getElementById('prod-barrel-pallet-size');
  const palletMaterialSelect = document.getElementById('prod-barrel-pallet-material');

  if (palletSizeSelect && palletMaterialSelect) {
    palletSizeSelect.addEventListener('change', updateBarrelPalletLayout);
    palletMaterialSelect.addEventListener('change', updateBarrelPalletLayout);

    const lengthInput = document.getElementById('prod-length');
    const heightInput = document.getElementById('prod-height');
    const weightInput = document.getElementById('prod-weight');
    const typeSelect = document.getElementById('prod-type');

    if (lengthInput) lengthInput.addEventListener('input', updateBarrelPalletLayout);
    if (heightInput) heightInput.addEventListener('input', updateBarrelPalletLayout);
    if (weightInput) weightInput.addEventListener('input', updateBarrelPalletLayout);
    if (typeSelect) {
      typeSelect.addEventListener('change', () => {
        setTimeout(updateBarrelPalletLayout, 10);
      });
    }
  }

  // Carton palletizing inputs event listeners
  const calcEnableCheckbox = document.getElementById('prod-pallet-calc-enable');
  if (calcEnableCheckbox) {
    calcEnableCheckbox.addEventListener('change', updatePalletCartonCalculation);
    
    const cartonL = document.getElementById('prod-pallet-carton-l');
    const cartonW = document.getElementById('prod-pallet-carton-w');
    const cartonH = document.getElementById('prod-pallet-carton-h');
    const cartonWt = document.getElementById('prod-pallet-carton-wt');
    const maxH = document.getElementById('prod-pallet-max-h');
    const cartonOrient = document.getElementById('prod-pallet-carton-orient');
    
    if (cartonL) cartonL.addEventListener('input', updatePalletCartonCalculation);
    if (cartonW) cartonW.addEventListener('input', updatePalletCartonCalculation);
    if (cartonH) cartonH.addEventListener('input', updatePalletCartonCalculation);
    if (cartonWt) cartonWt.addEventListener('input', updatePalletCartonCalculation);
    if (maxH) maxH.addEventListener('input', updatePalletCartonCalculation);
    if (cartonOrient) cartonOrient.addEventListener('change', updatePalletCartonCalculation);
    
    // Re-run calculation when pallet dimensions or material changes
    const palletLengthInput = document.getElementById('prod-length');
    const palletWidthInput = document.getElementById('prod-width');
    const palletMaterial = document.getElementById('prod-pallet-material');
    const palletSizeSelect = document.getElementById('prod-predefined-size');
    
    if (palletLengthInput) palletLengthInput.addEventListener('input', updatePalletCartonCalculation);
    if (palletWidthInput) palletWidthInput.addEventListener('input', updatePalletCartonCalculation);
    if (palletMaterial) palletMaterial.addEventListener('change', updatePalletCartonCalculation);
    if (palletSizeSelect) {
      palletSizeSelect.addEventListener('change', () => {
        setTimeout(updatePalletCartonCalculation, 15);
      });
    }
  }

}

function setUnit(newUnit) {
  if (newUnit === currentUnit) return;
  
  const oldUnit = currentUnit;
  currentUnit = newUnit;

  // Toggle active class on UI buttons
  const btnCm = document.getElementById('btn-unit-cm');
  const btnIn = document.getElementById('btn-unit-in');
  const btnMm = document.getElementById('btn-unit-mm');
  if (btnCm) btnCm.classList.toggle('active', currentUnit === 'cm');
  if (btnIn) btnIn.classList.toggle('active', currentUnit === 'in');
  if (btnMm) btnMm.classList.toggle('active', currentUnit === 'mm');

  // Convert old value to cm (base unit)
  let factorToCm = 1;
  if (oldUnit === 'in') factorToCm = 2.54;
  else if (oldUnit === 'mm') factorToCm = 0.1;

  // Convert cm to new unit
  let factorFromCm = 1;
  if (newUnit === 'in') factorFromCm = 1 / 2.54;
  else if (newUnit === 'mm') factorFromCm = 10;

  const factor = factorToCm * factorFromCm;

  // Helper to convert inputs
  const convertInputVal = (id) => {
    const el = document.getElementById(id);
    if (el && el.value) {
      const val = parseFloat(el.value);
      if (!isNaN(val)) {
        const decimals = newUnit === 'mm' ? 0 : 1;
        el.value = (val * factor).toFixed(decimals);
      }
    }
  };

  // Convert active form fields
  convertInputVal('prod-length');
  convertInputVal('prod-width');
  convertInputVal('prod-height');
  convertInputVal('cc-length');
  convertInputVal('cc-width');
  convertInputVal('cc-height');

  // Update labels in form and tables
  const unitLabel = currentUnit;
  const isB = document.getElementById('prod-type').value === 'barrel';
  document.getElementById('lbl-prod-length').textContent = isB ? `Diameter (${unitLabel})` : `Length (${unitLabel})`;
  document.getElementById('lbl-prod-width').textContent = `Width (${unitLabel})`;
  document.getElementById('lbl-prod-height').textContent = `Height (${unitLabel})`;
  document.getElementById('lbl-cc-length').textContent = `Length (${unitLabel})`;
  document.getElementById('lbl-cc-width').textContent = `Width (${unitLabel})`;
  document.getElementById('lbl-cc-height').textContent = `Height (${unitLabel})`;
  document.getElementById('th-manifest-dim').textContent = `Dimensions (${unitLabel})`;

  // Re-render components with the new unit representation
  renderContainersGrid();
  renderManifestTable();
  calculateStuffing();
  if (typeof updateBagEffectiveDimensions === 'function') {
    updateBagEffectiveDimensions();
  }
  if (typeof updateBarrelPalletLayout === 'function') {
    updateBarrelPalletLayout();
  }
}

function playAnimation() {
  if (!packingResults || packingResults.placedBoxes.length === 0) return;
  
  isPlaying = true;
  const playBtn = document.getElementById('btn-step-play');
  playBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="6" y="4" width="4" height="16"></rect><rect x="14" y="4" width="4" height="16"></rect></svg>';
  
  // If slider is at the end, restart from 0
  const total = packingResults.placedBoxes.length;
  if (currentStep >= total) {
    currentStep = 0;
  }
  
  const slider = document.getElementById('step-slider');
  
  playInterval = setInterval(() => {
    if (currentStep < total) {
      currentStep++;
      slider.value = currentStep;
      document.getElementById('lbl-current-step').textContent = currentStep;
      renderCargo(packingResults.placedBoxes, currentStep);
    } else {
      pauseAnimation();
    }
  }, 150); // Loading step changes speed
}

function pauseAnimation() {
  isPlaying = false;
  const playBtn = document.getElementById('btn-step-play');
  playBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>';
  
  if (playInterval) {
    clearInterval(playInterval);
    playInterval = null;
  }
}

function updateBagEffectiveDimensions() {
  const typeSelect = document.getElementById('prod-type');
  if (!typeSelect || typeSelect.value !== 'bag') return;

  const lengthInput = document.getElementById('prod-length');
  const widthInput = document.getElementById('prod-width');
  const heightInput = document.getElementById('prod-height');
  const bulgingFactorInput = document.getElementById('prod-bulging-factor');
  const bagEffDimMsg = document.getElementById('bag-eff-dim-msg');

  if (!lengthInput || !widthInput || !heightInput || !bulgingFactorInput || !bagEffDimMsg) return;

  const l = parseFloat(lengthInput.value) || 0;
  const w = parseFloat(widthInput.value) || 0;
  const h = parseFloat(heightInput.value) || 0;
  const bulge = parseFloat(bulgingFactorInput.value) || 0;

  const effL = l * (1 + bulge / 100);
  const effW = w * (1 + bulge / 100);
  const effH = h * (1 - (bulge * 0.3) / 100);

  const decimals = currentUnit === 'mm' ? 0 : 1;
  bagEffDimMsg.innerHTML = `Effective Bounding Footprint:<br><strong>${effL.toFixed(decimals)} x ${effW.toFixed(decimals)} x ${effH.toFixed(decimals)} ${currentUnit}</strong> (Nominal: ${l.toFixed(decimals)}x${w.toFixed(decimals)}x${h.toFixed(decimals)})`;
}

function updateBarrelPalletLayout() {
  const typeSelect = document.getElementById('prod-type');
  if (!typeSelect || typeSelect.value !== 'barrel') return;

  const diameterInput = document.getElementById('prod-length');
  const heightInput = document.getElementById('prod-height');
  const weightInput = document.getElementById('prod-weight');
  const palletSizeSelect = document.getElementById('prod-barrel-pallet-size');
  const palletMaterialSelect = document.getElementById('prod-barrel-pallet-material');
  const barrelLayoutMsg = document.getElementById('barrel-layout-msg');

  if (!diameterInput || !heightInput || !weightInput || !palletSizeSelect || !palletMaterialSelect || !barrelLayoutMsg) return;

  let scaleToCm = 1;
  if (currentUnit === 'in') scaleToCm = 2.54;
  else if (currentUnit === 'mm') scaleToCm = 0.1;

  const diaCm = (parseFloat(diameterInput.value) || 0) * scaleToCm;
  const hCm = (parseFloat(heightInput.value) || 0) * scaleToCm;
  const unitWt = parseFloat(weightInput.value) || 0;

  const palletSizeId = palletSizeSelect.value;
  let pL = 121.9;
  let pW = 101.6;

  if (palletSizeId === 'eur1') {
    pL = 120;
    pW = 80;
  } else if (palletSizeId === 'eur2') {
    pL = 120;
    pW = 100;
  }

  let rows = 1;
  let cols = 1;
  const tolerance = 18;

  if (diaCm > 0) {
    if (2 * diaCm <= pL + tolerance && 2 * diaCm <= pW + tolerance) {
      rows = 2;
      cols = 2;
    } else if (2 * diaCm <= pL + tolerance) {
      rows = 2;
      cols = 1;
    } else if (2 * diaCm <= pW + tolerance) {
      rows = 1;
      cols = 2;
    }
  }

  const numBarrels = rows * cols;
  const palletTare = palletMaterialSelect.value === 'plastic' ? 15 : 30;
  const totalWt = (numBarrels * unitWt) + palletTare;

  const effL = Math.max(pL, rows * diaCm) / scaleToCm;
  const effW = Math.max(pW, cols * diaCm) / scaleToCm;
  const effH = (hCm + 14.4) / scaleToCm;

  const decimals = currentUnit === 'mm' ? 0 : 1;
  barrelLayoutMsg.innerHTML = `
    Pallet Layout: <strong>${numBarrels} Barrels (${rows}x${cols} Grid)</strong><br>
    Effective Unit Size: <strong>${effL.toFixed(decimals)} x ${effW.toFixed(decimals)} x ${effH.toFixed(decimals)} ${currentUnit}</strong><br>
    Combined Unit Weight: <strong>${totalWt.toLocaleString()} kg</strong> (incl. ${palletTare}kg pallet tare)
  `;
}

// --- CARTON PALLETIZING MATH AND UI HANDLERS ---

export function pack2D(palletL, palletW, boxL, boxW) {
  let bestCount = 0;
  let bestPositions = [];

  if (boxL <= 0 || boxW <= 0 || palletL <= 0 || palletW <= 0) {
    return { count: 0, positions: [] };
  }

  // 1. All Aligned orientation A (boxL parallel to palletL)
  {
    const cols = Math.floor(palletL / boxL);
    const rows = Math.floor(palletW / boxW);
    const count = cols * rows;
    if (count > bestCount) {
      bestCount = count;
      bestPositions = [];
      for (let c = 0; c < cols; c++) {
        for (let r = 0; r < rows; r++) {
          bestPositions.push({ x: c * boxL, y: r * boxW, l: boxL, w: boxW });
        }
      }
    }
  }

  // 2. All Aligned orientation B (boxL parallel to palletW)
  {
    const cols = Math.floor(palletL / boxW);
    const rows = Math.floor(palletW / boxL);
    const count = cols * rows;
    if (count > bestCount) {
      bestCount = count;
      bestPositions = [];
      for (let c = 0; c < cols; c++) {
        for (let r = 0; r < rows; r++) {
          bestPositions.push({ x: c * boxW, y: r * boxL, l: boxW, w: boxL });
        }
      }
    }
  }

  // 3. Vertical Split (split along pallet length)
  const maxColsL = Math.floor(palletL / boxL);
  for (let x = 1; x < maxColsL; x++) {
    const w1 = boxW;
    const l1 = boxL;
    const cols1 = x;
    const rows1 = Math.floor(palletW / w1);
    
    const remL = palletL - x * l1;
    const w2 = boxL;
    const l2 = boxW;
    const cols2 = Math.floor(remL / l2);
    const rows2 = Math.floor(palletW / w2);

    const count = (cols1 * rows1) + (cols2 * rows2);
    if (count > bestCount) {
      bestCount = count;
      bestPositions = [];
      for (let c = 0; c < cols1; c++) {
        for (let r = 0; r < rows1; r++) {
          bestPositions.push({ x: c * l1, y: r * w1, l: l1, w: w1 });
        }
      }
      const startX = x * l1;
      for (let c = 0; c < cols2; c++) {
        for (let r = 0; r < rows2; r++) {
          bestPositions.push({ x: startX + c * l2, y: r * w2, l: l2, w: w2 });
        }
      }
    }
  }

  // 4. Transverse Vertical Split (split along pallet length)
  const maxColsW = Math.floor(palletL / boxW);
  for (let x = 1; x < maxColsW; x++) {
    const w1 = boxL;
    const l1 = boxW;
    const cols1 = x;
    const rows1 = Math.floor(palletW / w1);

    const remL = palletL - x * l1;
    const w2 = boxW;
    const l2 = boxL;
    const cols2 = Math.floor(remL / l2);
    const rows2 = Math.floor(palletW / w2);

    const count = (cols1 * rows1) + (cols2 * rows2);
    if (count > bestCount) {
      bestCount = count;
      bestPositions = [];
      for (let c = 0; c < cols1; c++) {
        for (let r = 0; r < rows1; r++) {
          bestPositions.push({ x: c * l1, y: r * w1, l: l1, w: w1 });
        }
      }
      const startX = x * l1;
      for (let c = 0; c < cols2; c++) {
        for (let r = 0; r < rows2; r++) {
          bestPositions.push({ x: startX + c * l2, y: r * w2, l: l2, w: w2 });
        }
      }
    }
  }

  // 5. Horizontal Split (split along pallet width)
  const maxRowsW = Math.floor(palletW / boxW);
  for (let y = 1; y < maxRowsW; y++) {
    const w1 = boxW;
    const l1 = boxL;
    const cols1 = Math.floor(palletL / l1);
    const rows1 = y;

    const remW = palletW - y * w1;
    const w2 = boxL;
    const l2 = boxW;
    const cols2 = Math.floor(palletL / l2);
    const rows2 = Math.floor(remW / w2);

    const count = (cols1 * rows1) + (cols2 * rows2);
    if (count > bestCount) {
      bestCount = count;
      bestPositions = [];
      for (let c = 0; c < cols1; c++) {
        for (let r = 0; r < rows1; r++) {
          bestPositions.push({ x: c * l1, y: r * w1, l: l1, w: w1 });
        }
      }
      const startY = y * w1;
      for (let c = 0; c < cols2; c++) {
        for (let r = 0; r < rows2; r++) {
          bestPositions.push({ x: c * l2, y: startY + r * w2, l: l2, w: w2 });
        }
      }
    }
  }

  // 6. Transverse Horizontal Split (split along pallet width)
  const maxRowsL = Math.floor(palletW / boxL);
  for (let y = 1; y < maxRowsL; y++) {
    const w1 = boxL;
    const l1 = boxW;
    const cols1 = Math.floor(palletL / l1);
    const rows1 = y;

    const remW = palletW - y * w1;
    const w2 = boxW;
    const l2 = boxL;
    const cols2 = Math.floor(palletL / l2);
    const rows2 = Math.floor(remW / w2);

    const count = (cols1 * rows1) + (cols2 * rows2);
    if (count > bestCount) {
      bestCount = count;
      bestPositions = [];
      for (let c = 0; c < cols1; c++) {
        for (let r = 0; r < rows1; r++) {
          bestPositions.push({ x: c * l1, y: r * w1, l: l1, w: w1 });
        }
      }
      const startY = y * w1;
      for (let c = 0; c < cols2; c++) {
        for (let r = 0; r < rows2; r++) {
          bestPositions.push({ x: c * l2, y: startY + r * w2, l: l2, w: w2 });
        }
      }
    }
  }

  return { count: bestCount, positions: bestPositions };
}

function runCartonPalletCalculationMath(palletL, palletW, cartonL, cartonW, cartonH, maxPalletH, cartonOrient) {
  const palletH = 14.4; // standard base height in cm
  const maxCargoH = maxPalletH - palletH;
  
  if (maxCargoH <= 0 || cartonL <= 0 || cartonW <= 0 || cartonH <= 0 || palletL <= 0 || palletW <= 0) {
    return { totalCartons: 0, layers: 0, countPerLayer: 0, positions: [], effectiveCartonHeight: cartonH };
  }

  if (cartonOrient === 'upright') {
    const res = pack2D(palletL, palletW, cartonL, cartonW);
    const layers = Math.floor(maxCargoH / cartonH);
    return {
      totalCartons: res.count * layers,
      layers: layers,
      countPerLayer: res.count,
      positions: res.positions,
      effectiveCartonHeight: cartonH
    };
  } else {
    let bestCount = 0;
    let bestLayers = 0;
    let bestCountPerLayer = 0;
    let bestPositions = [];
    let bestCartonH = cartonH;

    // Orientation 1: height is cartonH, floor is cartonL x cartonW
    {
      const res = pack2D(palletL, palletW, cartonL, cartonW);
      const layers = Math.floor(maxCargoH / cartonH);
      const total = res.count * layers;
      if (total > bestCount) {
        bestCount = total;
        bestLayers = layers;
        bestCountPerLayer = res.count;
        bestPositions = res.positions;
        bestCartonH = cartonH;
      }
    }

    // Orientation 2: height is cartonL, floor is cartonW x cartonH
    {
      const res = pack2D(palletL, palletW, cartonW, cartonH);
      const layers = Math.floor(maxCargoH / cartonL);
      const total = res.count * layers;
      if (total > bestCount) {
        bestCount = total;
        bestLayers = layers;
        bestCountPerLayer = res.count;
        bestPositions = res.positions;
        bestCartonH = cartonL;
      }
    }

    // Orientation 3: height is cartonW, floor is cartonL x cartonH
    {
      const res = pack2D(palletL, palletW, cartonL, cartonH);
      const layers = Math.floor(maxCargoH / cartonW);
      const total = res.count * layers;
      if (total > bestCount) {
        bestCount = total;
        bestLayers = layers;
        bestCountPerLayer = res.count;
        bestPositions = res.positions;
        bestCartonH = cartonW;
      }
    }

    return {
      totalCartons: bestCount,
      layers: bestLayers,
      countPerLayer: bestCountPerLayer,
      positions: bestPositions,
      effectiveCartonHeight: bestCartonH
    };
  }
}

function updatePalletCartonCalculation() {
  const typeSelect = document.getElementById('prod-type');
  if (!typeSelect || typeSelect.value !== 'pallet') {
    const calcGroup = document.getElementById('group-prod-pallet-calc');
    if (calcGroup) calcGroup.style.display = 'none';
    return;
  }

  const calcGroup = document.getElementById('group-prod-pallet-calc');
  if (calcGroup) calcGroup.style.display = 'block';

  const enableCheckbox = document.getElementById('prod-pallet-calc-enable');
  const calcFields = document.getElementById('pallet-calc-fields');
  const heightInput = document.getElementById('prod-height');
  const weightInput = document.getElementById('prod-weight');
  const orientationSelect = document.getElementById('prod-orientation');
  const calcMsg = document.getElementById('pallet-calc-msg');

  if (!enableCheckbox || !calcFields || !heightInput || !weightInput || !orientationSelect || !calcMsg) return;

  if (!enableCheckbox.checked) {
    calcFields.style.display = 'none';
    heightInput.removeAttribute('readonly');
    weightInput.removeAttribute('readonly');
    orientationSelect.disabled = false;
    calcMsg.innerHTML = '';
    return;
  }

  calcFields.style.display = 'flex';
  heightInput.setAttribute('readonly', 'true');
  weightInput.setAttribute('readonly', 'true');
  orientationSelect.value = 'upright';
  orientationSelect.disabled = true;

  let scaleToCm = 1;
  if (currentUnit === 'in') scaleToCm = 2.54;
  else if (currentUnit === 'mm') scaleToCm = 0.1;

  const palletLengthInput = document.getElementById('prod-length');
  const palletWidthInput = document.getElementById('prod-width');
  const pL = (parseFloat(palletLengthInput.value) || 0) * scaleToCm;
  const pW = (parseFloat(palletWidthInput.value) || 0) * scaleToCm;

  const cartonLInput = document.getElementById('prod-pallet-carton-l');
  const cartonWInput = document.getElementById('prod-pallet-carton-w');
  const cartonHInput = document.getElementById('prod-pallet-carton-h');
  const cartonWtInput = document.getElementById('prod-pallet-carton-wt');
  const maxHInput = document.getElementById('prod-pallet-max-h');
  const cartonOrientSelect = document.getElementById('prod-pallet-carton-orient');
  const materialSelect = document.getElementById('prod-pallet-material');

  const cL = (parseFloat(cartonLInput.value) || 0) * scaleToCm;
  const cW = (parseFloat(cartonWInput.value) || 0) * scaleToCm;
  const cH = (parseFloat(cartonHInput.value) || 0) * scaleToCm;
  const cWt = parseFloat(cartonWtInput.value) || 0;
  const maxH = (parseFloat(maxHInput.value) || 0) * scaleToCm;
  const cOrient = cartonOrientSelect.value;
  const palletMaterial = materialSelect.value;

  const result = runCartonPalletCalculationMath(pL, pW, cL, cW, cH, maxH, cOrient);
  const palletTare = palletMaterial === 'plastic' ? 15 : 30;

  let finalHeightCm = 14.4;
  let finalWeightKg = palletTare;

  const scaleFromCm = currentUnit === 'in' ? 1 / 2.54 : (currentUnit === 'mm' ? 10 : 1);
  const decimals = currentUnit === 'mm' ? 0 : 1;

  if (result.totalCartons > 0) {
    const effCartonH = result.effectiveCartonHeight || cH;
    finalHeightCm = 14.4 + result.layers * effCartonH;
    finalWeightKg = palletTare + result.totalCartons * cWt;

    calcMsg.innerHTML = `
      Palletizing Result: <strong>${result.totalCartons} Cartons</strong> Packed<br>
      Layout: <strong>${result.countPerLayer} per layer</strong> (${result.layers} layers)<br>
      Total Height: <strong>${(finalHeightCm * scaleFromCm).toFixed(decimals)} ${currentUnit}</strong><br>
      Total Weight: <strong>${finalWeightKg.toLocaleString()} kg</strong> (incl. ${palletTare}kg pallet)
    `;

    heightInput.value = (finalHeightCm * scaleFromCm).toFixed(decimals);
    weightInput.value = finalWeightKg;
  } else {
    calcMsg.innerHTML = `<span style="color: var(--danger);">Cannot fit any cartons with these parameters.</span>`;
    heightInput.value = (14.4 * scaleFromCm).toFixed(decimals);
    weightInput.value = palletTare;
  }
}
