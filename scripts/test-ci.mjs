import { spawnSync } from "node:child_process";
import { error } from "node:console";
import process from "node:process";

const compose = ["compose", "-f", "compose.test.yaml", "-p", "trusttask-test"];
const env = {
  ...process.env,
  DATABASE_URL:
    "postgres://trusttask:trusttask_local_only@127.0.0.1:5433/trusttask_test",
  NODE_ENV: "test",
  SESSION_SECRET: "test-only-trusttask-secret-that-is-longer-than-32",
};
const useShell = process.platform === "win32";
const run = (command, args) => {
  const result = spawnSync(command, args, {
    env,
    stdio: "inherit",
    shell: useShell,
  });
  if (result.error) throw result.error;
  if (result.status !== 0)
    throw new Error(`${command} failed with exit code ${result.status}`);
};

let started = false;
try {
  started = true;
  run("docker", [...compose, "up", "-d", "--wait", "db"]);
  for (const script of ["db:migrate", "db:seed", "test:integration"])
    run("pnpm", [script]);
} finally {
  if (started) {
    const result = spawnSync("docker", [...compose, "down"], {
      env,
      stdio: "inherit",
      shell: useShell,
    });
    if (result.error) error(`Compose cleanup failed: ${result.error}`);
    if (result.status !== 0)
      error(`Compose cleanup exited with code ${result.status}`);
  }
}
