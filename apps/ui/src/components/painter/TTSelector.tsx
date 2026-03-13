"use client";

import { useEffect, useRef, useState, useMemo } from "react";
import * as L from "leaflet";
import "leaflet/dist/leaflet.css";
import { MapPainterState } from "@/types/painter";
import { Plus, Trash2, Eraser, Info, ChevronDown, ChevronRight, LayoutGrid, Zap, DollarSign } from "lucide-react";
import { parseRewardString, calculateDailyValue } from "@sentinel/shared/racket-reward";

// @ts-ignore
import tornMapRawSVG from "../../../../../packages/shared/src/assets/torn-territory-map.svg?raw";


const API_BASE = import.meta.env.VITE_API_URL || "http://localhost:3001";

interface TTSelectorProps {
  initialState?: Partial<MapPainterState>;
  onSave?: (state: MapPainterState) => void;
  territoryData?: Record<string, {
    sector: number;
    respect: number;
    racket?: { name: string; reward: string; level: number } | null;
  }>;
}

const DEFAULT_LABELS = [
  { id: "label-1", text: "Faction A", color: "#3b82f6", respect: 0, sectors: 0, rackets: 0 },
  { id: "label-2", text: "Faction B", color: "#ef4444", respect: 0, sectors: 0, rackets: 0 },
];

