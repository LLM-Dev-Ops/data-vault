#!/usr/bin/env node
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const [baselineArg, candidateArg, outputArg] = process.argv.slice(2);
if (!baselineArg || !candidateArg || !outputArg) {
  console.error("usage: evaluate-api-boundary.mjs <baseline> <candidate> <output.json>");
  process.exit(2);
}

const baseline = resolve(baselineArg);
const candidate = resolve(candidateArg);
const output = resolve(outputArg);
const flywheelModule =
  process.env.FLYWHEEL_MODULE ??
  "/home/ruv/.local/share/llm-dev-ops-tools/node_modules/@metaharness/flywheel/dist/index.js";
const tscBin =
  process.env.TSC_BIN ??
  "/home/ruv/work/data-vault-oct24b/node_modules/typescript/bin/tsc";
const {
  runFlywheelGenerations,
  meetsPromotionRule,
  makeSigner,
  verifyReplayBundle,
  gateFingerprint,
} = await import(pathToFileURL(flywheelModule).href);

const evidence = [];
const holdout = {
  id: "api-boundary-holdout-v1",
  items: [
    "error::tests::test_internal_error_response_is_sanitized",
    "error::tests::test_service_unavailable_response_is_sanitized",
    "error::tests::test_gateway_timeout_response_is_sanitized",
    "error::tests::test_json_parse_error_response_is_sanitized",
    "error::tests::test_validation_error_response_retains_actionable_details",
    "middleware::metrics::tests::test_normalize_path",
    "__full_vault_api_suite__",
  ],
};
const anchor = {
  id: "api-boundary-anchor-v1",
  items: ["__cargo_check__", "__typescript_build__"],
};

function tail(value, size = 1200) {
  const text = String(value ?? "");
  return text.length <= size ? text : text.slice(-size);
}

function commandFor(item) {
  if (item === "__cargo_check__") {
    return ["cargo", ["check", "-p", "vault-api", "--locked"]];
  }
  if (item === "__typescript_build__") {
    return [process.execPath, [tscBin, "-p", "tsconfig.json"]];
  }
  if (item === "__full_vault_api_suite__") {
    return ["cargo", ["test", "-p", "vault-api", "--locked"]];
  }
  return [
    "cargo",
    ["test", "-p", "vault-api", "--locked", "--lib", item, "--", "--exact"],
  ];
}

async function evaluate(policy, suite) {
  const repo = resolve(policy.repo);
  const itemWins = [];
  let elapsedMs = 0;
  for (const item of suite.items) {
    const [command, args] = commandFor(item);
    const started = Date.now();
    const result = spawnSync(command, args, {
      cwd: repo,
      encoding: "utf8",
      env: {
        ...process.env,
        CARGO_INCREMENTAL: "0",
        CARGO_PROFILE_DEV_DEBUG: "0",
      },
      timeout: 300_000,
    });
    const durationMs = Date.now() - started;
    elapsedMs += durationMs;
    const won = result.status === 0;
    itemWins.push(won);
    evidence.push({
      repo,
      suite: suite.id,
      item,
      command: [command, ...args],
      exitCode: result.status,
      signal: result.signal,
      durationMs,
      stdoutTail: tail(result.stdout),
      stderrTail: tail(result.stderr),
    });
  }

  const wins = itemWins.filter(Boolean).length;
  return {
    primary: wins / itemWins.length,
    noopRate: (itemWins.length - wins) / itemWins.length,
    costPerWin: elapsedMs / 1000 / Math.max(wins, 1),
    regressed: wins !== itemWins.length,
    itemWins,
  };
}

const rootPolicy = { repo: baseline };
const baselineBefore = await evaluate(rootPolicy, holdout);
const result = await runFlywheelGenerations({
  rootPolicy,
  proposer: async (base, target) => ({
    value: candidate,
    summary: "Sanitize client-visible errors and restore executable API regression coverage",
    inverse: {
      path: target,
      parentBytes: base.policy[target],
      hash: createHash("sha256").update(base.policy[target]).digest("hex"),
    },
  }),
  evaluator: evaluate,
  promotionRule: meetsPromotionRule,
  holdout,
  anchor,
  mutationTargets: ["repo"],
  maxGenerations: 1,
  signer: makeSigner(),
  now: (generation) => `2026-10-24T18:00:0${generation}.000Z`,
  dataSource: "LIVE",
  cacheEvaluations: true,
});

const replay = verifyReplayBundle(result.replayBundle, {
  pinnedGateFingerprint: gateFingerprint(meetsPromotionRule),
});
const rollbackScore = await evaluate(rootPolicy, holdout);
const rollbackVerified =
  rollbackScore.primary === baselineBefore.primary &&
  rollbackScore.itemWins?.every((won, index) => won === baselineBefore.itemWins?.[index]);

const report = {
  versions: {
    metaharness: "0.4.2",
    darwin: "0.10.3",
    flywheel: "0.1.12",
  },
  baseline,
  candidate,
  baselineBefore,
  finalPolicy: result.finalPolicy,
  liftCurve: result.liftCurve,
  promotions: result.promotions,
  replay,
  rollback: {
    verified: rollbackVerified,
    score: rollbackScore,
  },
  replayBundle: result.replayBundle,
  evidence,
};

mkdirSync(dirname(output), { recursive: true });
writeFileSync(output, JSON.stringify(report, null, 2) + "\n");
console.log(
  JSON.stringify({
    promoted: result.finalPolicy.repo === candidate,
    liftCurve: result.liftCurve,
    replayPass: replay.pass,
    rollbackVerified,
    evidenceRuns: evidence.length,
  }),
);
if (result.finalPolicy.repo !== candidate || !replay.pass || !rollbackVerified) {
  process.exit(1);
}
