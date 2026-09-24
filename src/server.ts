import { appFromEnv } from "./config.js";

const port = Number(process.env.PORT ?? 3000);
appFromEnv(process.env, { serveStatic: true }).listen(port, () => {
  console.log(`LunchMatch running on http://localhost:${port}`);
});
