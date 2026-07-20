import { createRoot } from "react-dom/client";

import Geoportal from "../app/Geoportal";
import "../app/globals.css";

const root = document.getElementById("root");

if (!root) {
  throw new Error("No se encontró el contenedor principal del geoportal.");
}

createRoot(root).render(<Geoportal />);
