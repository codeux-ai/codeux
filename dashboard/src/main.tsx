import { render } from "preact";
import { RouterProvider } from "@tanstack/react-router";
import { router } from "./v2/routes.js";
import "./styles.css";

const Root = () => <RouterProvider router={router} />;

const container = document.getElementById("app");
if (!container) throw new Error("Dashboard root element '#app' not found");

render(<Root />, container);
