import { createApp } from "./app.js";
import { loadConfig } from "./config/environment.js";

const config = loadConfig();
const app = createApp();

app.listen(config.port, () => {
  console.log(
    `WCIB Dashboard API listening on port ${config.port} (${config.nodeEnv})`,
  );
});
