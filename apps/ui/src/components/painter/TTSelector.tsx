"use client";

import { useEffect, useRef, useState, useMemo } from "react";
import * as L from "leaflet";
import "leaflet/dist/leaflet.css";
import { MapPainterState } from "@/types/painter";
import {
  Plus,
  Trash2,
  Info,
  ChevronDown,
  ChevronRight,
  LayoutGrid,
  Zap,
  DollarSign,
  Eye,
  EyeOff,
  Copy,
  AlertTriangle,
} from "lucide-react";
import {
  parseRewardString,
  calculateDailyValue,
} from "@sentinel/shared/racket-reward";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Dialog, DialogContent, DialogHeader } from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogHeader,
} from "@/components/ui/alert-dialog";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Badge } from "@/components/ui/badge";

// @ts-ignore
import tornMapRawSVG from "../../../../../packages/shared/src/assets/torn-territory-map.svg?raw";

const API_BASE = import.meta.env.VITE_API_URL || "http://localhost:3001";

interface TTSelectorProps {
  initialState?: Partial<MapPainterState>;
  onSave?: (state: MapPainterState) => void;
  sessionToken: string;
  territoryData?: Record<
    string,
    {
      sector: number;
      respect: number;
      racket?: { name: string; reward: string; level: number } | null;
    }
  >;
}

const DEFAULT_LABELS = [
  {
    id: "label-1",
    text: "Faction A",
    color: "#3b82f6",
    enabled: true,
    territories: [] as string[],
    respect: 0,
    sectors: 0,
    rackets: 0,
  },
  {
    id: "label-2",
    text: "Faction B",
    color: "#ef4444",
    enabled: true,
    territories: [] as string[],
    respect: 0,
    sectors: 0,
    rackets: 0,
  },
];

const TERRITORY_DEFAULT_FILL = "#2a2a2a";
const TERRITORY_DEFAULT_FILL_OPACITY = "0.55";
const TERRITORY_DEFAULT_STROKE = "#444444";
const TERRITORY_DEFAULT_STROKE_WIDTH = "0.8";
const TERRITORY_ASSIGNED_FILL_OPACITY = "0.72";
const TERRITORY_ASSIGNED_STROKE_WIDTH = "0.9";
const HOVER_TOOLTIP_OFFSET = 8;
const PAINT_SUPPRESS_AFTER_DRAG_MS = 180;

