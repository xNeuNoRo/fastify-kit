import { beforeEach } from "vitest"; // Bun interceptará esto perfectamente
import { container } from "../src/container/DIContainer.js";

beforeEach(() => {
  container.clearAll();
});
