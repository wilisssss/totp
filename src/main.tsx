import ReactDOM from "react-dom/client";
import App from "./App";
import "./styles/index.css";

const root = document.getElementById("root");
if (!root) {
  throw new Error("elemen #root tidak ditemukan");
}

ReactDOM.createRoot(root).render(<App />);
