import { Suspense, lazy } from "react";
import { BrowserRouter, Routes, Route, Navigate, useSearchParams } from "react-router-dom";
import { ShieldAlert, Loader2 } from "lucide-react";

const SelectorPage = lazy(() => import("./pages/SelectorPage"));

function LoadingScreen() {
  return (
    <div className="h-screen flex flex-col items-center justify-center bg-[#0a0a0a] text-white">
      <Loader2 className="w-10 h-10 text-blue-500 animate-spin mb-4" />
      <p className="text-zinc-500 font-medium">Loading Module...</p>
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
    <div className="flex h-screen items-center justify-center bg-[#0a0a0a] text-white p-6">
      <div className="max-w-md w-full text-center space-y-6">
        <div className="w-20 h-20 bg-red-500/10 border border-red-500/30 rounded-2xl flex items-center justify-center mx-auto mb-6">
          <ShieldAlert className="w-10 h-10 text-red-500" />
        </div>
        <h1 className="text-3xl font-bold tracking-tight">Access Denied</h1>
        <p className="text-zinc-400">
          This interface is restricted. Please use the <code className="text-zinc-200 bg-zinc-800 px-1.5 py-0.5 rounded">/tt-selector</code> command in Discord to generate a secure access link.
        </p>
      </div>
    </div>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <Suspense fallback={<LoadingScreen />}>
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/selector" element={<SelectorPage />} />
          {/* Legacy path redirect */}
          <Route path="/painter" element={<Navigate to="/" replace />} />
        </Routes>
      </Suspense>
    </BrowserRouter>
  );
}
