import { Moon, Sun } from "lucide-react"
import { useTheme } from "@/components/theme-provider"
import { Button } from "@/components/ui/button"

export function ModeToggle() {
  const { setTheme } = useTheme()

  const toggleTheme = () => {
    // Explicitly check the current class on the document to ensure the toggle is intuitive
    const isDark = document.documentElement.classList.contains("dark")
    if (isDark) {
      setTheme("light")
    } else {
      setTheme("dark")
    }
  }

  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={toggleTheme}
      className="relative w-10 h-10 rounded-xl hover:bg-secondary/80 transition-all border border-transparent hover:border-border group"
    >
      <Sun className="h-[1.2rem] w-[1.2rem] transition-all scale-100 rotate-0 dark:scale-0 dark:-rotate-90 group-hover:text-primary text-foreground" />
      <Moon className="absolute h-[1.2rem] w-[1.2rem] transition-all scale-0 rotate-90 dark:scale-100 dark:rotate-0 group-hover:text-primary text-foreground" />
      <span className="sr-only">Toggle theme</span>
    </Button>
  )
}