export default function TTSelector({ initialState, onSave, territoryData }: TTSelectorProps) {
  const mapRef = useRef<L.Map | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const pathRefs = useRef<Record<string, SVGPathElement>>({});
  const centersRef = useRef<Record<string, { lat: number; lng: number }>>({});
  const labelsLayerRef = useRef<L.LayerGroup | null>(null);
  const racketsLayerRef = useRef<L.LayerGroup | null>(null);

  const [selectedLabelId, setSelectedLabelId] = useState<string | null>(DEFAULT_LABELS[0].id);
  const [expandedLabelId, setExpandedLabelId] = useState<string | null>(null);
  const [initialPathsReady, setInitialPathsReady] = useState(false);
  const [labels, setLabels] = useState(initialState?.labels || DEFAULT_LABELS);
  const [assignments, setAssignments] = useState<Record<string, string>>(initialState?.assignments || {});
  const [hoveredInfo, setHoveredInfo] = useState<{ id: string; sector: number; respect: number; racket?: string } | null>(null);
  const [mousePos, setMousePos] = useState({ x: 0, y: 0 });

  // Stats aggregation
  const stats = useMemo(() => {
    const aggregate: Record<string, {
      respect: number;
      count: number;
      rackets: number;
      dailyValue: number;
      sectors: Record<number, number>;
      territories: string[];
    }> = {};

    labels.forEach(l => {
      aggregate[l.id] = {
        respect: 0,
        count: 0,
        rackets: 0,
        dailyValue: 0,
        sectors: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0, 7: 0 },
        territories: []
      };
    });

    // Use live prices from bot if available
    const livePrices: Record<string, number> = {
      ...(initialState as any)?.prices?.items || {},
      "Points": (initialState as any)?.prices?.points || 0
    };

    Object.entries(assignments).forEach(([territoryId, labelId]) => {
      if (aggregate[labelId]) {
        const metadata = territoryData?.[territoryId] || initialState?.territoryMetadata?.[territoryId];
        aggregate[labelId].count += 1;
        aggregate[labelId].respect += metadata?.respect || 0;
        aggregate[labelId].territories.push(territoryId);

        if (metadata?.sector) {
          aggregate[labelId].sectors[metadata.sector] = (aggregate[labelId].sectors[metadata.sector] || 0) + 1;
        }

        if (metadata?.racket) {
          aggregate[labelId].rackets += 1;
          const rewardInfo = parseRewardString(metadata.racket.reward);
          aggregate[labelId].dailyValue += calculateDailyValue(rewardInfo, livePrices);
        }
      }
    });

    return aggregate;
  }, [assignments, labels, territoryData, initialState?.territoryMetadata]);

  // Initialization
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const bounds: L.LatLngBoundsExpression = [[0, 0], [912, 1564]];

    const map = L.map(containerRef.current, {
      crs: L.CRS.Simple,
      minZoom: -1.5,
      maxZoom: 2,
      maxBounds: bounds,
      maxBoundsViscosity: 1.0,
      zoomSnap: 0.1,
      attributionControl: false,
      zoomControl: true, // Re-enable zoom buttons
    });
    mapRef.current = map;
    labelsLayerRef.current = L.layerGroup().addTo(map);
    racketsLayerRef.current = L.layerGroup().addTo(map);

    // Initial view: Zoomed in on a central region but showing a good portion
    map.setView([456, 782], -0.2);


    // Create SVG Element from raw string
    let svgElement: SVGElement | null = null;
    try {
      if (!tornMapRawSVG || typeof tornMapRawSVG !== 'string') {
        throw new Error(`Invalid tornMapRawSVG import. Type: ${typeof tornMapRawSVG}`);
      }

      // Fix for "Namespace prefix xlink for href on image is not defined"
      let processedSVG = tornMapRawSVG;
      if (processedSVG.includes("xlink:href") && !processedSVG.includes("xmlns:xlink")) {
        // More robust replacement for different svg tag formats
        processedSVG = processedSVG.replace(/<svg\s/i, '<svg xmlns:xlink="http://www.w3.org/1999/xlink" ');
      }

      const parser = new DOMParser();
      const doc = parser.parseFromString(processedSVG, "image/svg+xml");
      const parserError = doc.querySelector("parsererror");

      if (parserError) {
        throw new Error(`SVG Parsing Failed: ${parserError.textContent}`);
      }

      const rootNode = doc.documentElement;
      if (!rootNode || rootNode.nodeName.toLowerCase() !== 'svg') {
        throw new Error("Could not find SVG element in parsed document");
      }

      // Create a NATIVE SVG element in our document context
      // This is more robust than adoptNode for Leaflet's style/transform manipulation
      svgElement = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      svgElement.innerHTML = rootNode.innerHTML;

      // Copy relevant attributes
      for (const attr of rootNode.attributes) {
        if (['viewbox', 'xmlns', 'preserveaspectratio'].includes(attr.name.toLowerCase())) {
          svgElement.setAttribute(attr.name, attr.value);
        }
      }


      // Clean up and standardize
      svgElement.removeAttribute("style");
      svgElement.removeAttribute("width");
      svgElement.removeAttribute("height");
      svgElement.classList.remove("leaflet-zoom-hide");
      svgElement.setAttribute("viewBox", "0 0 1564 912");

      const defs = svgElement.querySelector("defs");
      if (defs) defs.innerHTML = ""; // Remove patterns/textures that obscure colors

    } catch (err) {
      console.error("[TTSelector] Map Initialization Error (SVG):", err);
      return;
    }

    // Map overlay natively drawing the SVG inside leaflet
    // We wrap this in a timeout to ensure the map is fully stable 
    // before Leaflet tries to calculate transforms for the overlay
    setTimeout(() => {
      try {
        if (!svgElement || !mapRef.current) return;

        L.svgOverlay(svgElement, bounds, {
          interactive: true,
          className: "torn-svg-overlay",
        }).addTo(mapRef.current);

        // Prepare paths for interaction once added
        const svgPaths = svgElement.querySelectorAll("path");

        svgPaths.forEach((path) => {
          const dbId = path.getAttribute("db_id") || "";
          const label = path.getAttribute("aria-label") || "";

          // Check metadata for either the numeric dbId OR the 3-letter label (e.g. VHB)
          const meta = territoryData || initialState?.territoryMetadata;
          const blueprint = meta?.[dbId] || meta?.[label];
          const isSelectable = !!blueprint;

          if (!isSelectable) {
            path.setAttribute("fill", "none");
            path.setAttribute("stroke", "none");
            path.setAttribute("fill-opacity", "0");
            path.style.pointerEvents = "none"; // Disable interactions for fixed blocks
            return;
          }

          // Use the internal identifier that matches assignments
          const territoryId = label || dbId;

          // Base style
          path.setAttribute("fill", "#2a2a2a");
          path.setAttribute("fill-opacity", "0.3");
          path.setAttribute("stroke", "#444444");
          path.setAttribute("stroke-width", "1");
          path.style.cursor = "pointer";

          // Interaction
          path.addEventListener("click", (e) => {
            e.stopPropagation();
            document.dispatchEvent(new CustomEvent("territoryClick", { detail: { territoryId } }));
          });

          path.addEventListener("mouseenter", (_e) => {
            if (blueprint) {
              setHoveredInfo({
                id: territoryId,
                sector: blueprint.sector,
                respect: blueprint.respect,
                racket: blueprint.racket?.name
              });
            }
          });

          path.addEventListener("mousemove", (e) => {
            setMousePos({ x: e.clientX, y: e.clientY });
          });

          path.addEventListener("mouseleave", () => {
            setHoveredInfo(null);
          });

          // Label/Tooltip
          if (blueprint) {
            let titleEl = path.querySelector("title") as SVGTitleElement | null;
            if (!titleEl) {
              titleEl = document.createElementNS("http://www.w3.org/2000/svg", "title") as SVGTitleElement;
              path.appendChild(titleEl);
            }
            const info = `${label || dbId}\nSector: ${blueprint.sector}\nRespect: ${blueprint.respect}${blueprint.racket ? `\nRacket: ${blueprint.racket.name}` : ""}`;
            titleEl.textContent = info;

            // Cache center for map labels
            try {
              const bbox = path.getBBox();
              centersRef.current[territoryId] = {
                lat: 912 - (bbox.y + bbox.height / 2),
                lng: bbox.x + bbox.width / 2
              };
            } catch (e) {
              // Fallback if getBBox fails (e.g. element not truly rendered)
              console.warn("[TTSelector] Failed to get bbox for", territoryId);
            }
          }

          // Store ref using the identifier assignments uses
          pathRefs.current[territoryId] = path;

          // Add racket indicator if present - Static pinpoints for max performance
          if (blueprint?.racket) {
            const bbox = path.getBBox();
            const cx = bbox.x + bbox.width / 2;
            const cy = bbox.y + bbox.height / 2;

            const racketDot = document.createElementNS("http://www.w3.org/2000/svg", "circle");
            racketDot.setAttribute("cx", cx.toString());
            racketDot.setAttribute("cy", cy.toString());
            racketDot.setAttribute("r", "2.0");
            racketDot.setAttribute("fill", "#fbbf24");
            racketDot.setAttribute("stroke", "#000");
            racketDot.setAttribute("stroke-width", "0.5");
            racketDot.classList.add("racket-dot");
            racketDot.style.pointerEvents = "none";

            // Subtle glow circle (static)
            const glow = document.createElementNS("http://www.w3.org/2000/svg", "circle");
            glow.setAttribute("cx", cx.toString());
            glow.setAttribute("cy", cy.toString());
            glow.setAttribute("r", "4.0");
            glow.setAttribute("fill", "#fbbf24");
            glow.setAttribute("fill-opacity", "0.2");
            glow.classList.add("racket-glow");
            glow.style.pointerEvents = "none";

            svgElement.appendChild(glow);
            svgElement.appendChild(racketDot);
          }
        });

        // Add dynamic indicator resizing on zoom
        map.on('zoom', () => {
          const zoom = map.getZoom();
          // We want the dot to stay a consistent visual size
          // Scale factor: roughly 2 ^ (-zoom)
          const scale = Math.pow(2, -zoom);
          const dotRadius = 2.0 * scale;
          const glowRadius = 4.0 * scale;

          document.querySelectorAll('.racket-dot').forEach(el => {
            el.setAttribute('r', dotRadius.toString());
            el.setAttribute('stroke-width', (0.5 * scale).toString());
          });
          document.querySelectorAll('.racket-glow').forEach(el => {
            el.setAttribute('r', glowRadius.toString());
          });
        });

        setInitialPathsReady(true);
        // Trigger an initial label draw
        document.dispatchEvent(new CustomEvent("refreshLabels"));

      } catch (err) {
        console.error("[TTSelector] Leaflet svgOverlay Error:", err);
      }
    }, 50);

    return () => {
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
    };
  }, []);

  // Handle territory clicks from the event listener
  useEffect(() => {
    const handleTerritoryClick = (e: Event) => {
      const customEvent = e as CustomEvent<{ territoryId: string }>;
      const { territoryId } = customEvent.detail;
      const labelId = selectedLabelId;

      setAssignments(prev => {
        const next = { ...prev };
        if (labelId) {
          next[territoryId] = labelId;
        } else {
          delete next[territoryId];
        }
        return next;
      });
    };

    document.addEventListener("territoryClick", handleTerritoryClick);
    return () => document.removeEventListener("territoryClick", handleTerritoryClick);
  }, [selectedLabelId]);

  // Sync visual state (colors) AND labels when assignments or labels change
  useEffect(() => {
    // 1. Update colors
    Object.entries(pathRefs.current).forEach(([tid, path]) => {
      const labelId = assignments[tid];
      const label = labelId ? labels.find(l => l.id === labelId) : null;

      path.setAttribute("fill", label ? label.color : "#2a2a2a");
      path.setAttribute("fill-opacity", label ? "0.6" : "0.3");
      path.setAttribute("stroke", label ? label.color : "#444444");
      path.setAttribute("stroke-width", label ? "1" : "0.5");
    });

    // 2. Update map labels
    if (!mapRef.current || !labelsLayerRef.current) return;
    labelsLayerRef.current.clearLayers();

    // Group territories by labelId to place one label at group center
    const groups: Record<string, string[]> = {};
    Object.entries(assignments).forEach(([tid, lid]) => {
      if (!groups[lid]) groups[lid] = [];
      groups[lid].push(tid);
    });

    Object.entries(groups).forEach(([lid, tids]) => {
      const config = labels.find(l => l.id === lid);
      if (!config || tids.length === 0) return;

      let sumLat = 0, sumLng = 0, count = 0;
      tids.forEach(tid => {
        const center = centersRef.current[tid];
        if (center) {
          sumLat += center.lat;
          sumLng += center.lng;
          count++;
        }
      });

      if (count > 0) {
        const centerPos: L.LatLngExpression = [sumLat / count, sumLng / count];
        const icon = L.divIcon({
          className: 'map-factions-label',
          html: `
            <div style="
              display: flex;
              align-items: center;
              gap: 10px;
              pointer-events: none;
              color: white;
              font-family: inherit;
              font-size: 13px;
              font-weight: 800;
              text-shadow: 0 2px 4px rgba(0,0,0,0.8);
              white-space: nowrap;
              transform: translate(-50%, -50%);
            ">
              <div style="
                width: 10px;
                height: 10px;
                border-radius: 50%;
                background: ${config.color};
                flex-shrink: 0;
                box-shadow: 0 0 0 2px rgba(255,255,255,1), 0 0 10px ${config.color}, 0 4px 6px rgba(0,0,0,0.5);
              "></div>
              <span style="line-height: 1;">${config.text}</span>
            </div>
          `,
          iconSize: [0, 0],
          iconAnchor: [0, 0]
        });

        L.marker(centerPos, { icon, interactive: false }).addTo(labelsLayerRef.current!);
      }
    });
  }, [assignments, labels, initialPathsReady]);

  // Heartbeat to keep session alive (every 10 minutes)
  useEffect(() => {
    const token = new URLSearchParams(window.location.search).get("token");
    if (!token) return;

    const interval = setInterval(() => {
      fetch(`${API_BASE}/api/map?token=${token}`).catch(() => { });
    }, 1000 * 60 * 10);

    return () => clearInterval(interval);
  }, []);

  const [lastSaved, setLastSaved] = useState<string | null>(null);


  const prevDataRef = useRef<string>("");

  // Sync initial state to ref once loaded
  useEffect(() => {
    if (initialPathsReady) {
      prevDataRef.current = JSON.stringify({ labels, assignments });
    }
  }, [initialPathsReady]);

  // Auto-save logic
  useEffect(() => {
    // Skip if not ready or no save handler
    if (!initialPathsReady || !onSave) return;

    const currentData = JSON.stringify({ labels, assignments });

    // Only save if data actually changed
    if (currentData !== prevDataRef.current) {
      const timer = setTimeout(() => {
        onSave({ currentMapId: null, labels, assignments });
        prevDataRef.current = currentData;
        setLastSaved(new Date().toLocaleTimeString());
        // No toast for auto-saves as requested
      }, 2000);
      return () => clearTimeout(timer);
    }
  }, [assignments, labels, initialPathsReady, onSave]);



  const handleAddLabel = () => {
    const newId = `label-${Date.now()}`;
    setLabels([...labels, {
      id: newId,
      text: "New Label",
      color: "#" + Math.floor(Math.random() * 16777215).toString(16).padStart(6, '0'),
      respect: 0, sectors: 0, rackets: 0
    }]);
  };

  const handleRemoveLabel = (id: string) => {
    setLabels(labels.filter(l => l.id !== id));
    if (selectedLabelId === id) setSelectedLabelId(null);
    setAssignments(prev => {
      const next = { ...prev };
      Object.keys(next).forEach(tid => {
        if (next[tid] === id) delete next[tid];
      });
      return next;
    });
  };

  return (
    <div className="flex h-screen bg-black text-white relative">
      {/* Sidebar */}
      <div className="w-80 border-r border-zinc-800 flex flex-col p-4 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-xl font-bold flex items-center gap-2 uppercase tracking-tight">
              Map Painter
            </h2>
            {lastSaved && (
              <p className="text-[10px] text-zinc-500 font-mono mt-0.5">
                LAST SAVED: {lastSaved}
              </p>
            )}
          </div>
          <div className="flex gap-2">
            {/* Manual save removed as it's automatic now */}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto space-y-4 pr-1 scrollbar-thin">
          <div className="space-y-2">
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs font-semibold uppercase text-zinc-500">Labels</span>
              <button
                onClick={handleAddLabel}
                className="text-[10px] bg-blue-600/20 hover:bg-blue-600/30 text-blue-400 px-2 py-1 rounded border border-blue-500/30 flex items-center gap-1 cursor-pointer transition-colors"
              >
                <Plus size={12} /> Add
              </button>
            </div>

            <div className="space-y-1">
              {/* Eraser */}
              <button
                onClick={() => setSelectedLabelId(null)}
                className={`w-full flex items-center gap-3 p-2 rounded-lg transition-all cursor-pointer ${selectedLabelId === null ? "bg-zinc-800 border border-zinc-700 shadow-inner" : "hover:bg-zinc-900 border border-transparent text-zinc-400"
                  }`}
              >
                <div className={`w-5 h-5 rounded flex items-center justify-center transition-colors ${selectedLabelId === null ? "bg-zinc-700 text-white" : "bg-zinc-800/50"}`}>
                  <Eraser size={14} />
                </div>
                <span className="text-sm font-medium">Erase Assignment</span>
              </button>

              {labels.map((label) => {
                const labelStats = stats[label.id];
                const isExpanded = expandedLabelId === label.id;

                return (
                  <div key={label.id} className="space-y-1">
                    <div
                      className={`group relative flex items-center gap-3 p-2 rounded-lg cursor-pointer transition-all ${selectedLabelId === label.id ? "bg-zinc-800 border border-zinc-700 shadow-lg" : "hover:bg-zinc-900 border border-transparent"
                        }`}
                      onClick={() => setSelectedLabelId(label.id)}
                    >
                      <div
                        className={`w-3 h-3 rounded-full shrink-0 transition-all ${selectedLabelId === label.id ? "scale-125 ring-2 ring-white ring-offset-2 ring-offset-zinc-800" : "group-hover:scale-110 ring-1 ring-white/10"}`}
                        style={{ backgroundColor: label.color }}
                      />
                      <div className="flex-1 min-w-0">
                        <input
                          type="text"
                          value={label.text}
                          onChange={(e) => {
                            setLabels(labels.map(l => l.id === label.id ? { ...l, text: e.target.value } : l));
                          }}
                          className="bg-transparent border-none p-0 text-sm focus:ring-0 w-full font-medium"
                          onClick={(e) => e.stopPropagation()}
                        />
                        <div className="flex gap-2 text-[10px] text-zinc-500 mt-0.5 font-mono uppercase tracking-tight">
                          <span className="flex items-center gap-0.5"><LayoutGrid size={10} /> {labelStats?.count || 0} TTs</span>
                          <span className="flex items-center gap-0.5"><Zap size={10} /> {labelStats?.respect || 0} Respect</span>
                        </div>
                      </div>

                      <div className="flex items-center gap-1">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setExpandedLabelId(isExpanded ? null : label.id);
                          }}
                          className={`p-1 hover:bg-zinc-700 rounded transition-colors cursor-pointer ${isExpanded ? "text-blue-400" : "text-zinc-500"}`}
                        >
                          {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                        </button>
                        <button
                          onClick={(e) => { e.stopPropagation(); handleRemoveLabel(label.id); }}
                          className="opacity-0 group-hover:opacity-100 p-1 hover:text-red-400 transition-opacity cursor-pointer"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </div>

                    {isExpanded && labelStats && (
                      <div className="mx-2 p-3 rounded-b-lg bg-zinc-900/80 border-x border-b border-zinc-800/50 space-y-3 animate-in fade-in slide-in-from-top-1 duration-300">
                        {/* Sector Distribution */}
                        <div className="space-y-1.5">
                          <span className="text-[10px] font-bold text-zinc-600 uppercase tracking-widest">Sector Distribution</span>
                          <div className="flex items-center gap-1.5 font-mono text-[10px]">
                            {[1, 2, 3, 4, 5, 6, 7].map(s => (
                              <div key={s} className="flex flex-col items-center">
                                <span className={`w-4 h-4 flex items-center justify-center rounded-sm transition-colors ${labelStats.sectors[s] > 0 ? "bg-zinc-700 text-zinc-200" : "bg-zinc-800/50 text-zinc-700"}`}>
                                  {labelStats.sectors[s]}
                                </span>
                                <span className="text-[8px] text-zinc-700 mt-1">S{s}</span>
                              </div>
                            ))}
                          </div>
                        </div>

                        {/* Financials */}
                        {labelStats.dailyValue > 0 && (
                          <div className="space-y-1.5">
                            <span className="text-[10px] font-bold text-zinc-600 uppercase tracking-widest">Est. Daily Reward</span>
                            <div className="flex items-center gap-2 text-emerald-400 font-mono text-xs font-bold bg-emerald-500/10 border border-emerald-500/20 rounded-md px-2.5 py-1.5">
                              <DollarSign size={12} className="shrink-0" />
                              <div className="flex flex-col">
                                <span>${(labelStats.dailyValue / 1000000).toFixed(1)}M <span className="text-[10px] text-emerald-500/60 font-medium">/ day</span></span>
                              </div>
                            </div>
                          </div>
                        )}

                        {/* Territories List */}
                        <div className="space-y-1.5">
                          <span className="text-[10px] font-bold text-zinc-600 uppercase tracking-widest">Selected Territories</span>
                          <div className="flex flex-wrap gap-1 max-h-32 overflow-y-auto pr-1 scrollbar-thin">
                            {labelStats.territories.length > 0 ? (
                              labelStats.territories.map(tid => (
                                <span key={tid} className="px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-400 text-[9px] border border-zinc-700/50 hover:border-zinc-500 transition-colors">
                                  {tid}
                                </span>
                              ))
                            ) : (
                              <span className="text-[9px] text-zinc-700 italic">No territories assigned</span>
                            )}
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        <div className="pt-4 border-t border-zinc-800">
          <div className="flex items-center gap-2 text-[10px] text-zinc-500">
            <Info size={14} className="text-blue-500" />
            <span>Select a label then click territories to assign them. Changes are saved automatically.</span>
          </div>
        </div>
      </div>

      {/* Map Space */}
      <div className="flex-1 relative bg-[#050505]">
        <style dangerouslySetInnerHTML={{
          __html: `
          .leaflet-container {
            background: #050505 !important;
            outline: none;
          }
          .torn-svg-overlay {
            filter: drop-shadow(0 0 20px rgba(0,0,0,0.8));
          }
          .leaflet-control-zoom {
            border: 1px solid rgba(255,255,255,0.05) !important;
            background: #111 !important;
            box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06) !important;
          }
          .leaflet-control-zoom-in, .leaflet-control-zoom-out {
            background: #111 !important;
            color: #71717a !important;
            border-bottom: 1px solid rgba(255,255,255,0.05) !important;
            transition: all 0.2s;
            cursor: pointer !important;
          }
          .leaflet-control-zoom-in:hover, .leaflet-control-zoom-out:hover {
            background: #222 !important;
            color: white !important;
          }
          button {
            cursor: pointer !important;
          }
        `}} />
        <div ref={containerRef} className="w-full h-full" />

        {/* Hover Tooltip */}
        {hoveredInfo && (
          <div
            className="fixed z-10000 pointer-events-none bg-zinc-900/95 border border-zinc-700/50 rounded-lg p-2.5 shadow-2xl backdrop-blur-md animate-in fade-in zoom-in-95 duration-100 min-w-[120px]"
            style={{
              left: mousePos.x + 15,
              top: mousePos.y + 15
            }}
          >
            <div className="flex items-center justify-between mb-1.5 border-b border-zinc-800 pb-1.5">
              <span className="text-xs font-bold text-white font-mono uppercase tracking-wider">{hoveredInfo.id}</span>
              <span className="text-[10px] font-mono text-zinc-500 bg-zinc-800 px-1 rounded">S{hoveredInfo.sector}</span>
            </div>
            <div className="space-y-1">
              <div className="flex items-center justify-between gap-4">
                <span className="text-[10px] text-zinc-400 uppercase font-bold">Respect</span>
                <span className="text-xs font-mono font-bold text-blue-400">{hoveredInfo.respect.toLocaleString()}</span>
              </div>
              {hoveredInfo.racket && (
                <div className="flex flex-col gap-0.5 mt-1 border-t border-zinc-800 pt-1">
                  <span className="text-[9px] text-zinc-500 uppercase font-bold tracking-tighter">Active Racket</span>
                  <span className="text-[11px] font-medium text-amber-400">{hoveredInfo.racket}</span>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

