import { main } from "./cli.js";
import { log } from "./log.js";

main(process.argv.slice(2))
  .then((code) => {
    process.exitCode = code;
  })
  .catch((err: unknown) => {
    log("fatal", err instanceof Error ? err.stack ?? err.message : err);
    process.exit(1);
  });
