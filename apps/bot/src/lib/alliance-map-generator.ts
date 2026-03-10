import { readFileSync, existsSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join, resolve } from "path";
import sharp from "sharp";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

function resolveSvgPath(): string {
  const workspaceRoot = resolve(__dirname, "../../../../");
  const srcPath = join(
    workspaceRoot,
    "packages/shared/src/assets/torn-territory-map.svg",
  );
  if (existsSync(srcPath)) {
    return srcPath;
  }

  const distPath = join(
    workspaceRoot,
    "packages/shared/dist/assets/torn-territory-map.svg",
  );
  if (existsSync(distPath)) {
    return distPath;
  }

  return srcPath;
}

const SVG_PATH = resolveSvgPath();

const DEFAULT_NEUTRAL_FILL = "#2c2c2c";
const DEFAULT_NEUTRAL_STROKE = "#444444";
const DEFAULT_NEUTRAL_OPACITY = "0.8";
const DEFAULT_FILLED_OPACITY = "0.95";

function darkenHex(hex: string, factor: number): string {
  const clean = hex.replace("#", "");
  if (clean.length !== 6) {
    return DEFAULT_NEUTRAL_STROKE;
  }

  const r = Math.max(
    0,
    Math.min(255, Math.floor(parseInt(clean.slice(0, 2), 16) * factor)),
  );
  const g = Math.max(
    0,
    Math.min(255, Math.floor(parseInt(clean.slice(2, 4), 16) * factor)),
  );
  const b = Math.max(
    0,
    Math.min(255, Math.floor(parseInt(clean.slice(4, 6), 16) * factor)),
  );

  return `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}`;
}

export function generateAllianceMapSvg(
  territoryFillById: Map<string, string>,
): Buffer {
  let svg: string;
  try {
    svg = readFileSync(SVG_PATH, "utf-8");
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to read SVG file at ${SVG_PATH}: ${errorMsg}`);
  }

  if (!svg.includes("xmlns:xlink")) {
    svg = svg.replace(
      /^<svg\s+/,
      '<svg xmlns:xlink="http://www.w3.org/1999/xlink" ',
    );
  }

  svg = svg.replace(
    /(<svg[^>]*>)/,
    '$1<rect width="100%" height="100%" fill="#0a0a0a"/>',
  );

  svg = svg.replace(/<defs>[\s\S]*?<\/defs>/g, "<defs></defs>");

  svg = svg.replace(/<path[^>]*>/g, (pathMatch) => {
    const isTerritory = pathMatch.includes('class="shape territory');

    if (!isTerritory) {
      let updated = pathMatch.replace(/fill="[^"]*"/, 'fill="none"');
      updated = updated.replace(/stroke="[^"]*"/, 'stroke="none"');
      updated = updated.replace(/fill-opacity="[^"]*"/, 'fill-opacity="0"');
      return updated;
    }

    const labelMatch = pathMatch.match(/aria-label="([^"]+)"/);
    const territoryCode = labelMatch?.[1] ?? "";
    const fillColor =
      territoryFillById.get(territoryCode) ?? DEFAULT_NEUTRAL_FILL;
    const hasAllianceColor = territoryFillById.has(territoryCode);
    const strokeColor = hasAllianceColor
      ? darkenHex(fillColor, 0.62)
      : DEFAULT_NEUTRAL_STROKE;
    const opacity = hasAllianceColor
      ? DEFAULT_FILLED_OPACITY
      : DEFAULT_NEUTRAL_OPACITY;

    let updated = pathMatch.replace(/fill="[^"]*"/, `fill="${fillColor}"`);
    updated = updated.replace(/stroke="[^"]*"/, `stroke="${strokeColor}"`);
    updated = updated.replace(
      /fill-opacity="[^"]*"/,
      `fill-opacity="${opacity}"`,
    );

    return updated;
  });

  return Buffer.from(svg, "utf-8");
}

export async function generateAllianceMapPng(
  territoryFillById: Map<string, string>,
): Promise<Buffer> {
  const svgBuffer = generateAllianceMapSvg(territoryFillById);

  try {
    return await sharp(svgBuffer, { density: 150 })
      .png({ quality: 85, progressive: true, compressionLevel: 9 })
      .toBuffer();
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to convert alliance SVG to PNG: ${errorMsg}`);
  }
}
