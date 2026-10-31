import { useEffect, useState } from "react";
import { Moon, Sun } from "lucide-react";
import { Button } from "~/components/ui/button";

export const THEME_OVERRIDE_KEY = "spending-snapshot-theme-override";

// Runs before first paint: follow the browser preference unless a dev override is set.
export const themeInitScript = `(function(){var m=matchMedia("(prefers-color-scheme: dark)");var r=document.documentElement;function a(){var o=null;try{o=localStorage.getItem("${THEME_OVERRIDE_KEY}")}catch(e){}r.dataset.theme=o==="light"||o==="dark"?o:m.matches?"dark":"light"}a();m.addEventListener("change",a)})();`;

type Theme = "light" | "dark";

export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>("light");

  useEffect(() => {
    setTheme(
      document.documentElement.dataset.theme === "dark" ? "dark" : "light",
    );
  }, []);

  const toggle = () => {
    const next: Theme = theme === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    try {
      window.localStorage.setItem(THEME_OVERRIDE_KEY, next);
    } catch {
      // The override just won't persist across reloads.
    }
    setTheme(next);
  };

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={toggle}
      aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} theme`}
      className="fixed right-4 bottom-4 z-50 bg-background shadow-md"
    >
      {theme === "dark" ? <Sun /> : <Moon />}
      {theme === "dark" ? "Light" : "Dark"}
      <span className="text-xs text-muted-foreground">dev</span>
    </Button>
  );
}
