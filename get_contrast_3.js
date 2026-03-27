function getLuminance(r, g, b) {
  var a = [r, g, b].map(function (v) {
    v /= 255;
    return v <= 0.03928
      ? v / 12.92
      : Math.pow((v + 0.055) / 1.055, 2.4);
  });
  return a[0] * 0.2126 + a[1] * 0.7152 + a[2] * 0.0722;
}

function hexToRgb(hex) {
  var result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result ? {
    r: parseInt(result[1], 16),
    g: parseInt(result[2], 16),
    b: parseInt(result[3], 16)
  } : null;
}

function getContrast(hex1, hex2) {
  var rgb1 = hexToRgb(hex1);
  var rgb2 = hexToRgb(hex2);
  var lum1 = getLuminance(rgb1.r, rgb1.g, rgb1.b);
  var lum2 = getLuminance(rgb2.r, rgb2.g, rgb2.b);
  var brightest = Math.max(lum1, lum2);
  var darkest = Math.min(lum1, lum2);
  return (brightest + 0.05) / (darkest + 0.05);
}

// status.red light/dark
console.log("status.red (#D9000E) vs white:", getContrast("#D9000E", "#FFFFFF")); // Need >= 4.5
console.log("status.red-dark (#FF4D58) vs #0E0C0A:", getContrast("#FF4D58", "#0E0C0A")); // Need >= 4.5

// status.amber light/dark
console.log("status.amber (#A66200) vs white:", getContrast("#A66200", "#FFFFFF")); // Need >= 4.5
console.log("status.amber-dark (#F59E0B) vs #0E0C0A:", getContrast("#F59E0B", "#0E0C0A")); // Need >= 4.5

// status.green light/dark
console.log("status.green (#008667) vs white:", getContrast("#008667", "#FFFFFF")); // Need >= 4.5
console.log("status.green-dark (#00AB84) vs #0E0C0A:", getContrast("#00AB84", "#0E0C0A")); // Need >= 4.5

// status.violet light/dark
console.log("status.violet (#8A00B5) vs white:", getContrast("#8A00B5", "#FFFFFF")); // Need >= 4.5
console.log("status.violet-dark (#C95CFF) vs #0E0C0A:", getContrast("#C95CFF", "#0E0C0A")); // Need >= 4.5
