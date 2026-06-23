import { BrowserRouter, Routes, Route } from "react-router-dom";
import TerritoriesPage from "./pages/TerritoriesPage";
import SelectorPage from "./pages/SelectorPage";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Toaster } from "@/components/ui/sonner";
import ErrorPage from "./pages/ErrorPage";

function App() {
  return (
    <TooltipProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/territories" element={<TerritoriesPage />} />
          <Route path="/selector" element={<SelectorPage />} />
          <Route path="*" element={<ErrorPage />} />
        </Routes>
      </BrowserRouter>
      <Toaster position="top-right" />
    </TooltipProvider>
  );
}

export default App;
