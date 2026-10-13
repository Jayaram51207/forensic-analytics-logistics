// Evidence summary of one packCargo() run, sent to the desktop wrapper
// (app.py Api.forensic_event) and reused by the forensic layer's tests.
// Pure function: no DOM, no network.
export function packingPayload(container, manifest, result) {
  const reasons = {};
  for (const b of result.unplacedBoxes) {
    const reason = b.unplacedReason || 'not_recorded';
    reasons[reason] = (reasons[reason] || 0) + 1;
  }
  return {
    container: { id: container.id, name: container.name, length: container.length, width: container.width, height: container.height, maxWeight: container.maxWeight },
    manifest: manifest.map(m => ({ name: m.name, type: m.type || 'carton', length: m.length, width: m.width, height: m.height, weight: m.weight, quantity: m.quantity, orientation: m.orientation || 'any' })),
    placed_count: result.placedBoxes.length,
    unplaced_count: result.unplacedBoxes.length,
    unplaced_reasons: reasons,
    total_weight: result.totalWeight,
    weight_utilization: +result.weightUtilization.toFixed(2),
    volume_utilization: +result.volumeUtilization.toFixed(2),
    algorithm: 'packing.js packCargo (extreme-point heuristic, 60% support rule)'
  };
}
