import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { App } from "@/App";
import { createQueryClient } from "@/lib/query-client";

import "./index.css";

const container = document.getElementById("root");
if (container === null) {
  throw new Error("Root element #root is missing in index.html");
}

createRoot(container).render(
  <StrictMode>
    <App queryClient={createQueryClient()} />
  </StrictMode>,
);