export default function TTSelector({
  initialState,
  onSave,
  sessionToken,
  territoryData,
}: TTSelectorProps) {
  const mapRef = useRef<L.Map | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const pathRefs = useRef<Record<string, SVGPathElement>>({});
  const centersRef = useRef<Record<string, { lat: number; lng: number }>>({});
  const labelsLayerRef = useRef<L.LayerGroup | null>(null);
  const racketsLayerRef = useRef<L.LayerGroup | null>(null);
  const isMapDraggingRef = useRef(false);
  const suppressPaintUntilRef = useRef(0);

  const [selectedLabelId, setSelectedLabelId] = useState<string | null>(
    DEFAULT_LABELS[0].id,
  );
  const [expandedLabelId, setExpandedLabelId] = useState<string | null>(null);
  const [initialPathsReady, setInitialPathsReady] = useState(false);
  const [labels, setLabels] = useState(() => {
    const raw = initialState?.labels || DEFAULT_LABELS;
    return raw.map((l) => ({
      ...l,
      enabled: l.enabled ?? true,
      territories: l.territories || [],
    }));
  });

  // Conflict solver state
  const [conflictData, setConflictData] = useState<{
    labelId: string;
    conflicts: { territoryId: string; currentLabelId: string }[];
  } | null>(null);

  const [hoveredInfo, setHoveredInfo] = useState<{
    id: string;
    sector: number;
    respect: number;
    racket?: string;
  } | null>(null);
  const [mousePos, setMousePos] = useState({ x: 0, y: 0 });

  // Assignments derived from ENABLED labels
  // Note: if multiple labels claim a territory, the one LATER in the labels array wins visually.
  const assignments = useMemo(() => {
    const active: Record<string, string> = {};
    labels
      .filter((l) => l.enabled)
      .forEach((l) => {
        l.territories.forEach((tid) => {
          active[tid] = l.id;
        });
      });
    return active;
  }, [labels]);

  // Stats aggregation
  const stats = useMemo(() => {
    const aggregate: Record<
      string,
      {
        respect: number;
        count: number;
        rackets: number;
        dailyValue: number;
        sectors: Record<number, number>;
        territories: string[];
      }
    > = {};

    labels.forEach((l) => {
      aggregate[l.id] = {
        respect: 0,
        count: 0,
        rackets: 0,
        dailyValue: 0,
        sectors: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0, 7: 0 },
        territories: [],
      };

      const livePrices: Record<string, number> = {
        ...((initialState as any)?.prices?.items || {}),
        Points: (initialState as any)?.prices?.points || 0,
      };

      l.territories.forEach((territoryId) => {
        const metadata =
          territoryData?.[territoryId] ||
          initialState?.territoryMetadata?.[territoryId];
        aggregate[l.id].count += 1;
        aggregate[l.id].respect += metadata?.respect || 0;
        aggregate[l.id].territories.push(territoryId);

        if (metadata?.sector) {
          aggregate[l.id].sectors[metadata.sector] =
            (aggregate[l.id].sectors[metadata.sector] || 0) + 1;
        }

        if (metadata?.racket) {
          aggregate[l.id].rackets += 1;
          const rewardInfo = parseRewardString(metadata.racket.reward);
          aggregate[l.id].dailyValue += calculateDailyValue(
            rewardInfo,
            livePrices,
          );
        }
      });
    });

    return aggregate;
  }, [labels, territoryData, initialState?.territoryMetadata]);

  // Initialization
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const bounds: L.LatLngBoundsExpression = [
      [0, 0],
      [912, 1564],
    ];

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

    map.on("dragstart", () => {
      isMapDraggingRef.current = true;
    });
    map.on("dragend", () => {
      isMapDraggingRef.current = false;
      suppressPaintUntilRef.current = Date.now() + PAINT_SUPPRESS_AFTER_DRAG_MS;
    });

    // Initial view: Zoomed in on a central region but showing a good portion
    map.setView([456, 782], -0.2);

    // Create SVG Element from raw string
    let svgElement: SVGElement | null = null;
    try {
      if (!tornMapRawSVG || typeof tornMapRawSVG !== "string") {
        throw new Error(
          `Invalid tornMapRawSVG import. Type: ${typeof tornMapRawSVG}`,
        );
      }

      // Fix for "Namespace prefix xlink for href on image is not defined"
      let processedSVG = tornMapRawSVG;
      if (
        processedSVG.includes("xlink:href") &&
        !processedSVG.includes("xmlns:xlink")
      ) {
        // More robust replacement for different svg tag formats
        processedSVG = processedSVG.replace(
          /<svg\s/i,
          '<svg xmlns:xlink="http://www.w3.org/1999/xlink" ',
        );
      }

      const parser = new DOMParser();
      const doc = parser.parseFromString(processedSVG, "image/svg+xml");
      const parserError = doc.querySelector("parsererror");

      if (parserError) {
        throw new Error(`SVG Parsing Failed: ${parserError.textContent}`);
      }

      const rootNode = doc.documentElement;
      if (!rootNode || rootNode.nodeName.toLowerCase() !== "svg") {
        throw new Error("Could not find SVG element in parsed document");
      }

      // Create a NATIVE SVG element in our document context
      // This is more robust than adoptNode for Leaflet's style/transform manipulation
      svgElement = document.createElementNS(
        "http://www.w3.org/2000/svg",
        "svg",
      );
      svgElement.innerHTML = rootNode.innerHTML;

      // Copy relevant attributes
      for (const attr of rootNode.attributes) {
        if (
          ["viewbox", "xmlns", "preserveaspectratio"].includes(
            attr.name.toLowerCase(),
          )
        ) {
          svgElement.setAttribute(attr.name, attr.value);
        }
      }

      // Clean up and standardize
      svgElement.removeAttribute("style");
      svgElement.removeAttribute("width");
      svgElement.removeAttribute("height");
      svgElement.classList.remove("leaflet-zoom-hide");
      svgElement.setAttribute("viewBox", "0 0 1564 912");

      // Remove embedded stylesheet rules so territory colors are fully controlled by component state.
      svgElement
        .querySelectorAll("style")
        .forEach((styleEl) => styleEl.remove());

      const defs = svgElement.querySelector("defs");
      if (defs) defs.innerHTML = ""; // Remove patterns/textures that obscure colors
    } catch (err) {
      console.error("[TTSelector] Map Initialization Error (SVG):", err);
      return;
    }

    // Map overlay natively drawing the SVG inside leaflet.
    // Keep it hidden until path initialization is complete to avoid first-frame color flash.
    try {
      if (!svgElement || !mapRef.current) return;

      svgElement.style.opacity = "0";
      svgElement.style.transition = "opacity 120ms ease-out";

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

        // Remove inherited svg classes/styles to avoid stylesheet specificity overriding runtime colors.
        path.removeAttribute("class");
        path.removeAttribute("style");

        // Use the internal identifier that matches assignments
        const territoryId = label || dbId;

        // Base style
        path.setAttribute("fill", TERRITORY_DEFAULT_FILL);
        path.setAttribute("fill-opacity", TERRITORY_DEFAULT_FILL_OPACITY);
        path.setAttribute("stroke", TERRITORY_DEFAULT_STROKE);
        path.setAttribute("stroke-width", TERRITORY_DEFAULT_STROKE_WIDTH);
        path.style.fill = TERRITORY_DEFAULT_FILL;
        path.style.fillOpacity = TERRITORY_DEFAULT_FILL_OPACITY;
        path.style.stroke = TERRITORY_DEFAULT_STROKE;
        path.style.strokeWidth = TERRITORY_DEFAULT_STROKE_WIDTH;
        path.style.cursor = "pointer";

        // Interaction
        path.addEventListener("click", (e) => {
          e.stopPropagation();

          // Guard: ignore clicks that happen while/just after dragging the map.
          if (
            isMapDraggingRef.current ||
            Date.now() < suppressPaintUntilRef.current
          ) {
            return;
          }

          document.dispatchEvent(
            new CustomEvent("territoryClick", { detail: { territoryId } }),
          );
        });

        path.addEventListener("mouseenter", (_e) => {
          if (blueprint) {
            setHoveredInfo({
              id: territoryId,
              sector: blueprint.sector,
              respect: blueprint.respect,
              racket: blueprint.racket?.name,
            });
          }
        });

        path.addEventListener("mousemove", (e) => {
          const rect = containerRef.current?.getBoundingClientRect();
          if (!rect) {
            setMousePos({ x: e.clientX, y: e.clientY });
            return;
          }

          setMousePos({ x: e.clientX - rect.left, y: e.clientY - rect.top });
        });

        path.addEventListener("mouseleave", () => {
          setHoveredInfo(null);
        });

        // Label metadata
        if (blueprint) {
          // Prevent browser-native SVG tooltips so only the custom hover card is shown.
          path.querySelectorAll("title").forEach((titleEl) => titleEl.remove());

          // Cache center for map labels
          try {
            const bbox = path.getBBox();
            centersRef.current[territoryId] = {
              lat: 912 - (bbox.y + bbox.height / 2),
              lng: bbox.x + bbox.width / 2,
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

          const racketDot = document.createElementNS(
            "http://www.w3.org/2000/svg",
            "circle",
          );
          racketDot.setAttribute("cx", cx.toString());
          racketDot.setAttribute("cy", cy.toString());
          racketDot.setAttribute("r", "2.0");
          racketDot.setAttribute("fill", "#fbbf24");
          racketDot.setAttribute("stroke", "#000");
          racketDot.setAttribute("stroke-width", "0.5");
          racketDot.classList.add("racket-dot");
          racketDot.style.pointerEvents = "none";

          // Subtle glow circle (static)
          const glow = document.createElementNS(
            "http://www.w3.org/2000/svg",
            "circle",
          );
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
      map.on("zoom", () => {
        const zoom = map.getZoom();
        // We want the dot to stay a consistent visual size
        // Scale factor: roughly 2 ^ (-zoom)
        const scale = Math.pow(2, -zoom);
        const dotRadius = 2.0 * scale;
        const glowRadius = 4.0 * scale;

        document.querySelectorAll(".racket-dot").forEach((el) => {
          el.setAttribute("r", dotRadius.toString());
          el.setAttribute("stroke-width", (0.5 * scale).toString());
        });
        document.querySelectorAll(".racket-glow").forEach((el) => {
          el.setAttribute("r", glowRadius.toString());
        });
      });

      svgElement.style.opacity = "1";
      setInitialPathsReady(true);
      // Trigger an initial label draw
      document.dispatchEvent(new CustomEvent("refreshLabels"));
    } catch (err) {
      console.error("[TTSelector] Leaflet svgOverlay Error:", err);
    }

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
      if (!labelId) return;

      setLabels((prev) => {
        const selectedLabel = prev.find((l) => l.id === labelId);
        if (!selectedLabel) return prev;

        // Clicking an assigned territory in the selected label unpaints it.
        if (selectedLabel.territories.includes(territoryId)) {
          return prev.map((l) =>
            l.id === labelId
              ? {
                  ...l,
                  territories: l.territories.filter(
                    (tid) => tid !== territoryId,
                  ),
                }
              : l,
          );
        }

        // Guard: cannot paint over a territory assigned to another label.
        const existingOwner = prev.find(
          (l) => l.id !== labelId && l.territories.includes(territoryId),
        );
        if (existingOwner) {
          toast.error(
            `Territory ${territoryId} is already assigned to ${existingOwner.text}.`,
          );
          return prev;
        }

        return prev.map((l) =>
          l.id === labelId
            ? { ...l, territories: [...l.territories, territoryId] }
            : l,
        );
      });
    };

    document.addEventListener("territoryClick", handleTerritoryClick);
    return () =>
      document.removeEventListener("territoryClick", handleTerritoryClick);
  }, [selectedLabelId]);

  // Sync visual state (colors) AND labels when assignments or labels change
  useEffect(() => {
    // 1. Update colors
    Object.entries(pathRefs.current).forEach(([tid, path]) => {
      const labelId = assignments[tid];
      const label = labelId ? labels.find((l) => l.id === labelId) : null;
      const fill = label ? label.color : TERRITORY_DEFAULT_FILL;
      const fillOpacity = label
        ? TERRITORY_ASSIGNED_FILL_OPACITY
        : TERRITORY_DEFAULT_FILL_OPACITY;
      const stroke = label ? label.color : TERRITORY_DEFAULT_STROKE;
      const strokeWidth = label
        ? TERRITORY_ASSIGNED_STROKE_WIDTH
        : TERRITORY_DEFAULT_STROKE_WIDTH;

      path.setAttribute("fill", fill);
      path.setAttribute("fill-opacity", fillOpacity);
      path.setAttribute("stroke", stroke);
      path.setAttribute("stroke-width", strokeWidth);

      // Mirror to inline styles so external/inherited SVG selectors can't mute runtime colors.
      path.style.fill = fill;
      path.style.fillOpacity = fillOpacity;
      path.style.stroke = stroke;
      path.style.strokeWidth = strokeWidth;
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
      const config = labels.find((l) => l.id === lid);
      if (!config || tids.length === 0) return;

      const ownedCenters = tids
        .map((tid) => centersRef.current[tid])
        .filter((center): center is { lat: number; lng: number } => !!center);

      if (ownedCenters.length > 0) {
        const centroid = ownedCenters.reduce(
          (acc, center) => {
            acc.lat += center.lat;
            acc.lng += center.lng;
            return acc;
          },
          { lat: 0, lng: 0 },
        );
        centroid.lat /= ownedCenters.length;
        centroid.lng /= ownedCenters.length;

        // Keep labels on owned territories by snapping centroid to the nearest owned TT center.
        let anchor = ownedCenters[0];
        let bestDistance = Number.POSITIVE_INFINITY;
        ownedCenters.forEach((center) => {
          const dLat = center.lat - centroid.lat;
          const dLng = center.lng - centroid.lng;
          const distSq = dLat * dLat + dLng * dLng;
          if (distSq < bestDistance) {
            bestDistance = distSq;
            anchor = center;
          }
        });

        const centerPos: L.LatLngExpression = [anchor.lat, anchor.lng];
        const icon = L.divIcon({
          className: "map-factions-label",
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
          iconAnchor: [0, 0],
        });

        L.marker(centerPos, { icon, interactive: false }).addTo(
          labelsLayerRef.current!,
        );
      }
    });
  }, [assignments, labels, initialPathsReady]);

  // Heartbeat to keep session alive (every 10 minutes)
  useEffect(() => {
    const token = new URLSearchParams(window.location.search).get("token");
    if (!token) return;

    const interval = setInterval(
      () => {
        fetch(`${API_BASE}/api/map?token=${token}`).catch(() => {});
      },
      1000 * 60 * 10,
    );

    return () => clearInterval(interval);
  }, []);

  const [lastSaved, setLastSaved] = useState<string | null>(null);

  const prevDataRef = useRef<string>("");

  // Sync initial state to ref once loaded
  useEffect(() => {
    if (initialPathsReady) {
      prevDataRef.current = JSON.stringify({ labels });
    }
  }, [initialPathsReady]);

  // Auto-save logic
  useEffect(() => {
    // Skip if not ready or no save handler
    if (!initialPathsReady || !onSave) return;

    const currentData = JSON.stringify({ labels });

    // Only save if data actually changed
    if (currentData !== prevDataRef.current) {
      const timer = setTimeout(async () => {
        try {
          if (onSave) {
            await (onSave as any)({ currentMapId: null, labels, assignments });
            prevDataRef.current = currentData;
            setLastSaved(new Date().toLocaleTimeString());
          }
        } catch (err) {
          console.error("[TTSelector] Auto-save failed:", err);
        }
      }, 2000);
      return () => clearTimeout(timer);
    }
  }, [assignments, labels, initialPathsReady, onSave]);

  const handleAddLabel = () => {
    const newId = `label-${Date.now()}`;
    setLabels([
      ...labels,
      {
        id: newId,
        text: "New Label",
        color:
          "#" +
          Math.floor(Math.random() * 16777215)
            .toString(16)
            .padStart(6, "0"),
        enabled: true,
        territories: [],
        respect: 0,
        sectors: 0,
        rackets: 0,
      },
    ]);
  };

  const handleRemoveLabel = (id: string) => {
    const nextLabels = labels.filter((l) => l.id !== id);
    setLabels(nextLabels);
    if (selectedLabelId === id) setSelectedLabelId(nextLabels[0]?.id ?? null);
  };

  const handleToggleLabel = (id: string) => {
    const label = labels.find((l) => l.id === id);
    if (!label) return;

    // If we're enabling, check for conflicts
    if (!label.enabled) {
      const conflicts: { territoryId: string; currentLabelId: string }[] = [];
      label.territories.forEach((tid) => {
        // If it's currently assigned to an ENABLED label other than this one
        const currentOwnerId = assignments[tid];
        if (currentOwnerId && currentOwnerId !== id) {
          conflicts.push({ territoryId: tid, currentLabelId: currentOwnerId });
        }
      });

      if (conflicts.length > 0) {
        setConflictData({ labelId: id, conflicts });
        return;
      }
    }

    setLabels((prev) =>
      prev.map((l) => (l.id === id ? { ...l, enabled: !l.enabled } : l)),
    );
  };

  const resolveConflicts = (takeOver: boolean) => {
    if (!conflictData) return;
    const { labelId, conflicts } = conflictData;

    setLabels((prev) =>
      prev.map((l) => {
        // Enable the target label
        if (l.id === labelId) {
          return { ...l, enabled: true };
        }

        // If taking over, remove territories from their previous owners
        if (takeOver) {
          const conflictingIds = new Set(conflicts.map((c) => c.territoryId));
          const filtered = l.territories.filter(
            (tid) => !conflictingIds.has(tid),
          );
          if (filtered.length !== l.territories.length) {
            return { ...l, territories: filtered };
          }
        }

        return l;
      }),
    );

    setConflictData(null);
  };

  const [showDuplicateModal, setShowDuplicateModal] = useState(false);
  const [duplicateTitle, setDuplicateTitle] = useState("");
  const [isDuplicating, setIsDuplicating] = useState(false);

  const handleDuplicateMap = async () => {
    if (!duplicateTitle) return;
    setIsDuplicating(true);
    try {
      const mapId = new URLSearchParams(window.location.search).get("mapId");
      if (!mapId) throw new Error("Missing map ID");

      const res = await fetch(`${API_BASE}/api/map/${mapId}/duplicate`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${sessionToken}`,
        },
        body: JSON.stringify({ name: duplicateTitle }),
      });
      const data = await res.json();
      if (data.success && data.mapId) {
        window.open(`/selector?mapId=${data.mapId}`, "_blank");
        setShowDuplicateModal(false);
        setDuplicateTitle("");
      }
    } catch (err) {
      console.error("Failed to duplicate map:", err);
      toast.error("Failed to duplicate configuration");
    } finally {
      setIsDuplicating(false);
    }
  };

  const handleDuplicateLabel = (label: (typeof labels)[0]) => {
    const newId = `label-${Date.now()}`;
    setLabels([
      ...labels,
      {
        ...label,
        id: newId,
        text: `${label.text} (Copy)`,
        enabled: true, // Default enabled on copy
      },
    ]);
  };

  return (
    <TooltipProvider>
      <div className="flex h-screen bg-[#050505] text-zinc-200 relative isolate">
        {/* Sidebar */}
        <div className="w-80 border-r border-white/5 flex flex-col p-4 space-y-4 shadow-2xl bg-[#0a0a0a] relative z-30 shrink-0">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-xl font-bold flex items-center gap-2 uppercase tracking-tight">
                Map Painter
              </h2>
              <div className="flex items-center gap-2">
                {lastSaved && (
                  <p className="text-[10px] text-zinc-500 font-mono mt-0.5">
                    LAST SAVED: {lastSaved}
                  </p>
                )}
              </div>
            </div>
            <div className="flex gap-2">
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => {
                      setDuplicateTitle(
                        `${initialState?.map?.name || "New Map"} (Copy)`,
                      );
                      setShowDuplicateModal(true);
                    }}
                    className="h-8 w-8 hover:bg-zinc-800/50 text-zinc-500 hover:text-white border border-transparent hover:border-white/10"
                  >
                    <Copy size={16} />
                  </Button>
                </TooltipTrigger>
                <TooltipContent className="bg-zinc-900 border-white/10 text-white text-[10px]">
                  Duplicate Map
                </TooltipContent>
              </Tooltip>
            </div>
          </div>

          <ScrollArea className="flex-1 pr-4">
            <div className="space-y-4">
              <div className="space-y-2">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-bold uppercase tracking-widest text-zinc-500">
                    Labels
                  </span>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={handleAddLabel}
                    className="h-7 px-3 text-[10px] bg-white/5 hover:bg-white/10 text-white border-white/5 hover:border-white/10 font-bold uppercase tracking-tight"
                  >
                    <Plus size={12} className="mr-1.5" /> Add Label
                  </Button>
                </div>

                <div className="space-y-1">
                  {labels.map((label) => {
                    const labelStats = stats[label.id];
                    const isExpanded = expandedLabelId === label.id;

                    return (
                      <div key={label.id} className="group flex flex-col">
                        <div
                          className={`flex flex-col p-3 rounded-xl transition-all cursor-pointer border ${
                            selectedLabelId === label.id
                              ? "bg-zinc-800/40 border-white/10 shadow-2xl ring-1 ring-white/5"
                              : "bg-transparent border-transparent hover:bg-white/2 hover:border-white/5"
                          }`}
                          onClick={() => setSelectedLabelId(label.id)}
                        >
                          {/* Row 1: Name Input Row */}
                          <div className="flex items-center gap-3 mb-2.5">
                            <div
                              className={`w-3 h-3 rounded-full shrink-0 shadow-lg ${selectedLabelId === label.id ? "ring-2 ring-white/20" : "ring-1 ring-white/5"}`}
                              style={{ backgroundColor: label.color }}
                            />
                            <Input
                              type="text"
                              value={label.text}
                              onChange={(e) => {
                                setLabels(
                                  labels.map((l) =>
                                    l.id === label.id
                                      ? { ...l, text: e.target.value }
                                      : l,
                                  ),
                                );
                              }}
                              className={
                                "border-none bg-muted/5! focus-visible:ring-0 w-full font-bold text-white"
                              }
                              onClick={(e) => e.stopPropagation()}
                              disabled={!label.enabled}
                            />

                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleToggleLabel(label.id);
                              }}
                              className={`hover:bg-muted/10! ${label.enabled ? "text-blue-400" : "text-zinc-600"}`}
                            >
                              {label.enabled ? (
                                <Eye size={14} />
                              ) : (
                                <EyeOff size={14} />
                              )}
                            </Button>
                          </div>

                          {/* Row 2: Actions & Stats */}
                          <div className="flex items-center justify-between border-t border-white/3 pt-2.5">
                            <div className="flex gap-1.5 text-[11px] text-zinc-500 font-mono uppercase tracking-widest font-bold">
                              <span className="flex items-center gap-1 bg-white/3 px-1.5 py-0.5 rounded text-zinc-400">
                                <LayoutGrid
                                  size={13}
                                  className="text-zinc-600"
                                />{" "}
                                {labelStats?.count || 0}
                              </span>
                              <span className="flex items-center gap-1 bg-white/3 px-1.5 py-0.5 rounded text-zinc-400">
                                <Zap size={13} className="text-zinc-600" />{" "}
                                {labelStats?.respect || 0}
                              </span>
                            </div>

                            <div className="flex items-center gap-0.5">
                              <Button
                                variant="ghost"
                                size="icon"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleDuplicateLabel(label);
                                }}
                                className="text-zinc-500 hover:text-blue-400 hover:bg-muted/10! transition-all"
                              >
                                <Copy size={13} />
                              </Button>

                              <Button
                                variant="ghost"
                                size="icon"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setExpandedLabelId(
                                    isExpanded ? null : label.id,
                                  );
                                }}
                                className={`transition-all hover:bg-muted/10! ${isExpanded ? "text-white" : "text-zinc-500 hover:text-white"}`}
                              >
                                {isExpanded ? (
                                  <ChevronDown size={13} />
                                ) : (
                                  <ChevronRight size={13} />
                                )}
                              </Button>

                              <Button
                                variant="ghost"
                                size="icon"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleRemoveLabel(label.id);
                                }}
                                className="text-zinc-500 hover:text-red-400 hover:bg-muted/10! transition-all"
                              >
                                <Trash2 size={13} />
                              </Button>
                            </div>
                          </div>
                        </div>

                        {/* Row 3: Expanded stats area */}
                        {isExpanded && labelStats && (
                          <div className="p-3 rounded-b-xl bg-black/40 border-x border-b border-white/5 space-y-3 animate-in fade-in slide-in-from-top-2 duration-300">
                            {/* Sector Distribution */}
                            <div className="space-y-2">
                              <span className="text-[10px] font-bold text-zinc-600 uppercase tracking-[0.2em]">
                                Sector Distribution
                              </span>
                              <div className="flex items-center gap-1 font-mono text-[10px]">
                                {[1, 2, 3, 4, 5, 6, 7].map((s) => (
                                  <div
                                    key={s}
                                    className="flex flex-col items-center gap-1"
                                  >
                                    <span
                                      className={`w-4 h-4 flex items-center justify-center rounded transition-colors ${labelStats.sectors[s] > 0 ? "bg-white/10 text-white font-bold" : "bg-white/2 text-zinc-700"}`}
                                    >
                                      {labelStats.sectors[s]}
                                    </span>
                                    <span className="text-[9px] text-zinc-700 font-bold">
                                      S{s}
                                    </span>
                                  </div>
                                ))}
                              </div>
                            </div>

                            {/* Financials */}
                            {labelStats.dailyValue > 0 && (
                              <div className="space-y-1.5">
                                <span className="text-[10px] font-bold text-zinc-600 uppercase tracking-[0.2em]">
                                  Estimated Daily
                                </span>
                                <div className="flex items-center gap-2 text-emerald-400 font-mono text-[11px] font-bold bg-emerald-500/5 border border-emerald-500/10 rounded-lg px-2.5 py-1.5">
                                  <DollarSign size={13} className="shrink-0" />
                                  <span>
                                    {(labelStats.dailyValue / 1000000).toFixed(
                                      2,
                                    )}
                                    M{" "}
                                    <span className="text-[11px] opacity-40">
                                      / day
                                    </span>
                                  </span>
                                </div>
                              </div>
                            )}

                            {/* Territories List */}
                            <div className="space-y-1.5">
                              <span className="text-[10px] font-bold text-zinc-600 uppercase tracking-[0.2em]">
                                Selected Territories
                              </span>
                              <ScrollArea className="h-28 pr-2">
                                <div className="flex flex-wrap gap-1">
                                  {labelStats.territories.length > 0 ? (
                                    labelStats.territories.map((tid) => (
                                      <span
                                        key={tid}
                                        className="px-1.5 py-0.5 rounded-md bg-white/3 text-zinc-400 text-[9px] font-mono border border-white/5 hover:border-white/10 transition-colors"
                                      >
                                        {tid}
                                      </span>
                                    ))
                                  ) : (
                                    <span className="text-[9px] text-zinc-700 italic">
                                      No assignments
                                    </span>
                                  )}
                                </div>
                              </ScrollArea>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </ScrollArea>

          <div className="pt-4 border-t border-white/5">
            <div className="flex items-center gap-2 text-[10px] text-zinc-500">
              <Info size={14} className="text-blue-400" />
              <span>
                Select a label and click a territory to paint. Click the same
                territory again to unpaint. You cannot paint over territories
                owned by another label.
              </span>
            </div>
          </div>
        </div>

        {/* Map Space */}
        <div className="flex-1 relative bg-[#050505] z-0 overflow-hidden">
          <style
            dangerouslySetInnerHTML={{
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
          `,
            }}
          />
          <div
            ref={containerRef}
            className={`w-full h-full transition-opacity duration-150 ${initialPathsReady ? "opacity-100" : "opacity-0"}`}
          />
          {!initialPathsReady && (
            <div className="absolute inset-0 flex items-center justify-center bg-[#050505] pointer-events-none">
              <div className="text-[11px] uppercase tracking-[0.2em] text-zinc-500 font-bold">
                Loading map...
              </div>
            </div>
          )}

          {/* Hover Tooltip */}
          {hoveredInfo && (
            <div
              className="absolute z-1200 pointer-events-none bg-[#0a0a0a] border border-white/10 rounded-lg p-2.5 shadow-2xl animate-in fade-in zoom-in-95 duration-100 min-w-30"
              style={{
                left: mousePos.x,
                top: mousePos.y,
                transform: `translate(${HOVER_TOOLTIP_OFFSET}px, ${HOVER_TOOLTIP_OFFSET}px)`,
              }}
            >
              <div className="flex items-center justify-between mb-1.5 border-b border-zinc-800 pb-1.5">
                <span className="text-xs font-bold text-white font-mono uppercase tracking-wider">
                  {hoveredInfo.id}
                </span>
                <span className="text-[10px] font-mono text-zinc-500 bg-zinc-800 px-1 rounded">
                  S{hoveredInfo.sector}
                </span>
              </div>
              <div className="space-y-1">
                <div className="flex items-center justify-between gap-4">
                  <span className="text-[10px] text-zinc-400 uppercase font-bold">
                    Respect
                  </span>
                  <span className="text-xs font-mono font-bold text-blue-400">
                    {hoveredInfo.respect.toLocaleString()}
                  </span>
                </div>
                {hoveredInfo.racket && (
                  <div className="flex flex-col gap-0.5 mt-1 border-t border-zinc-800 pt-1">
                    <span className="text-[9px] text-zinc-500 uppercase font-bold tracking-tighter">
                      Active Racket
                    </span>
                    <span className="text-[11px] font-medium text-amber-400">
                      {hoveredInfo.racket}
                    </span>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Conflict Resolver Modal */}
        <AlertDialog
          open={!!conflictData}
          onOpenChange={() => setConflictData(null)}
        >
          <AlertDialogContent className="bg-[#0d0d0d] border-white/10 text-white overflow-hidden min-w-110">
            <AlertDialogHeader className="p-4 border-b border-white/5 bg-black/20 flex-row items-center justify-between space-y-0">
              <div className="flex items-center gap-2 text-amber-500 font-bold uppercase tracking-tight text-sm">
                <AlertTriangle size={18} />
                Conflict Detected
              </div>
            </AlertDialogHeader>

            <div className="p-6 space-y-4">
              <AlertDialogDescription className="text-sm text-zinc-400 leading-relaxed">
                The label you are enabling has territories that are already
                assigned to other
                <span className="text-white font-semibold"> active labels</span>
                . How would you like to proceed?
              </AlertDialogDescription>

              <div className="bg-black/50 rounded-lg p-3 border border-white/5 max-h-40 overflow-y-auto scrollbar-thin">
                <div className="space-y-2">
                  {conflictData?.conflicts.map((c, i) => (
                    <div
                      key={i}
                      className="flex items-center justify-between text-[11px] font-mono"
                    >
                      <span className="text-blue-400 font-bold">
                        {c.territoryId}
                      </span>
                      <div className="flex items-center gap-1.5 text-zinc-500">
                        <span>Managed by</span>
                        <Badge
                          variant="outline"
                          className="px-1.5 py-0 border-none text-white text-[10px] h-4"
                          style={{
                            backgroundColor:
                              labels.find((l) => l.id === c.currentLabelId)
                                ?.color || "#333",
                          }}
                        >
                          {labels.find((l) => l.id === c.currentLabelId)
                            ?.text || "Unknown"}
                        </Badge>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3 pt-2">
                <Button
                  variant="outline"
                  onClick={() => resolveConflicts(false)}
                  className="bg-zinc-800 hover:bg-zinc-700 text-zinc-200 border-white/10 hover:border-white/20 h-auto py-2.5 flex flex-col items-center"
                >
                  <span>Enable Anyway</span>
                  <span className="text-[10px] text-zinc-500 font-normal">
                    Keep existing owners
                  </span>
                </Button>
                <Button
                  onClick={() => resolveConflicts(true)}
                  className="bg-blue-600 hover:bg-blue-500 text-white h-auto py-2.5 flex flex-col items-center"
                >
                  <span>Take Control</span>
                  <span className="text-[10px] text-blue-100/60 font-normal">
                    Move to this label
                  </span>
                </Button>
              </div>
            </div>
            <div className="px-6 py-4 bg-black/20 border-t border-white/5 text-center">
              <Button
                variant="link"
                onClick={() => setConflictData(null)}
                className="text-xs text-zinc-600 hover:text-zinc-400 h-auto p-0"
              >
                Cancel Operation
              </Button>
            </div>
          </AlertDialogContent>
        </AlertDialog>

        {/* Map Duplication Modal */}
        <Dialog open={showDuplicateModal} onOpenChange={setShowDuplicateModal}>
          <DialogContent className="bg-[#0d0d0d] border-white/10 text-white p-0 overflow-hidden w-100">
            <DialogHeader className="p-4 border-b border-white/5 bg-black/20 flex-row items-center justify-between space-y-0">
              <div className="flex items-center gap-2 text-blue-400 font-bold uppercase tracking-tight text-sm">
                <Copy size={18} />
                Duplicate Configuration
              </div>
            </DialogHeader>

            <div className="p-6 space-y-4">
              <div className="space-y-1.5">
                <label className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest">
                  New Title
                </label>
                <Input
                  autoFocus
                  value={duplicateTitle}
                  onChange={(e) => setDuplicateTitle(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleDuplicateMap()}
                  className="bg-black border-white/10 text-white focus-visible:ring-blue-500"
                  placeholder="Enter new configuration title..."
                />
              </div>

              <div className="grid grid-cols-2 gap-3 pt-2">
                <Button
                  variant="ghost"
                  onClick={() => setShowDuplicateModal(false)}
                  className="text-zinc-500 hover:text-white"
                >
                  Cancel
                </Button>
                <Button
                  disabled={!duplicateTitle || isDuplicating}
                  onClick={handleDuplicateMap}
                  className="bg-blue-600 hover:bg-blue-500 text-white shadow-lg shadow-blue-900/20"
                >
                  {isDuplicating ? "Duplicating..." : "Duplicate"}
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      </div>
    </TooltipProvider>
  );
}
