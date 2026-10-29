#!/usr/bin/env node
import { authenticate, loadCredentials } from "./auth";
import { endpointFor } from "@repo/core/providers";
import type { Inventory, RetrievalResult } from "@repo/core";
import { storageDirectory } from "@repo/core/storage";
import { help, parseCommand } from "./args";
import { CliError } from "./errors";
import { renderInventory, renderResult } from "./render";
import { stat } from "node:fs/promises";
import { version } from "../package.json";
import { installSkill } from "./skill";
import { createProgress } from "./progress";
import { exitCodeForResult } from "./exit-code";
import { createLocalEvaluator, localProviders } from "./local-provider";

globalThis.AI_SDK_LOG_WARNINGS = false;

const controller = new AbortController();
let pipeClosed = false;
let interrupted = false;
process.stdout.on("error", (error: NodeJS.ErrnoException) => {
  pipeClosed = true;
  controller.abort();
  process.exitCode = error.code === "EPIPE" ? 0 : 1;
});
const interrupt = () => {
  interrupted = true;
  controller.abort();
};
process.on("SIGINT", interrupt);

async function write(text: string) {
  if (pipeClosed) return;
  await new Promise<void>((resolve, reject) => {
    process.stdout.write(text, (error) => (error ? reject(error) : resolve()));
  });
}

function terminalProgress() {
  return createProgress({
    enabled: process.stdout.isTTY === true && process.stderr.isTTY === true && !process.env.CI,
    write: (text) => process.stderr.write(text),
  });
}

async function main() {
  const command = parseCommand(process.argv.slice(2));
  switch (command.kind) {
    case "help":
      return write(help);
    case "version":
      return write(`${version}\n`);
    case "skill":
      process.exitCode = await installSkill(command, controller.signal);
      return;
    case "auth":
      return authenticate(command, controller.signal);
    case "cache-clear": {
      const { createEvaluationCache } = await import("@repo/core");
      const cache = createEvaluationCache({ directory: storageDirectory("cache") });
      await cache.clear();
      if (cache.stats().issues.length)
        throw new CliError("Could not completely clear the cache. Check its permissions.");
      return write("Cache cleared.\n");
    }
    case "doctor": {
      const { createEvaluator, EvaluationFailure } = await import("@repo/core");
      const credentials = command.localProvider ? undefined : await loadCredentials();
      const label = command.localProvider
        ? localProviders[command.localProvider].label
        : endpointFor(credentials!).label;
      const evaluator = command.localProvider
        ? createLocalEvaluator({
            provider: command.localProvider,
            model: command.model,
            signal: controller.signal,
          })
        : createEvaluator({ ...credentials!, signal: controller.signal });
      try {
        const answers = await evaluator.evaluate({
          state: { source: "export function recordEvent(event) { events.push(event); }" },
          questions: {
            relevant: {
              type: "boolean",
              instructions: "Does this source implement recording an event?",
            },
          },
        });
        if (!(answers.relevant! > 0.5))
          throw new CliError(`${label} returned an unexpected answer to the connection check.`);
        await write(
          command.localProvider
            ? `${label} answered one synthetic check; retrieval quality is unverified.\n`
            : `Jev connection verified through ${label}.\n`,
        );
      } catch (error) {
        if (error instanceof CliError) throw error;
        if (error instanceof EvaluationFailure && error.diagnostic) {
          const { statusCode, message } = error.diagnostic;
          throw new CliError(
            `Jev connection check failed through ${label} (HTTP ${statusCode}).\n` +
              (message
                ? `Provider: ${message}`
                : "Check your saved key, model access, and provider billing."),
          );
        }
        throw new CliError(
          command.localProvider
            ? `Local scoring check failed through ${label}. Check that its CLI is installed, signed in, and able to run the selected model.`
            : `Jev connection check failed through ${label}. Check your saved key, model access, and network.`,
        );
      }
      return;
    }
    case "files": {
      if (!(await stat(command.root).catch(() => undefined))?.isDirectory())
        throw new CliError("The root must be an existing directory.");
      const { inventory } = await import("@repo/core");
      const progress = terminalProgress();
      progress.start();
      let result: Inventory;
      try {
        result = await inventory({
          root: command.root,
          includePaths: command.list,
          policy: command.policy,
          signal: controller.signal,
          progress: (snapshot) => progress.update(snapshot),
        });
      } finally {
        progress.done();
      }
      if (pipeClosed) return;
      await write(renderInventory(result));
      process.exitCode = exitCodeForResult(result);
      return;
    }
    case "search": {
      const { retrieve, createEvaluator, createEvaluationCache } = await import("@repo/core");
      const cache = createEvaluationCache({
        directory: storageDirectory("cache"),
        enabled: !command.noCache,
      });
      const evaluator = command.localProvider
        ? createLocalEvaluator({
            provider: command.localProvider,
            model: command.model,
            cache: command.model ? cache : undefined,
            concurrency: command.concurrency,
            requestLimit: command.explicitMaxRequests ? command.maxRequests : 12,
            policyVersion: JSON.stringify(command.policy),
            signal: controller.signal,
          })
        : createEvaluator({
            cache,
            concurrency: command.concurrency,
            requestLimit: command.maxRequests,
            policyVersion: JSON.stringify(command.policy),
            ...(await loadCredentials()),
            signal: controller.signal,
          });
      const progress = terminalProgress();
      progress.start();
      let result: RetrievalResult;
      try {
        result = await retrieve(
          {
            root: command.root,
            query: command.query,
            policy: command.policy,
            signal: controller.signal,
            progress: (snapshot) => progress.update(snapshot),
          },
          evaluator,
        );
      } finally {
        progress.done();
      }
      if (pipeClosed) return;
      await write(
        renderResult(result, command.maxSourceBytes, command.maxOutputBytes, command.noLocations),
      );
      process.exitCode = exitCodeForResult(result);
    }
  }
}

try {
  await main();
} catch (error) {
  if (!pipeClosed) {
    const aborted = interrupted || (error instanceof Error && error.name === "AbortError");
    process.exitCode = aborted ? 130 : 1;
    const message = aborted
      ? "Interrupted."
      : error instanceof CliError
        ? error.message
        : "Command failed. Check the root, permissions, credentials, and network.";
    await write(`${message}\n`).catch(() => {});
  }
} finally {
  process.removeListener("SIGINT", interrupt);
  if (interrupted && !pipeClosed) process.exitCode = 130;
}
