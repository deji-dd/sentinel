import { useState } from "react";
import { AlertTriangle, MapPin, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert";

interface UnmappedArea {
  id: string;
  first_seen: number;
}

interface UnmappedAreasProps {
  unmappedAreas: UnmappedArea[];
  onMapped: () => void;
}

const COUNTRY_NAMES: Record<string, string> = {
  torn: "Torn City",
  mex: "Mexico",
  cay: "Cayman Islands",
  can: "Canada",
  haw: "Hawaii",
  uni: "United Kingdom",
  arg: "Argentina",
  swi: "Switzerland",
  jap: "Japan",
  chi: "China",
  uae: "UAE",
  sou: "South Africa"
};

export function UnmappedAreas({ unmappedAreas, onMapped }: UnmappedAreasProps) {
  const [selections, setSelections] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);

  if (!unmappedAreas || unmappedAreas.length === 0) return null;

  const handleMap = async (areaId: string) => {
    const yataCode = selections[areaId];
    if (!yataCode) return;

    setSubmitting(true);
    try {
      await fetch("/api/travel/map", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ areaId, yataCode }),
      });
      
      const newSelections = { ...selections };
      delete newSelections[areaId];
      setSelections(newSelections);
      
      onMapped();
    } catch (e) {
      console.error("Failed to map area", e);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Alert variant="destructive" className="border-amber-500/50 bg-amber-500/10 text-amber-500 mb-6 font-mono rounded-none">
      <AlertTriangle className="size-4 !text-amber-500" />
      <AlertTitle className="uppercase tracking-[0.2em] text-[10px] mb-2 font-bold">Unmapped Destinations Detected</AlertTitle>
      <AlertDescription className="text-xs">
        <p className="mb-4 text-amber-500/80">
          The system intercepted travel logs to unknown Area IDs. Please map them below to track profit.
        </p>
        <div className="space-y-3">
          {unmappedAreas.map(area => (
            <div key={area.id} className="flex flex-col sm:flex-row gap-3 items-start sm:items-center p-3 bg-background/50 border border-amber-500/20">
              <div className="flex items-center gap-2 flex-1 min-w-0 text-amber-500">
                <MapPin className="size-4 shrink-0" />
                <span className="truncate">Area ID: {area.id}</span>
              </div>
              <div className="flex items-center gap-2 w-full sm:w-auto">
                <Select
                  value={selections[area.id] || ""}
                  onValueChange={(val) => setSelections({ ...selections, [area.id]: val as string })}
                >
                  <SelectTrigger className="w-[180px] h-8 text-xs bg-background border-amber-500/20 text-amber-500">
                    <SelectValue placeholder="Select Destination" />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(COUNTRY_NAMES).map(([code, name]) => (
                      <SelectItem key={code} value={code} className="text-xs">
                        {name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button 
                  size="sm" 
                  variant="outline" 
                  onClick={() => handleMap(area.id)}
                  disabled={!selections[area.id] || submitting}
                  className="h-8 border-amber-500/20 hover:bg-amber-500/10 hover:text-amber-500 text-amber-500 bg-transparent"
                >
                  <Save className="size-3 mr-2" />
                  Map
                </Button>
              </div>
            </div>
          ))}
        </div>
      </AlertDescription>
    </Alert>
  );
}
