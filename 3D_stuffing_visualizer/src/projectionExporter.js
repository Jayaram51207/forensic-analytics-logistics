import { jsPDF } from 'jspdf';
import { getSnapshot } from './visualizer';

/**
 * Utility to convert Hex color strings (e.g. "#0ea5e9") to RGB values
 */
function hexToRgb(hex) {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result ? {
    r: parseInt(result[1], 16),
    g: parseInt(result[2], 16),
    b: parseInt(result[3], 16)
  } : { r: 128, g: 128, b: 128 };
}

/**
 * Generates and downloads a single-page PDF stuffing report
 * @param {Object} container The container specifications
 * @param {Array} placedBoxes Array of placed box objects
 * @param {Array} manifestList Complete list of cargo manifest items
 * @param {string} currentUnit Active unit ('cm', 'in', 'mm')
 * @param {Object} stats Pre-calculated statistics (volume, weight, etc.)
 * @param {number} unplacedCount Number of leftover boxes that could not be packed
 */
export function exportStuffingReport(container, placedBoxes, manifestList, currentUnit, stats, unplacedCount) {
  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: 'a4'
  });

  const pageWidth = 210;
  const pageHeight = 297;
  const margin = 15;
  const contentWidth = pageWidth - (margin * 2); // 180mm

  // --- 1. UTILIZATION STATS SUMMARY ---
  let currentY = 15;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12);
  doc.setTextColor(15, 20, 32);
  doc.text('1. Utilization Summary', margin, currentY);

  currentY += 5;
  // Stats Card Background
  doc.setFillColor(248, 250, 252); // #f8fafc
  doc.setDrawColor(226, 232, 240); // #e2e8f0
  doc.rect(margin, currentY, contentWidth, 24, 'FD');

  // Stats Text Grid
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(100, 116, 139); // #64748b

  // Column 1
  doc.text('Selected Vehicle:', margin + 5, currentY + 6);
  doc.text('Volume Utilized:', margin + 5, currentY + 12);
  doc.text('Weight Loaded:', margin + 5, currentY + 18);

  // Column 2
  doc.text('Total Items Loaded:', margin + 95, currentY + 6);
  doc.text('Cargo Volume Space:', margin + 95, currentY + 12);
  doc.text('Container Payload Limit:', margin + 95, currentY + 18);

  // Values (Bold)
  doc.setTextColor(15, 20, 32);
  doc.setFont('helvetica', 'bold');

  // Column 1 values
  doc.text(container.name, margin + 40, currentY + 6);
  doc.text(`${stats.volPercent}%`, margin + 40, currentY + 12);
  doc.text(`${stats.wtUsed.toLocaleString()} kg`, margin + 40, currentY + 18);

  // Column 2 values
  doc.text(`${placedBoxes.length} pcs`, margin + 140, currentY + 6);
  doc.text(`${stats.volUsed.toFixed(2)} / ${stats.volTotal.toFixed(2)} ${stats.volUnit}`, margin + 140, currentY + 12);
  doc.text(`${container.maxWeight.toLocaleString()} kg`, margin + 140, currentY + 18);

  // --- 2. 3D LOAD VIEW SNAPSHOT ---
  currentY += 33;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12);
  doc.setTextColor(15, 20, 32);
  doc.text('2. 3D Loading Projection View', margin, currentY);

  currentY += 5;
  const snapshotImage = getSnapshot();
  const imageWidth = 140; 
  const imageHeight = 75; // ~1.86 aspect ratio
  const imageX = margin + (contentWidth - imageWidth) / 2; // Center horizontally

  if (snapshotImage) {
    // Render the widescreen perspective snapshot from Three.js WebGL canvas
    doc.addImage(snapshotImage, 'PNG', imageX, currentY, imageWidth, imageHeight);
    
    // Border surrounding snapshot
    doc.setDrawColor(203, 213, 225); // #cbd5e1
    doc.rect(imageX, currentY, imageWidth, imageHeight, 'D');
  } else {
    // Fallback if visualizer hasn't fully loaded
    doc.setFillColor(241, 245, 249);
    doc.rect(imageX, currentY, imageWidth, imageHeight, 'F');
    doc.setFont('helvetica', 'italic');
    doc.setFontSize(10);
    doc.setTextColor(100, 116, 139);
    doc.text('3D projection view capture unavailable.', pageWidth / 2, currentY + imageHeight / 2, { align: 'center' });
  }

  // --- 3. CARGO MANIFEST DETAILS TABLE ---
  currentY += imageHeight + 10;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12);
  doc.setTextColor(15, 20, 32);
  doc.text('3. Loaded Manifest Details', margin, currentY);

  currentY += 5;
  // Table Header Background
  doc.setFillColor(15, 20, 32);
  doc.rect(margin, currentY, contentWidth, 7, 'F');

  // Table Header Labels
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(8.5);
  doc.setFont('helvetica', 'bold');
  doc.text('Color', margin + 3, currentY + 4.8);
  doc.text('Cargo Name', margin + 14, currentY + 4.8);
  doc.text('Dimensions', margin + 70, currentY + 4.8);
  doc.text('Unit Weight', margin + 115, currentY + 4.8);
  doc.text('Loaded Quantity', margin + 145, currentY + 4.8);

  // Table Body Rows
  currentY += 7;
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(51, 65, 85); // Slate-700
  let rowIndex = 0;
  const rowHeight = 6.2;
  const maxRowsOnPage = 10; // Keep space budgeted strictly so it fits on one page

  let renderedCount = 0;
  manifestList.forEach((item, index) => {
    const loadedCount = placedBoxes.filter(b => b.typeIndex === index).length;
    if (loadedCount > 0 && renderedCount < maxRowsOnPage) {
      // Alternating row background shading
      if (rowIndex % 2 === 0) {
        doc.setFillColor(248, 250, 252);
        doc.rect(margin, currentY, contentWidth, rowHeight, 'F');
      }

      // 1. Draw Color Box
      const rgb = hexToRgb(item.color);
      doc.setFillColor(rgb.r, rgb.g, rgb.b);
      doc.rect(margin + 4, currentY + 1.6, 3, 3, 'F');
      doc.setDrawColor(200, 200, 200);
      doc.rect(margin + 4, currentY + 1.6, 3, 3, 'D');

      // 2. Write Name
      let nameText = item.name;
      if (nameText.length > 30) nameText = nameText.substring(0, 28) + '...';
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(15, 20, 32);
      doc.text(nameText, margin + 14, currentY + 4.2);

      // 3. Dimensions
      let dimText = '';
      if (currentUnit === 'in') {
        dimText = `${(item.length / 2.54).toFixed(1)} x ${(item.width / 2.54).toFixed(1)} x ${(item.height / 2.54).toFixed(1)} in`;
      } else if (currentUnit === 'mm') {
        dimText = `${(item.length * 10).toFixed(0)} x ${(item.width * 10).toFixed(0)} x ${(item.height * 10).toFixed(0)} mm`;
      } else {
        dimText = `${item.length} x ${item.width} x ${item.height} cm`;
      }
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(51, 65, 85);
      doc.text(dimText, margin + 70, currentY + 4.2);

      // 4. Unit Weight
      doc.text(`${item.weight} kg`, margin + 115, currentY + 4.2);

      // 5. Quantity Loaded
      doc.setFont('helvetica', 'bold');
      doc.text(`${loadedCount} / ${item.quantity} pcs`, margin + 145, currentY + 4.2);

      currentY += rowHeight;
      rowIndex++;
      renderedCount++;
    }
  });

  // Handle case where some manifest types were omitted due to budget spacing
  const totalDistinctTypesLoaded = manifestList.filter((item, idx) => placedBoxes.some(b => b.typeIndex === idx)).length;
  if (totalDistinctTypesLoaded > maxRowsOnPage) {
    const extraCount = totalDistinctTypesLoaded - maxRowsOnPage;
    doc.setFillColor(248, 250, 252);
    doc.rect(margin, currentY, contentWidth, rowHeight, 'F');
    doc.setFont('helvetica', 'italic');
    doc.setFontSize(8);
    doc.setTextColor(100, 116, 139);
    doc.text(`* And ${extraCount} additional cargo type(s) loaded. Refer to the dashboard app for details.`, margin + 5, currentY + 4.2);
    currentY += rowHeight;
  }

  // Warning Banner for left-overs
  if (unplacedCount > 0) {
    doc.setFillColor(254, 242, 242); // Red-50
    doc.rect(margin, currentY + 2, contentWidth, 7, 'F');
    doc.setDrawColor(254, 226, 226); // Red-100
    doc.rect(margin, currentY + 2, contentWidth, 7, 'D');

    doc.setTextColor(220, 38, 38); // Red-600
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    doc.text(`WARNING: ${unplacedCount} item(s) could not be placed due to spatial or weight limit restrictions.`, margin + 4, currentY + 6.8);
  }

  // --- FOOTER SECTION ---
  const footerY = pageHeight - margin;
  doc.setDrawColor(226, 232, 240); // #e2e8f0
  doc.line(margin, footerY - 4, pageWidth - margin, footerY - 4);

  doc.setFont('helvetica', 'italic');
  doc.setFontSize(8);
  doc.setTextColor(148, 163, 184); // #94a3b8
  doc.text('Generated via Antigravity 3D Load & Stuffing Exporter.', margin, footerY);
  doc.text('Page 1 of 1', pageWidth - margin - 15, footerY);

  // Trigger Save
  const sanitizedName = container.name.replace(/[^a-z0-9]/gi, '_').toLowerCase();
  const filename = `stuffing_report_${sanitizedName}.pdf`;

  if (window.pywebview && window.pywebview.api && window.pywebview.api.save_pdf) {
    const pdfBase64 = doc.output('datauristring');
    window.pywebview.api.save_pdf(filename, pdfBase64).then((success) => {
      if (success) {
        console.log("PDF saved successfully via pywebview API.");
      }
    }).catch((err) => {
      console.error("Error saving PDF via pywebview API, falling back to browser download:", err);
      doc.save(filename);
    });
  } else {
    // Web browser fallback
    doc.save(filename);
  }
}
