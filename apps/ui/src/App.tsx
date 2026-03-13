import { Suspense, lazy } from "react";
import { BrowserRouter, Routes, Route, Navigate, useSearchParams } from "react-router-dom";
import { Loader2 } from "lucide-react";

const SelectorPage = lazy(() => import("./pages/SelectorPage"));
const ErrorPage = lazy(() => import("./pages/ErrorPage"));

function LoadingScreen() {
  return (
    <div className="h-screen flex flex-col items-center justify-center bg-slate-950 text-white">
      <Loader2 className="w-10 h-10 text-blue-500 animate-spin mb-4" />
      <p className="text-slate-400 font-medium tracking-tight">Loading Module...</p>
    </div>
  );
}

function HomePage() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get("token");

  if (token) {
    return <Navigate to={`/selector?token=${token}`} replace />;
  }

  return (
    <ErrorPage />
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <Suspense fallback={<LoadingScreen />}>
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/selector" element={<SelectorPage />} />

          {/* Catch all */}
          <Route path="*" element={<ErrorPage />} />
        </Routes>
      </Suspense>
    </BrowserRouter>
  );
}
