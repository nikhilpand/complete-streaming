// Test scroll calculations and physics lerp
console.log("=== Testing Lyrics Auto-Scroll Calculations ===");

function calcTargetScrollY(lineOffsetTop, wrapperHeight, opticalRatio = 0.38) {
  const opticalCenter = wrapperHeight * opticalRatio;
  return Math.max(0, lineOffsetTop - opticalCenter);
}

// 1. Desktop Viewport (800px)
const desktopH = 800;
const opticalCenterDesktop = desktopH * 0.38; // 304px

// Early lines (intro)
console.log("Line 0 offsetTop 30px -> targetScrollY:", calcTargetScrollY(30, desktopH)); // 0
console.log("Line 1 offsetTop 90px -> targetScrollY:", calcTargetScrollY(90, desktopH)); // 0
console.log("Line 2 offsetTop 160px -> targetScrollY:", calcTargetScrollY(160, desktopH)); // 0
console.log("Line 3 offsetTop 240px -> targetScrollY:", calcTargetScrollY(240, desktopH)); // 0

if (calcTargetScrollY(30, desktopH) !== 0 || calcTargetScrollY(240, desktopH) !== 0) {
  throw new Error("Intro lines must NOT have negative targetScrollY!");
}

// Mid lines (scrolling kicks in smoothly)
const line4Y = calcTargetScrollY(360, desktopH); // 360 - 304 = 56px
const line10Y = calcTargetScrollY(800, desktopH); // 800 - 304 = 496px
console.log("Line 4 offsetTop 360px -> targetScrollY:", line4Y);
console.log("Line 10 offsetTop 800px -> targetScrollY:", line10Y);

if (line4Y <= 0 || line10Y <= line4Y) {
  throw new Error("Mid lines must smoothly increase targetScrollY!");
}

// 2. Mobile Viewport (600px)
const mobileH = 600;
console.log("Mobile Line 0 (20px) -> targetScrollY:", calcTargetScrollY(20, mobileH)); // 0
console.log("Mobile Line 5 (300px) -> targetScrollY:", calcTargetScrollY(300, mobileH)); // 300 - 228 = 72px

if (calcTargetScrollY(20, mobileH) !== 0) {
  throw new Error("Mobile intro line must be 0!");
}

// 3. Test Lerp Convergence
let currentY = 0;
const targetY = 300;
const dt = 16.667;
const decay = 0.84;
const factor = 1 - Math.pow(decay, dt / 16.667); // 0.16

for (let frame = 0; frame < 30; frame++) {
  const diff = targetY - currentY;
  if (Math.abs(diff) > 0.05) {
    currentY += diff * factor;
  }
}
console.log("CurrentY after 30 frames (0.5s):", currentY.toFixed(2), "Target:", targetY);
if (Math.abs(targetY - currentY) > 2) {
  throw new Error(`Lerp did not converge in 30 frames! Remaining: ${targetY - currentY}`);
}

console.log("=== ALL SCROLL ENGINE TESTS PASSED ===");
