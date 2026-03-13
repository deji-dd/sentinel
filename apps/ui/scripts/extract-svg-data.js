const fs = require('fs');
const path = require('path');

function extractTerritoryData() {
  const svgPath = "/home/deji/repos/sentinel/packages/shared/src/assets/torn-territory-map.svg";
  const outputPath = "/home/deji/repos/sentinel/apps/map-painter/src/lib/painter/territories.json";

  if (!fs.existsSync(svgPath)) {
    console.error("SVG file not found at:", svgPath);
    return;
  }

  const svgContent = fs.readFileSync(svgPath, "utf-8");
  
  // Extract all <path> elements
  const pathRegex = /<path([^>]+)>/g;
  const territories = [];
  let match;

  while ((match = pathRegex.exec(svgContent)) !== null) {
    const attrs = match[1];
    
    const labelMatch = attrs.match(/aria-label="([^"]+)"/);
    const dMatch = attrs.match(/d="([^"]+)"/);
    const dbIdMatch = attrs.match(/db_id="([^"]+)"/);

    if (labelMatch && dMatch) {
      const label = labelMatch[1];
      const d = dMatch[1];
      const id = dbIdMatch ? dbIdMatch[1] : `tt-${label}`;
      
      territories.push({ id, label, path: d });
    }
  }

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, JSON.stringify(territories, null, 2));
  console.log(`Extracted ${territories.length} territories to ${outputPath}`);
}

extractTerritoryData();
