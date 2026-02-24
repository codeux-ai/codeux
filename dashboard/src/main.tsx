import { render } from "preact";
import { App } from "./app.js";
import "./styles.css";

const container = document.getElementById("app");
if (!container) {
  throw new Error("Dashboard root element '#app' not found");
}

render(<App />, container);
