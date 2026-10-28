import { expect } from "chai";
import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

/** EIP-170 limit on deployed runtime bytecode. */
const MAX_DEPLOYED_BYTES = 24_576;
/** EIP-3860 limit on creation (init) code. */
const MAX_INITCODE_BYTES = 49_152;
const PRODUCTION_CONTRACTS = [
  "DividendDistributor",
  "ForgeCapitaFactory",
  "ForgeCapitaRegistry",
  "MilestoneEscrow",
  "P2PExchange",
  "ProjectToken",
  "RevenueRouter",
];
/** Test-only contracts are not deployed to a live chain; they are excluded from the size gate. */
const EXCLUDED_DIRECTORIES = ["mocks"];

interface ContractSize {
  name: string;
  deployedBytes: number;
  initcodeBytes: number;
}

function bytesOfHex(hex: unknown): number {
  if (typeof hex !== "string" || !/^0x([0-9a-fA-F]{2})*$/.test(hex)) {
    throw new Error("artifact bytecode is not a hex string");
  }
  return (hex.length - 2) / 2;
}

function readSizes(directory: string): ContractSize[] {
  const sizes: ContractSize[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      if (!EXCLUDED_DIRECTORIES.includes(entry.name)) sizes.push(...readSizes(path));
      continue;
    }
    if (!entry.name.endsWith(".json") || entry.name.endsWith(".dbg.json")) continue;
    const artifact: unknown = JSON.parse(readFileSync(path, "utf8"));
    if (typeof artifact !== "object" || artifact === null) continue;
    const { contractName, deployedBytecode, bytecode } = artifact as Record<string, unknown>;
    if (typeof contractName !== "string") continue;
    const deployedBytes = bytesOfHex(deployedBytecode);
    if (deployedBytes === 0) continue;
    sizes.push({ name: contractName, deployedBytes, initcodeBytes: bytesOfHex(bytecode) });
  }
  return sizes;
}

describe("Contract size limits (CON-03.6)", function () {
  const sizes = readSizes(resolve(process.cwd(), "artifacts", "contracts"));

  it("finds every production contract in the artifacts", function () {
    const names = sizes.map((size) => size.name);
    for (const expected of PRODUCTION_CONTRACTS) expect(names).to.include(expected);
  });

  it("keeps every deployed contract below the 24576-byte EIP-170 limit and init code below EIP-3860's", function () {
    const table = [...sizes]
      .sort((a, b) => b.deployedBytes - a.deployedBytes)
      .map((s) => `${s.name}: deployed ${s.deployedBytes} B, initcode ${s.initcodeBytes} B`);
    console.log(`      sizes (excluding ${EXCLUDED_DIRECTORIES.join(", ")}):\n        ${table.join("\n        ")}`);

    for (const size of sizes) {
      expect(size.deployedBytes, `${size.name} deployed bytecode`).to.be.lessThan(MAX_DEPLOYED_BYTES);
      expect(size.initcodeBytes, `${size.name} init code`).to.be.lessThan(MAX_INITCODE_BYTES);
    }
  });
});
