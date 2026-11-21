import { createRoot } from "react-dom/client";

import { ModuleEntry } from "./app/ModuleEntry";
import "./ui/theme.css";

const connect =
  import.meta.env.DEV && window.parent === window
    ? () =>
        import("./host/devStandaloneClient").then((mod) =>
          mod.connectStandaloneDevHost(),
        )
    : undefined;

createRoot(document.getElementById("root")!).render(
  <ModuleEntry connect={connect} />,
);
