import { spawn } from "node:child_process";

const commands = [
  { label: "backend", args: ["run", "dev:server"] },
  { label: "frontend", args: ["run", "dev:client"] },
];

const children = commands.map(({ args }) =>
  spawn("npm", args, {
    env: process.env,
    stdio: "inherit",
  }),
);

let shutdownRequested = false;

function stopChildren(signal = "SIGTERM") {
  shutdownRequested = true;

  for (const child of children) {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill(signal);
    }
  }
}

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, () => stopChildren(signal));
}

const exits = children.map(
  (child, index) =>
    new Promise((resolve) => {
      child.once("error", (error) => {
        resolve({ code: 1, error, label: commands[index].label });
      });
      child.once("exit", (code, signal) => {
        resolve({ code, label: commands[index].label, signal });
      });
    }),
);

const firstExit = await Promise.race(exits);

if (!shutdownRequested) {
  const detail = firstExit.error?.message ?? firstExit.signal ?? firstExit.code;
  console.error(`${firstExit.label} development process exited (${detail})`);
  stopChildren();
  process.exitCode = firstExit.code === 0 ? 1 : (firstExit.code ?? 1);
}

await Promise.allSettled(exits);
