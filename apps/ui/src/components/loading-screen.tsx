export function LoadingScreen() {
  return (
    <div className="h-screen w-full flex flex-col items-center justify-center bg-background text-foreground transition-colors duration-500">
      <div className="flex flex-col items-center gap-8">
        <div className="space-y-2 text-center">
          <p className="text-muted-foreground font-medium tracking-[0.2em] uppercase text-xs animate-pulse">
            Initializing Sentinel
          </p>
          <div className="h-0.5 w-12 bg-primary/20 mx-auto rounded-full overflow-hidden">
            <div className="h-full bg-primary w-1/2 animate-loading" />
          </div>
        </div>
      </div>
    </div>
  )
}
