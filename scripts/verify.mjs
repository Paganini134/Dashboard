import { chromium } from "@playwright/test";
import { PNG } from "pngjs";

const targets = [
  { name: "desktop", viewport: { width: 1280, height: 800 } },
  { name: "mobile", viewport: { width: 390, height: 844 } }
];

const browser = await chromium.launch();

for (const target of targets) {
  const page = await browser.newPage({ viewport: target.viewport });
  await page.goto("http://127.0.0.1:5173/", { waitUntil: "networkidle" });
  await page.waitForSelector("canvas");
  await page.waitForTimeout(800);
  const screenshot = await page.screenshot({ path: `test-results/${target.name}.png`, fullPage: true });

  const png = PNG.sync.read(screenshot);
  const sampleStep = Math.max(1, Math.floor(Math.min(png.width, png.height) / 36));
  const colors = new Set();
  let brightPixels = 0;

  for (let y = 0; y < png.height; y += sampleStep) {
    for (let x = 0; x < png.width; x += sampleStep) {
      const offset = (png.width * y + x) * 4;
      const r = png.data[offset];
      const g = png.data[offset + 1];
      const b = png.data[offset + 2];
      const a = png.data[offset + 3];
      if (a > 0 && r + g + b > 80) brightPixels += 1;
      colors.add(`${Math.floor(r / 16)},${Math.floor(g / 16)},${Math.floor(b / 16)},${Math.floor(a / 16)}`);
    }
  }

  const pixelReport = {
    ok: brightPixels > 20 && colors.size > 8,
    brightPixels,
    unique: colors.size
  };

  if (!pixelReport.ok) {
    throw new Error(`${target.name} canvas check failed: ${JSON.stringify(pixelReport)}`);
  }

  await page.close();
}

await browser.close();
console.log("Playwright verification passed for desktop and mobile viewports.");
