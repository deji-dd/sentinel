import { Link } from "react-router-dom";
import { AlertCircle, Home } from "lucide-react";

export default function ErrorPage() {
  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-slate-950 text-slate-50 p-6 text-center">
      <div className="max-w-md w-full space-y-8">
        <div className="flex justify-center">
          <div className="w-20 h-20 bg-amber-500/10 border border-amber-500/30 rounded-full flex items-center justify-center animate-pulse">
            <AlertCircle className="w-12 h-12 text-amber-500" />
          </div>
        </div>
        
        <div className="space-y-2">
          <h1 className="text-4xl font-black tracking-tighter text-white">404</h1>
          <h2 className="text-2xl font-bold text-slate-200">Page Not Found</h2>
          <p className="text-slate-400">
            The page you're looking for doesn't exist or has been moved.
          </p>
        </div>

        <div className="pt-4">
          <Link
            to="/"
            className="inline-flex items-center gap-2 px-6 py-3 bg-blue-600 hover:bg-blue-500 text-white font-semibold rounded-xl transition-all hover:scale-105 active:scale-95 shadow-lg shadow-blue-500/20"
          >
            <Home className="w-4 h-4" />
            Back to Safety
          </Link>
        </div>
      </div>
      
      <div className="fixed bottom-8 text-slate-600 text-xs font-mono uppercase tracking-widest">
        Sentinel System Error // Route_Not_Found
      </div>
    </div>
  );
}
