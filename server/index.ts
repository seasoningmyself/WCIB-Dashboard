import { createApp } from "./app.js";
import { readPort } from "./runtime.js";

const app = createApp();
const port = readPort(process.env.PORT);

app.listen(port, () => {
  console.log(`WCIB Dashboard API listening on port ${port}`);
});
