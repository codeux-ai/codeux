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

console.log("status.green vs white:", getContrast("#00AB84", "#FFFFFF"));
console.log("status.green vs #0E0C0A:", getContrast("#00AB84", "#0E0C0A"));
console.log("status.red vs white:", getContrast("#E3000F", "#FFFFFF"));
console.log("status.red vs #0E0C0A:", getContrast("#E3000F", "#0E0C0A"));
console.log("status.amber vs white:", getContrast("#F59E0B", "#FFFFFF"));
console.log("status.amber vs #0E0C0A:", getContrast("#F59E0B", "#0E0C0A"));
console.log("status.violet vs white:", getContrast("#A300D6", "#FFFFFF"));
console.log("status.violet vs #0E0C0A:", getContrast("#A300D6", "#0E0C0A"));

// Signal colors
console.log("signal.500 vs white:", getContrast("#00E0A0", "#FFFFFF"));
console.log("signal.500 vs #0E0C0A:", getContrast("#00E0A0", "#0E0C0A"));
console.log("signal.600 vs white:", getContrast("#00B882", "#FFFFFF"));
console.log("signal.600 vs #0E0C0A:", getContrast("#00B882", "#0E0C0A"));
console.log("signal.700 vs white:", getContrast("#008F65", "#FFFFFF"));
console.log("signal.700 vs #0E0C0A:", getContrast("#008F65", "#0E0C0A"));
