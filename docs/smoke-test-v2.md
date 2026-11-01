# v2 testnet smoke test (WS-05.4a)

User-run scripts that drive a complete v2 life cycle on Arbitrum Sepolia and BSC Testnet so the indexer (IDX-41 Phase B) sees every reachable event. Claude never runs these scripts; you do.

- Scripts: `scripts/smoke/00-check.ts` ... `09-gasdebt.ts`, shared code in `scripts/smoke/lib.ts` and `scripts/smoke/pure.ts`.
- **Dry-run is the default.** Nothing is sent unless the shell variable `SMOKE_SEND=yes` is set. A dry-run still connects to the RPC (read-only), prints the whole plan, runs the balance preflight and simulates with `staticCall` / `estimateGas` where the chain state allows; otherwise it prints `needs <step>`.
- Environment variables read by the scripts: `SMOKE_SEND` and the optional `SMOKE_RAISE_WEI` (P4 raise override, wei). Neither is secret. Nothing else is read from the environment, no `.env` file is read by the scripts, and keys, mnemonics and RPC URLs are never printed or stored.
- Chain whitelist: only chain ids 421614 and 97. The in-process `hardhat` network is rejected on purpose.
- Resumable: `scripts/smoke/state/state-<chainId>.json` holds public data only (chain id, the six wallet addresses, per project the token/escrow/distributor/router addresses, parameters, a `steps` map `{done, txHash, block}`, and a `pending` map of transactions that were broadcast but not yet confirmed). Finished steps are skipped; as a fallback a step is also skipped when an on-chain read shows it is already done. See section 11, "Partial failure", for how a lost confirmation is recovered without sending twice.
- Per-transaction value cap: any single transaction with a value of 0.05 native or more is refused (the planned maximum is the 0.03 P1 investment, so the "P1 exception" in the spec is moot).

## 1. Wallets and roles

The scripts use the six accounts of the smoke network in this order:

| Signer | Role | Address |
|---|---|---|
| 0 | Guardian = deployer = treasury | `0x08D3B18508ca976fECc7291c06c30ae15133eB4F` |
| 1 | developer (launches the projects) | new throwaway wallet |
| 2 | investor A | new throwaway wallet |
| 3 | investor B | new throwaway wallet |
| 4 | buyer (P2P buyer, revenue payer, later P2 developer) | new throwaway wallet |
| 5 | relayer | `0x8a1Be9d8fd97658b6b0B8b537374FF6c3E41815b` |

Public contract addresses (same on both chains, see `docs/deployments-v2.md`): Factory `0x246Ffa3Bf583a15e92e17FAa32d3663C17204d52`, P2PExchange `0xd2540297eB8FC0985b5fa26cba2358db0a0AE914`, Registry `0x2e6A22fd249930b9F2905D1bD66443CbE366AacB`.

`lib.ts` refuses to run unless there are exactly six distinct signers, signer 0 is `registry.guardian()`, signer 5 equals the relayer constant and `registry.isRelayer(signer 5)` is true. `00-check.ts` additionally prints PASS/FAIL for `registry.treasury()` being the Guardian wallet (signer 0); `05-revenue.ts` and `07-cancel-refund.ts` assume this when they check the `claimTreasuryFunds` amounts, so in live mode they refuse to start (dry-run: warning) when it fails.

**Relayer wallet risk.** `RELAYER_KEY` is probably the future production relayer key of the gasless relayer. Using it here means that key sits in your Hardhat keystore on the machine running the smoke test. If you prefer a throwaway relayer: create a new wallet, have the Guardian call `registry.setRelayer(<new address>, true)` on both chains, store its key as `RELAYER_KEY` (or change the variable name in the config), and change the one constant `RELAYER_ADDRESS` in `scripts/smoke/pure.ts`. Nothing else changes.

## 2. User-action prerequisites

1. **Create four new throwaway wallets** (developer, investor A, investor B, buyer), for example four new MetaMask accounts. Never reuse a wallet that holds real funds. Note the four public addresses.
2. **Store the keys in the Hardhat keystore** (never in a file, never in chat). In `forgecapita-contracts` run, one per line, and paste the key at each prompt:
   ```powershell
   npx hardhat keystore set SMOKE_DEVELOPER_KEY
   npx hardhat keystore set SMOKE_INVESTOR_A_KEY
   npx hardhat keystore set SMOKE_INVESTOR_B_KEY
   npx hardhat keystore set SMOKE_BUYER_KEY
   npx hardhat keystore set RELAYER_KEY
   ```
   `DEPLOYER_KEY` must already exist (used by the v2 deployment). Confirm with `npx hardhat keystore list`: it prints names only, never values.
3. **Add the two network entries** from section 3 to `hardhat.config.ts` (you edit this file; the scripts and Claude do not).
4. **Fund the six wallets** from the faucets (Arbitrum Sepolia ETH, BSC tBNB), see section 4.
5. **Run `00-check.ts`** on each chain (section 5) and continue only when every line is PASS and no wallet is SHORT.

## 3. `hardhat.config.ts` lines (user edit)

Add these two entries inside `networks: { ... }`, next to `arbitrumSepolia` and `bscTestnet` (do not change those):

```ts
    arbitrumSepoliaSmoke: {
      type: "http",
      url: process.env.ARBITRUM_SEPOLIA_RPC || "",
      chainId: 421614,
      accounts: [
        configVariable("DEPLOYER_KEY"),
        configVariable("SMOKE_DEVELOPER_KEY"),
        configVariable("SMOKE_INVESTOR_A_KEY"),
        configVariable("SMOKE_INVESTOR_B_KEY"),
        configVariable("SMOKE_BUYER_KEY"),
        configVariable("RELAYER_KEY"),
      ],
    },
    bscTestnetSmoke: {
      type: "http",
      url: process.env.BSC_TESTNET_RPC || "https://data-seed-prebsc-1-s1.binance.org:8545",
      chainId: 97,
      accounts: [
        configVariable("DEPLOYER_KEY"),
        configVariable("SMOKE_DEVELOPER_KEY"),
        configVariable("SMOKE_INVESTOR_A_KEY"),
        configVariable("SMOKE_INVESTOR_B_KEY"),
        configVariable("SMOKE_BUYER_KEY"),
        configVariable("RELAYER_KEY"),
      ],
    },
```

What was checked by reading the Hardhat 3.11.0 source in `node_modules` (reading only, nothing executed):

- **`configVariable` is resolved lazily, per connected network.** `hardhat/dist/src/internal/core/configuration-variables.js`: a `configVariable(...)` becomes a `LazyResolvedConfigurationVariable` whose value is fetched only on `.get()` / `.getHexString()`. `builtin-plugins/network-manager/request-handlers/handlers-array.js` calls `getHexString()` on the accounts of the network being connected (line 55), i.e. only when `network.create()` / `--network` opens that network. Config loading, `hardhat compile` and `hardhat test` (which uses the in-process `hardhat` network) do not fetch unset keystore variables, so the new entries do not break them. The keystore plugin's `fetchValue` hook (`hardhat-keystore/dist/src/internal/hook-handlers/configuration-variables.js`) looks a variable up only when it is requested. Result: confirmed by reading; not executed. (Observation: an environment variable with the same name takes precedence over the keystore; do not set these names in the shell.)
- **`getSigners()` returns the accounts in config order on an http network.** `hardhat-ethers/.../hardhat-helpers.js` `getSigners()` calls `eth_accounts` and maps the result in order; `request-handlers/handlers/accounts/local-accounts.js` answers `eth_accounts` with the configured private keys' addresses in array order. Result: confirmed by reading; not executed.
- `--network <name>` becomes the default network of `network.create()` (`network-manager/hook-handlers/hre.js` uses `hre.globalOptions.network`). `scripts/postDeployConfig.ts` already relies on this.
- NOT verified by running: that the RPC accepts the six keys, the keystore password prompt sequence, and every on-chain behaviour below. No script has been run on any chain.

## 4. Funding

Guidance per wallet (a rough starting point only; **trust the shortfall printed by `00-check.ts` over this static table**, it is computed from the plan totals plus a gas reserve at the live gas price):

| Wallet | Arbitrum Sepolia (ETH) | BSC Testnet (tBNB) | Why |
|---|---|---|---|
| developer | 0.02 | 0.1 | launches (about 1.4M gas each) and milestone calls, no value |
| investor A | 0.06 | 0.06 | 0.03 in P1, up to 0.0077 in P4, gas |
| investor B | 0.04 | 0.04 | 0.02 + 0.004 + 0.002 invested, gas |
| buyer | 0.03 | 0.03 | 0.005 listing + 0.01 and 0.002 payments, gas |
| relayer | 0.02 | 0.1 | pays gas for the sponsored claims, stakes, votes and executions |
| deployer (Guardian) | 0.02 | 0.1 | freeze, unfreeze, treasury claims, shutdown |

Native currency flows back: the developer receives the milestone payouts and B, the buyer and the Guardian receive proceeds, fees and refunds.

## 5. Run order

Run each script first as a dry-run (no `SMOKE_SEND`), read the plan, then send. In PowerShell, from `forgecapita-contracts`:

```powershell
# dry-run (default): prints the plan, sends nothing
npx hardhat run scripts/smoke/01-launch.ts --network arbitrumSepoliaSmoke

# send for real in this PowerShell session
$env:SMOKE_SEND = "yes"
npx hardhat run scripts/smoke/01-launch.ts --network arbitrumSepoliaSmoke

# go back to dry-run
Remove-Item Env:SMOKE_SEND
```

| # | Script | When | Arbitrum Sepolia | BSC Testnet |
|---|---|---|---|---|
| 0 | `00-check.ts` | before everything, read-only in every mode | `npx hardhat run scripts/smoke/00-check.ts --network arbitrumSepoliaSmoke` | `npx hardhat run scripts/smoke/00-check.ts --network bscTestnetSmoke` |
| 1 | `01-launch.ts` | then within 24 h run 02 | `$env:SMOKE_SEND="yes"; npx hardhat run scripts/smoke/01-launch.ts --network arbitrumSepoliaSmoke` | `$env:SMOKE_SEND="yes"; npx hardhat run scripts/smoke/01-launch.ts --network bscTestnetSmoke` |
| 2 | `02-fund.ts` | within 24 h of 01 (funding window is 1 day); prints the time left in the P1/P2/P3 windows first | `... 02-fund.ts --network arbitrumSepoliaSmoke` | `... 02-fund.ts --network bscTestnetSmoke` |
| 3 | `03-claim-stake.ts` | after 02 | `... 03-claim-stake.ts --network arbitrumSepoliaSmoke` | `... 03-claim-stake.ts --network bscTestnetSmoke` |
| 4 | `04-p2p.ts` | after 03 | `... 04-p2p.ts --network arbitrumSepoliaSmoke` | `... 04-p2p.ts --network bscTestnetSmoke` |
| 5 | `05-revenue.ts` | after 03 (P1 needs stakers; P2 payment must precede 07). **Must run before the last step of 06.** | `... 05-revenue.ts --network arbitrumSepoliaSmoke` | `... 05-revenue.ts --network bscTestnetSmoke` |
| 6 | `06-vote-execute.ts` | after 03. **Order 05 before 06:** the final step `withdraw:investorB` changes the staked total from 672000 to 640000, which would change A's yield from the figure in section 7; it therefore needs P1 `pay` (phase 5) and prints `needs pay first` / refuses in live mode until it is done. Steps m1.* to m2.exec can run earlier. | `... 06-vote-execute.ts --network arbitrumSepoliaSmoke` | `... 06-vote-execute.ts --network bscTestnetSmoke` |
| 7 | `07-cancel-refund.ts` | after 05 (needs the P2 payment) | `... 07-cancel-refund.ts --network arbitrumSepoliaSmoke` | `... 07-cancel-refund.ts --network bscTestnetSmoke` |
| 8 | `08-failed-crowdfund.ts` | more than 1 day after 01; prints the remaining wait and exits otherwise | `... 08-failed-crowdfund.ts --network arbitrumSepoliaSmoke` | `... 08-failed-crowdfund.ts --network bscTestnetSmoke` |
| 9 | `09-gasdebt.ts` | optional, any time after 06 | `... 09-gasdebt.ts --network arbitrumSepoliaSmoke` | `... 09-gasdebt.ts --network bscTestnetSmoke` |

`...` stands for `$env:SMOKE_SEND="yes"; npx hardhat run scripts/smoke/` (the line you would use to send). Do one chain completely (or both in parallel in two terminals); the state files are per chain id.

To start over, move `scripts/smoke/state/state-<chainId>.json` away (the old projects stay on chain and in the indexer, so expected counts below then add up). Caveat: if the new run starts within 24 hours of the old launches, `launch` finds the old project on chain (same developer, name, symbol, goal, funding window still open) and adopts it instead of launching a new one; wait until the old windows have closed (or accept reusing them).

`SMOKE_RAISE_WEI` (P4 only) must be at least 21 x `registry.maxCostPerAction()` and below 0.05; smaller values are refused because four sponsored actions could then exceed the gas ceiling.

## 6. Projects

All projects: 1,000,000 whole tokens (18 decimals), 20% (200,000) to the developer on completion, 80% (800,000) public; milestones "MVP" 50% and "Launch" 50% (P4: "Delivery" 100%); funding duration 1 day.

| Key | Goal | Raise | Purpose |
|---|---|---|---|
| P1 | 0.04 | A 0.03 + B 0.02 = 0.05 | full happy path: claim, stake, P2P, revenue, vote, freeze, complete |
| P2 | 0.004 | B 0.004 | throwaway: zero-staker revenue, developer handover, cancel, refund, shutdown |
| P3 | 0.1 | B 0.002 (left open) | failed crowdfund |
| P4 | = raise | A, 22 x `registry.maxCostPerAction()` (4.4e15 on Arbitrum Sepolia, 7.7e15 on BSC) | optional gas-ledger / gas-debt |

**Project id in the indexer.** `project.id` is `projectId(chainId, escrowAddress)` from `forgecapita-indexer/src/ids.ts`: `"<chainId>:<escrow address, lowercase>"`. It is the **escrow** (MilestoneEscrow) address, not the token address. `project_launch.id`, `project_revenue.id` equal it too. The token, distributor and router are found through `token_map.id = "<chainId>:<token>"`, `distributor_map.id`, `router_map.id` (each holds `projectId`). `deposit.id` / `position.id` = `"<chainId>:<escrow>:<investor lowercase>"`, `milestone.id` = `"<chainId>:<escrow>:<index>"`, `p2p_listing.id` = `"<chainId>:<listingId>"`, event tables use `"<chainId>:<txHash>:<logIndex>"`.

Where to look (replace `<INDEXER_URL>`; the indexer's tables are in the Postgres schema `ponder`):

- Health: `GET <INDEXER_URL>/health` (empty 200), `GET <INDEXER_URL>/ready` (empty 200 when the historical sync is done, 503 before), `GET <INDEXER_URL>/status` (latest indexed block per chain).
- Aggregates: `GET <INDEXER_URL>/stats/overview?chainId=<chainId>`, `GET <INDEXER_URL>/projects/<chainId>/<escrow>/revenue`, `GET <INDEXER_URL>/investors/<address>/positions?chainId=<chainId>`, `GET <INDEXER_URL>/projects/<chainId>/<escrow>/gas-ledger`.
- GraphQL root: `<INDEXER_URL>/` (or `/graphql`); use its schema explorer for the exact query names (plural of the table export, for example `projects`, `milestones`, `p2pListings`; the other plural names were not verified). Or run SQL against schema `ponder` in Neon (for example `select * from ponder.project where chain_id = 421614`).
- Explorer: `https://sepolia.arbiscan.io/address/<escrow>` / `https://testnet.bscscan.com/address/<escrow>`; each script prints a tx link per transaction.

## 7. Actions, events and what the indexer should show

Notation: amounts in wei (native in brackets). "P1.escrow" etc. means the project's address from the state file. Gas figures (`cost`, `gasSpent`) vary and are only checked as "at most `maxCostPerAction`".

### Phase 1: `01-launch.ts`

| Step key | Caller | Function | Event(s) | Indexer rows and fields | Check |
|---|---|---|---|---|---|
| `launch` (P1, P2, P3) | developer | `ForgeCapitaFactory.launchProject(name, symbol, 1000000, ["MVP","Launch"], [50,50], goal, 1)` | `ProjectLaunched`, plus clone-init events | `project`: 3 rows, `state=FUNDING`, `isFundingActive=true`, `totalRaised=0`, `fundingGoal` 4e16 / 4e15 / 1e17, `developer`=developer wallet, `tokenName`/`tokenSymbol` "Smoke Alpha"/SMKA, "Smoke Beta"/SMKB, "Smoke Gamma"/SMKC, `votingPeriod=2419200`, `closeGrace=1209600`, `refundWindow=7776000`, `fundingDeadline` = launch time + 86400. `project_launch`: 3 rows (`launcher`=`txFrom`=developer). `token_map`, `distributor_map`, `router_map`: 3 rows each. | `/stats/overview`: `projectsByState.FUNDING` +3 |

**Expected after phase 1:** 3 `project` rows (FUNDING), 3 `project_launch`, 3 `token_map`, 3 `distributor_map`, 3 `router_map`.

### Phase 2: `02-fund.ts`

| Step key | Caller | Function | Event(s) | Indexer rows and fields | Check |
|---|---|---|---|---|---|
| `invest:investorA` (P1) | A | native transfer 0.03 to P1.escrow | `DepositReceived(A, 3e16)` | `deposit` P1/A `invested=30000000000000000`, `refunded=0`; `project.totalRaised` 3e16 | `/investors/<A>/positions` |
| `invest:investorB` (P1) | B | native transfer 0.02 | `DepositReceived(B, 2e16)` | `deposit` P1/B `invested=20000000000000000`; `totalRaised` 5e16 | |
| `close` (P1) | developer | `closeFundingAndStart()` | `PlatformFeeCollected(2.5e15)` | `project` P1: `state=ACTIVE`, `isFundingActive=false`, `totalRaised=50000000000000000`, `platformFee=2500000000000000`, `fundingClosedAt` set. `project_lifecycle_event` kind `FEE_COLLECTED`, `feeAmount=2500000000000000`, `raisedAtClose=50000000000000000`, `stateAfter=ACTIVE` | `/stats/overview`: `platformFeesCollected` +2.5e15 |
| `invest:investorB` (P2) | B | native transfer 0.004 | `DepositReceived` | `deposit` P2/B `invested=4000000000000000` | |
| `close` (P2) | developer | `closeFundingAndStart()` | `PlatformFeeCollected(2e14)` | `project` P2 `ACTIVE`, `platformFee=200000000000000`, `totalRaised=4000000000000000`; `FEE_COLLECTED` row | |
| `invest:investorB` (P3) | B | native transfer 0.002 | `DepositReceived` | `deposit` P3/B `invested=2000000000000000`; `project` P3 `totalRaised=2000000000000000`, stays `FUNDING`, `isFundingActive=true` | |

**Expected after phase 2:** P1 `ACTIVE` (raised 5e16, fee 2.5e15, treasury received 2.5e15); P2 `ACTIVE` (raised 4e15, fee 2e14); P3 `FUNDING` (raised 2e15). `deposit`: 4 rows. `project_lifecycle_event`: 2 (`FEE_COLLECTED`). Gas budget P1 = 2.5e15, ceiling = 2.5e15 + 15% of 4.75e16 = 9.625e15.

### Phase 3: `03-claim-stake.ts`

Public supply is 800,000 tokens. Token share = deposit x publicSupply / totalRaised: P1 A 3e16/5e16 = **480,000** (60%), B **320,000** (40%); P2 B **800,000**.

| Step key | Caller | Function | Event(s) | Indexer rows and fields | Check |
|---|---|---|---|---|---|
| `claim:investorA` (P1) | A (user-paid) | `claimTokens()` | `Transfer(escrow -> A, 480000e18)` | `position` P1/A `tokensHeld=480000e18`, `tokensClaimed=480000e18`; `deposit` P1/A `tokensClaimed=480000e18` | |
| `claim:investorB` (P1) | relayer | `claimTokensFor(B)` | `Transfer(escrow -> B, 320000e18)`, `SponsoredGas(relayer, B, 0, cost, gasSpent)` | `position` P1/B `tokensHeld=320000e18`, `tokensClaimed=320000e18`; `sponsored_gas` row `action=0`, `account=B`, `relayer`=relayer wallet, `cost <= maxCostPerAction` | `/projects/<chainId>/<P1.escrow>/gas-ledger` |
| `stake:investorA` (P1) | relayer | `stakeWithPermit(A, 480000e18, deadline, v, r, s)`; A signs the permit with spender = P1.distributor | `Approval`/`Transfer(A -> distributor)`, `Staked(A, 480000e18)`, `SponsoredGas(.., A, 1, ..)` | `position` P1/A `stakedBalance=480000e18`, `tokensHeld=0`; `project.totalStaked=480000e18`; `sponsored_gas` `action=1`, `account=A` | |
| `approve:investorB` (P1) | B (user-paid) | `ProjectToken.approve(distributor, 192000e18)` | `Approval` | none (no handler) | |
| `stake:investorB` (P1) | B (user-paid) | `stake(192000e18)` | `Transfer(B -> distributor)`, `Staked(B, 192000e18)` | `position` P1/B `stakedBalance=192000e18`, `tokensHeld=128000e18`; `project.totalStaked=672000e18` | |
| `claim:investorB` (P2) | B (user-paid) | `claimTokens()` | `Transfer(escrow -> B, 800000e18)` | `position` P2/B `tokensHeld=800000e18`, `tokensClaimed=800000e18`, `stakedBalance=0`; `deposit` P2/B `tokensClaimed=800000e18` | |

**Expected after phase 3:** P1 `totalStaked=672000e18`; `sponsored_gas` for P1: 2 rows (actions 0 and 1); `/gas-ledger` `summary.actionCount=2`. `/investors/<A>/positions` P1 item: `invested=30000000000000000`, `depositTokensClaimed=480000e18`, `stakedBalance=480000e18`, `tokensHeld=0`, `tokensClaimed=480000e18`.

### Phase 4: `04-p2p.ts`

Listing ids come from `ListingCreated` (shown by the script and stored in the state file); on a fresh exchange they are 0 and 1. `p2p_listing.id` = `"<chainId>:<listingId>"`.

| Step key | Caller | Function | Event(s) | Indexer rows and fields | Check |
|---|---|---|---|---|---|
| `p2p:approve` (P1) | B | `ProjectToken.approve(P2PExchange, 15000e18)` | `Approval` | none | |
| `list:listing0` | B | `P2PExchange.createListing(P1.token, 10000e18, 0.005)` | `ListingCreated`, `Transfer(B -> exchange)` | `p2p_listing` `seller=B`, `tokenAddress`=P1.token, `tokenAmount=10000e18`, `priceInETH=5000000000000000`, `status=ACTIVE`, `projectId`=P1 id; `position` P1/B `tokensHeld` 128000e18 -> 118000e18 | |
| `list:listing1` | B | `createListing(P1.token, 5000e18, 0.004)` | `ListingCreated` | second `p2p_listing`, `tokenAmount=5000e18`, `priceInETH=4000000000000000`; `position` P1/B `tokensHeld=113000e18` | |
| `fill:listing0` | buyer | `fillListing(listing0)` with value 0.005 | `ListingFilled`, `Transfer(exchange -> buyer)` | listing0 `status=FILLED`, `isActive=false`, `buyer`=buyer wallet, `filledAt` set. `p2p_trade`: `pricePaid=5000000000000000`, `protocolFee=50000000000000`, `sellerProceeds=4950000000000000`, `tokenAmount=10000e18`, `projectId`=P1 id. `position` P1/buyer `tokensHeld=10000e18`, `tokensClaimed=0` | `/stats/overview`: `p2p.tradeCount` +1, `volume` +5e15, `fees` +5e13 |
| `cancel:listing1` | B | `cancelListing(listing1)` | `ListingCancelled`, `Transfer(exchange -> B)` | listing1 `status=CANCELLED`, `isActive=false`, `cancelledAt` set; `position` P1/B `tokensHeld=118000e18` | `/stats/overview`: `p2p.activeListings` +0 net |

**Expected after phase 4:** `p2p_listing` 2 rows (FILLED, CANCELLED), `p2p_trade` 1 row. P1 `position`: B `tokensHeld=118000e18` (128000 - 15000 listed + 5000 returned by the cancel; the 10000 sold left B for the buyer), buyer `tokensHeld=10000e18`. Treasury (Guardian) received 5e13, B received 4.95e15.

### Phase 5: `05-revenue.ts`

Split of a payment: 1% treasury, 24% creator, 75% to the distributor when `totalStaked > 0`, else the 75% is added to the creator's pending funds (the event still reports the nominal `investorCut`).

| Step key | Caller | Function | Event(s) | Indexer rows and fields | Check |
|---|---|---|---|---|---|
| `pay` (P1) | buyer | `RevenueRouter.routePayment()` value 0.01 | `PaymentReceived(buyer, 1e16, 2.4e15, 7.5e15, 1e14)`, `DividendsDeposited(7.5e15)` | `revenue_record` `gross=10000000000000000`, `creatorCut=2400000000000000`, `investorCut=7500000000000000`, `platformFee=100000000000000`, `routedToStakers=true`, `payer`=buyer. `project_revenue` P1: `paymentCount=1`, `totalGross=1e16`, `totalCreatorCut=2.4e15`, `totalInvestorCut=7.5e15`, `totalToStakers=7.5e15`, `totalRedirectedToCreator=0`, `totalPlatformFee=1e14`. `project_revenue_month` one row for the current UTC month with the same sums | `/projects/<chainId>/<P1.escrow>/revenue` |
| `claimYield:investorA` (P1) | A (user-paid) | `DividendDistributor.claimYield()` | `YieldClaimed(A, 5357142856800000)` | `position` P1/A `yieldClaimed=5357142856800000` (= 480000e18 x floor(7.5e15 x 1e18 / 672000e18) / 1e18; B's unclaimed share is 2142857142720000) | `/investors/<A>/positions`: `yieldClaimed` |
| `claimCreator` (P1) | developer | `claimCreatorFunds()` | `FundsClaimed(developer, 2.4e15)` | `router_claim` `kind=CREATOR`, `claimant`=developer, `amount=2400000000000000`; `project_revenue.totalCreatorClaimed=2.4e15` | |
| `claimTreasury` (P1) | Guardian | `claimTreasuryFunds()` | `FundsClaimed(treasury, 1e14)` | `router_claim` `kind=TREASURY`, `claimant`=Guardian wallet, `amount=100000000000000`; `totalTreasuryClaimed=1e14` | |
| `pay` (P2) | buyer | `routePayment()` value 0.002 | `PaymentReceived(buyer, 2e15, 4.8e14, 1.5e15, 2e13)` (no `DividendsDeposited`) | `revenue_record` `gross=2000000000000000`, `creatorCut=480000000000000`, `investorCut=1500000000000000`, `platformFee=20000000000000`, `routedToStakers=false`. `project_revenue` P2: `totalToStakers=0`, `totalRedirectedToCreator=1500000000000000` | revenue route for P2 |

**Expected after phase 5:** `revenue_record` 2 rows, `project_revenue` 2 rows, `project_revenue_month` 2 rows (4 if the run straddles a UTC month), `router_claim` 2 rows. `/stats/overview` `revenue`: `paymentCount=2`, `totalGross=12000000000000000`, `totalCreatorCut=2880000000000000`, `totalToStakers=7500000000000000`, `totalRedirectedToCreator=1500000000000000`, `totalPlatformFee=120000000000000` (smoke projects only; other projects add to these).

### Phase 6: `06-vote-execute.ts`

Fast track passes when `yesVotes > publicSupply / 2` = 400,000e18. Net funds = 5e16 - 2.5e15 = 4.75e16; each milestone releases 50% = **2.375e16** (23750000000000000), minus any gas debt (none expected).

| Step key | Caller | Function | Event(s) | Indexer rows and fields | Check |
|---|---|---|---|---|---|
| `m1.start` | developer | `startMilestone(0)` | `VotingStarted(0)` | `milestone` P1 index 0: `isVotingOpen=true`, `description=MVP`, `unlockPercentage=50`, `yesVotes=0` | `/stats/overview`: `activeVotes` +1 |
| `m1.voteB` | relayer | `voteBySig(B, true, deadline, sig)`; B signs EIP-712 `Vote(voter, milestoneIndex, support, deadline)` | `Voted(B, 0, true, 192000e18)`, `SponsoredGas(.., B, 2, ..)` | `vote`: `voter=B`, `support=true`, `weight=192000e18`, `txFrom`=relayer wallet; `sponsored_gas` `action=2`, `account=B` | |
| `m1.voteA` | A (user-paid) | `vote(true)` | `Voted(A, 0, true, 480000e18)` | `vote`: `voter=A`, `weight=480000e18`, `txFrom=A`; `milestone` 0 `yesVotes=672000e18`, `noVotes=0` | |
| `m1.exec` | relayer | `executeMilestone()` | `MilestoneExecuted(0, 2.375e16, 0, 0)`, `SponsoredGas(.., 0x0, 3, ..)` | `milestone` 0: `isExecuted=true`, `isVotingOpen=false`, `amountReleased=23750000000000000`, `tokensVested=0`, `gasDebtRecouped=0`; `project.currentMilestoneIndex=1`; `sponsored_gas` `action=3`, `account=0x000...000` | |
| `m2.start` | developer | `startMilestone(1)` | `VotingStarted(1)` | `milestone` 1 `description=Launch`, `isVotingOpen=true` | |
| `m2.voteB` | B (user-paid) | `vote(false)` | `Voted(B, 1, false, 192000e18)` | `vote` `support=false`, `weight=192000e18`; `milestone` 1 `noVotes=192000e18` | |
| `m2.voteA` | A (user-paid) | `vote(true)` | `Voted(A, 1, true, 480000e18)` | `milestone` 1 `yesVotes=480000e18` (> 400000e18, fast track) | |
| `m2.freeze` | Guardian | `freezeMilestones()` | `MilestonesFrozen(until, 3888000)` | `milestone_freeze` `kind=frozen`, `until` = block time + 3888000 (45 days), `totalFrozen=3888000`, `triggeredBy`=Guardian wallet; `milestone` 1 `votingEndTime` moved later | |
| `m2.checkFrozen` | read-only | `staticCall executeMilestone()` | none (must revert `Milestones frozen`) | none | script prints "reverted as expected" |
| `m2.unfreeze` | Guardian | `unfreezeMilestones()` | `MilestonesUnfrozen(t)` | `milestone_freeze` `kind=unfrozen`, `until=null`, `totalFrozen` = seconds actually frozen (small), `triggeredBy`=Guardian wallet | |
| `m2.exec` | relayer | `executeMilestone()` | `SponsoredGas(.., 0x0, 3, ..)`, `ProjectCompleted`, `Transfer(escrow -> developer, 200000e18)`, `MilestoneExecuted(1, 2.375e16, 200000e18, 0)` | `milestone` 1: `isExecuted=true`, `amountReleased=23750000000000000`, `tokensVested=200000e18`; `project.state=COMPLETED`, `currentMilestoneIndex=2`; `project_lifecycle_event` `COMPLETED`, `stateAfter=COMPLETED`; `position` P1/developer `tokensHeld=200000e18`, `tokensClaimed=0` | `/stats/overview`: `activeVotes` back to 0, `projectsByState.COMPLETED` +1 |
| `withdraw:investorB` | B (user-paid) | `DividendDistributor.withdraw(32000e18)` | `Transfer(distributor -> B)`, `Withdrawn(B, 32000e18)` | `position` P1/B `stakedBalance=160000e18`, `tokensHeld=150000e18`; `project.totalStaked=640000e18` | |

**Expected after phase 6:** `milestone` 2 rows (both executed), `vote` 4 rows, `milestone_freeze` 2 rows, `sponsored_gas` for P1: 5 rows (actions 0, 1, 2, 3, 3), `/gas-ledger` `summary.actionCount=5` and `gasSpent` = the newest row's cumulative value (at most the ceiling 9.625e15); no `gas_debt` rows (spend stays below the 2.5e15 budget unless real costs are near the cap, in which case a `recovered` row appears). The developer received 2 x 2.375e16 = 4.75e16 and 200000e18 tokens.

### Phase 7: `07-cancel-refund.ts` (P2)

| Step key | Caller | Function | Event(s) | Indexer rows and fields | Check |
|---|---|---|---|---|---|
| `propose` | developer | `proposeNewDeveloper(buyer)` | `DeveloperTransferProposed(developer, buyer)` | `developer_change` `kind=proposed`, `oldDeveloper`=developer, `newDeveloper`=buyer, `txFrom`=developer | |
| `accept` | buyer | `acceptDeveloperRole()` | `DeveloperTransferAccepted` | `developer_change` `kind=accepted`, `txFrom`=buyer; `project.developer`=buyer; `token_map.developer`=buyer | |
| `claimCreator` | buyer (new developer) | `claimCreatorFunds()` | `FundsClaimed(buyer, 1.98e15)` | `router_claim` `kind=CREATOR`, `claimant`=buyer, `amount=1980000000000000` (24% + the 75% fallback); `project_revenue.totalCreatorClaimed=1980000000000000` | revenue route for P2 |
| `claimTreasury` | Guardian | `claimTreasuryFunds()` | `FundsClaimed(treasury, 2e13)` | `router_claim` `kind=TREASURY`, `amount=20000000000000`; `totalTreasuryClaimed=2e13` | |
| `cancel` | buyer | `cancelProject("smoke test")` | `ProjectCancelled("smoke test")` | `project` P2 `state=CANCELLED`, `cancelledAt` set; `project_lifecycle_event` `CANCELLED`, `reason=smoke test`, `stateAfter=CANCELLED`, `txFrom`=buyer | |
| `approveEscrow` | B | `ProjectToken.approve(escrow, 800000e18)` | `Approval` | none | |
| `refund` | B | `refundDeadProject()` | `Transfer(B -> escrow)`, `RefundClaimed(B, 3.8e15)` | `deposit` P2/B `refunded=3800000000000000` (4e15 less the 5% fee), `invested=4000000000000000`; `position` P2/B `tokensHeld=0` | |
| `shutdown` | Guardian | `emergencyShutdown()` | `TokenInvalidated`, `Transfer(escrow -> 0x0, 1000000e18)` (burn), `EmergencyShutdownTriggered(0, 1000000e18)` | `project_lifecycle_event` `TOKEN_INVALIDATED` (`stateAfter=null`) and `SHUTDOWN` (`extractedEth=0`, `burnedTokens=1000000000000000000000000` = 200000 developer + 800000 refunded, `stateAfter=SHUTDOWN`); `project` P2 `state=SHUTDOWN`, `isInvalidated=true`, `shutdownAt` set | |

**Expected after phase 7:** P2 `SHUTDOWN`; `developer_change` 2 rows; `router_claim` 4 rows in total; `project_lifecycle_event` 6 rows in total (P1: `FEE_COLLECTED`, `COMPLETED`; P2: `FEE_COLLECTED`, `CANCELLED`, `TOKEN_INVALIDATED`, `SHUTDOWN`). `/stats/overview` `projectsByState`: COMPLETED +1 (P1), SHUTDOWN +1 (P2), FUNDING +1 (P3).

### Phase 8: `08-failed-crowdfund.ts` (P3)

| Step key | Caller | Function | Event(s) | Indexer rows and fields | Check |
|---|---|---|---|---|---|
| `refund:investorB` (P3) | B | `refundFailedCrowdfund()` (needs deadline passed and balance < goal) | **none** (the contract emits no event here) | **no indexer change**: `deposit` P3/B still shows `invested=2e15`, `refunded=0`; `project` P3 stays `state=FUNDING` (the REFUNDABLE phase is time-derived, see `src/projectState.ts` `fundingPhase`) | verify on the explorer: B's balance rises by 0.002 less gas, escrow `deposits(B)=0` |

This is a known gap (the indexer backlog calls it "crowdfund refund invisibility", IDX-12): record it as expected, not as a failure.

### Phase 9 (optional): `09-gasdebt.ts` (P4)

| Step key | Caller | Function | Event(s) | Indexer rows and fields | Check |
|---|---|---|---|---|---|
| `launch` | developer | `launchProject("Smoke Delta", "SMKD", 1000000, ["Delivery"], [100], raise, 1)` | `ProjectLaunched` | 4th `project` row + maps | |
| `invest:investorA`, `close` | A, developer | native transfer `raise`; `closeFundingAndStart()` | `DepositReceived`, `PlatformFeeCollected(5% of raise)` | `deposit` P4/A, `project` P4 `ACTIVE`, `platformFee` = 5% of the raise = the gas budget | |
| `claim:investorA` | relayer | `claimTokensFor(A)` | `Transfer`, `SponsoredGas(.., A, 0, ..)` | `sponsored_gas` `action=0` | |
| `stake:investorA` | relayer | `stakeWithPermit(A, 800000e18, ...)` | `Staked`, `SponsoredGas(.., A, 1, ..)` | `sponsored_gas` `action=1`, `position` P4/A `stakedBalance=800000e18` | |
| `m1.start` | developer | `startMilestone(0)` | `VotingStarted(0)` | `milestone` P4 index 0 | |
| `m1.voteA` | relayer | `voteBySig(A, true, ...)` | `Voted(A, 0, true, 800000e18)`, `SponsoredGas(.., A, 2, ..)` | `vote` row; yes weight 800000e18 > 400000e18 | |
| `m1.exec` | relayer | `executeMilestone()` | `SponsoredGas(.., 0x0, 3, ..)`, **`GasDebtRecovered(0, amount, 0)` only if booked cost exceeded the budget**, `ProjectCompleted`, `MilestoneExecuted` | `sponsored_gas` 4 rows (actions 0..3); `gas_debt` row `kind=recovered`, `milestoneIndex=0`, `amount` = overflow, `outstanding=0` (only on overflow); `milestone.gasDebtRecouped` = same amount | `/projects/<chainId>/<P4.escrow>/gas-ledger`: `summary.debtRecovered` |

Gas-debt design with a raise of 22 caps: budget = 5% of the raise = 1.1 caps; ceiling = budget + 15% of net funds = 4.235 caps (1.1 + 15% of 20.9); each sponsored action books `min(gasUsed x gasprice + l1Surcharge, cap)`. Four actions can never exceed the ceiling, but they only exceed the **budget** (overflow) when their real total is above 1.1 caps. **Best effort:** if the real cost per action is far below the cap there is no overflow, no `GasDebtRecovered` event and no `gas_debt` row. The script prints the ledger (`gasBudget`, `gasSpent`, `gasRecovered`) and says which case happened. On Arbitrum Sepolia the L1 surcharges (about 6e13 per action) make overflow likely; on BSC Testnet it usually does not occur. `GasDebtWrittenOff` is not reachable in practice (it needs unrecovered debt after the final milestone).

## 8. Handler to step coverage map

35 handlers in `forgecapita-indexer/src/index.ts`.

| Handler | Step | Notes |
|---|---|---|
| `ForgeCapitaFactory:ProjectLaunched` | 01 `launch` | |
| `MilestoneEscrow:DepositReceived` | 02 `invest:*` | |
| `MilestoneEscrow:PlatformFeeCollected` | 02 `close` | |
| `MilestoneEscrow:VotingStarted` | 06 `m1.start`, `m2.start` | |
| `MilestoneEscrow:Voted` | 06 votes (relayed and direct) | |
| `MilestoneEscrow:MilestoneExecuted` | 06 `m1.exec`, `m2.exec` | |
| `MilestoneEscrow:ProjectCompleted` | 06 `m2.exec` | |
| `MilestoneEscrow:MilestonesFrozen` / `MilestonesUnfrozen` | 06 `m2.freeze` / `m2.unfreeze` | |
| `MilestoneEscrow:SponsoredGas` | 03, 06, 09 | |
| `MilestoneEscrow:ProjectCancelled` | 07 `cancel` | |
| `MilestoneEscrow:RefundClaimed` | 07 `refund` | |
| `MilestoneEscrow:EmergencyShutdownTriggered` | 07 `shutdown` | |
| `MilestoneEscrow:DeveloperTransferProposed` / `Accepted` | 07 `propose` / `accept` | |
| `ProjectToken:TokenInvalidated` | 07 `shutdown` | |
| `ProjectToken:Transfer` | 03 onward (claims, stakes, listings, vesting, burn) | |
| `DividendDistributor:Staked` | 03 `stake:*` | |
| `DividendDistributor:Withdrawn` | 06 `withdraw:investorB` | |
| `DividendDistributor:YieldClaimed` | 05 `claimYield:investorA` | |
| `P2PExchange:ListingCreated` / `ListingFilled` / `ListingCancelled` | 04 | |
| `RevenueRouter:PaymentReceived` / `FundsClaimed` | 05, 07 | |
| `MilestoneEscrow:GasDebtRecovered` | 09 `m1.exec` | best effort (needs overflow over the budget) |
| `ForgeCapitaRegistry:RelayerSet`, `MaxCostPerActionSet`, `L1SurchargeSet` | not by the smoke test | already emitted by the CON-04.3 / 04.3a setup; check `relayer_allowlist` (relayer allowed) and `registry_setting` (`maxCostPerAction`, `l1Surcharge:0..3`) |
| `MilestoneEscrow:MilestoneFailed` | **unreachable** | needs the 28-day voting period to end without approval |
| `MilestoneEscrow:GasDebtWrittenOff` | **unreachable in practice** | needs unrecovered gas debt after the final milestone |
| `ForgeCapitaRegistry:TreasuryProposed` / `TreasuryChanged` / `GuardianProposed` / `GuardianChanged` | **skipped** | rotating the treasury or Guardian of the live registry is deliberately not done |

## 9. Transfer accounting and the IDX-41 Phase B checks

`ProjectToken:Transfer` maintains `position.tokensHeld` / `tokensClaimed` and `deposit.tokensClaimed`: escrow, distributor, the P2P exchange and the zero address are excluded (custody, not holders); an escrow outflow to anyone but the developer counts as a claim; the debit side never creates a row and clamps at 0.

Run these queries (or the equivalent GraphQL) after phases 3, 4 and 6 and compare with the numbers above:

1. **Conservation per project.** For P1 after phase 6: sum of `position.tokensHeld` + sum of `position.stakedBalance` + tokens in the exchange (0 after fill and cancel) + escrow balance (0) must equal 1,000,000e18. Expected rows: developer `tokensHeld=200000e18`; A `tokensHeld=0`, `stakedBalance=480000e18`; B `tokensHeld=150000e18`, `stakedBalance=160000e18`; buyer `tokensHeld=10000e18`. Held 360000 + staked 640000 = **1,000,000**. Compare each row with the chain (`ProjectToken.balanceOf`, `DividendDistributor.stakedBalance`) as well. After phase 3 the same sum is 200000 (still in escrow, excluded) + 480000 + 320000 = 1,000,000 with the 200000 developer tokens held by the escrow.
2. **tokensClaimed vs deposit.tokensClaimed.** For every investor `position.tokensClaimed` equals `deposit.tokensClaimed` (P1 A 480000e18, B 320000e18; P2 B 800000e18); the developer's vesting (200000e18) and the buyer's P2P tokens must **not** appear in `tokensClaimed`.
3. **P2P custody.** While listings are active the seller's `tokensHeld` is reduced and nothing is credited anywhere; after the fill the buyer is credited; after the cancel the seller is re-credited. P2P handlers must not touch `tokensHeld` themselves.
4. **Aggregates vs rows.** `milestone.yesVotes/noVotes` equal the sums of `vote.weight` per milestone and support (M0 672000e18 / 0; M1 480000e18 / 192000e18); `project.totalStaked` equals the sum of `position.stakedBalance`; `project_revenue` equals the sums of `revenue_record` and `router_claim`; `/stats/overview.platformFeesCollected` equals the sum of `project.platformFee`.
5. **Row counts for the three smoke projects P1, P2, P3 (no P4):** `project` 3, `project_launch` 3, `token_map` 3, `distributor_map` 3, `router_map` 3, `milestone` 2, `vote` 4, `deposit` 4, `position` 5 (P1: A, B, developer, buyer; P2: B), `p2p_listing` 2, `p2p_trade` 1, `sponsored_gas` 5, `gas_debt` 0 (without P4), `milestone_freeze` 2, `developer_change` 2, `project_lifecycle_event` 6, `revenue_record` 2, `router_claim` 4, `project_revenue` 2, `project_revenue_month` 2, `role_change` 0. `relayer_allowlist` and `registry_setting` (1 and 5 rows per chain) come from the setup.
6. **Idempotent re-run (replay).** Re-sync the indexer into a fresh schema from the start block (or restart it) and confirm every count above and the figures in section 7 are identical. Run the smoke scripts once more with the state file in place: every step must say `SKIP`, nothing is sent, and the indexer counts do not change.
7. **Known gaps to expect:** `refundFailedCrowdfund` emits no event (P3 unchanged in the indexer); `project.state` for a project whose close grace expires is time-derived, not event-driven; a developer who is also a depositor cannot be told apart from vesting.

## 10. Skipped paths (not covered, with reasons)

- 28-day quorum voting path and `MilestoneFailed`: needs a 28-day wait.
- 14-day close grace (`Close window ended`) and refund after the grace: needs a 15-day wait.
- 90-day refund window before `emergencyShutdown` of a cancelled project with unrefunded holders: needs 90 days.
- `emergencyShutdown` on the completed P1: destructive (burns tokens, extracts ETH, invalidates the token); P1 stays COMPLETED as a reference project.
- Registry treasury / Guardian rotation events: would change the roles of the live registry.
- 45-day freeze lapse: needs 45 days (the freeze/unfreeze path is covered).
- `GasDebtWrittenOff`: not reachable with realistic costs.

## 11. Troubleshooting

| Symptom | Cause and fix |
|---|---|
| `Gas ceiling exceeded` on a relayer call | Sponsored calls revert before the project is closed (gas budget and net funds are 0 until `closeFundingAndStart`). Run 02 (close) first; the scripts' `needs` order prevents this. If it appears after closing, compare the project's `gasSpent` with `gasBudget + 15% of netFunds` (a small raise has a small ceiling). |
| `Permit failed` | The permit was rejected and the caller is neither the owner nor an allow-listed relayer, or the signature is stale. The scripts re-sign on every attempt with a one-hour chain-time deadline and the DISTRIBUTOR as spender. Re-run the step; check that the relayer wallet is allow-listed (`00-check`). |
| `Funding deadline has passed` | 02 was run more than 24 hours after 01. Move the state file away and start over (new projects), or close the funded projects manually before `deadline + 14 days`. |
| `Role/protocol checks failed` | Run `00-check.ts`; it names the failing check (wrong signer count, signer 0 is not the Guardian, relayer constant, relayer not allow-listed, no code at an address, `maxCostPerAction` is 0). |
| `Chain id ... is not allowed` | Wrong `--network`. Use `arbitrumSepoliaSmoke` or `bscTestnetSmoke`. |
| `Insufficient balance` / `SHORT` | Name, public address, required and current balance are printed. Fund that wallet from the faucet and re-run. |
| A variable like `SMOKE_BUYER_KEY` is not found | Set it with `npx hardhat keystore set SMOKE_BUYER_KEY` (and confirm with `npx hardhat keystore list`). |
| State file "belongs to a different chain or wallet set" | The keystore keys changed since the state file was written. Move the state file away (old projects stay on chain) or restore the old keys. |
| Partial failure / script interrupted | Re-run the same script. Steps recorded as done are skipped; others are skipped when the chain already shows the effect. See the "Pending transactions" paragraph below the table. |
| `Too early` in 08 | The P3 funding deadline has not passed yet; the remaining wait is printed. Re-run later. |
| `Voting period ended`, `Already voted`, `No voting power` | Steps were run out of order or twice by hand. Check the milestone state on the explorer; the scripts skip completed steps. |
| RPC rate limit or timeout | Re-run (resumable). Use a dedicated RPC URL in `ARBITRUM_SEPOLIA_RPC` / `BSC_TESTNET_RPC`. |
| `refundFailedCrowdfund` shows nothing in the indexer | Expected, the contract emits no event (phase 8). |

### Pending transactions and resume safety

Immediately after a transaction is broadcast (before waiting for its receipt) the script writes `{txHash, status: "pending"}` for that step into the `pending` map of the state file. On the next run, for every step that has a pending hash and before anything is sent:

1. The receipt is looked up (`provider.getTransactionReceipt`). **Status 1:** the step is recorded as done (including its follow-up, for example reading the new project addresses from the `ProjectLaunched` log or the listing id from `ListingCreated`) and is NOT sent again. **Status 0:** the record is marked `failed` and the step is attempted again (the failed hash stays in the file for reference).
2. **No receipt yet:** the run stops with "previous tx ... is still pending, wait and re-run". Nothing is resent. If the explorer shows the transaction was dropped and will never confirm, delete that one entry from `pending` in the state file and re-run.
3. The recorded transaction must have been sent by the wallet of the step's role, otherwise the run stops.

Extra on-chain checks where they exist cheaply: `launch` looks for a project of the developer wallet with the same name, symbol and goal whose funding window is still open (via `factory.developerProjects`, then the `ProjectLaunched` log) and adopts it; the two P2P listings are looked up by seller, token, amount and price in the newest 50 exchange listings; the other steps already have state reads. Payments (`pay` on P1 and P2) cannot be detected on chain safely (repeated payments look identical), so they rely only on the pending record.

**What remains a manual check:** a broadcast that was lost before its hash was written (the process was killed in the instant between the RPC accepting the transaction and the state file write). `launch` and the listings are then still caught by the on-chain checks above; `pay` is not. If a run died during a `pay` step and the output printed no `sent 0x...` line, open the explorer address page of the buyer wallet (`https://sepolia.arbiscan.io/address/<buyer>` or `https://testnet.bscscan.com/address/<buyer>`) and look for a recent transaction to the router (P1.router / P2.router from the state file) before re-running. If one exists and succeeded, add it by hand to the project's `steps` as `"pay": {"done": true, "txHash": "<hash>", "block": <number>}`; if none exists, re-run. The same check applies to any other step when the process died with no `sent` line and the on-chain checks could not tell.

## 12. Safety notes

- Every script file starts with a "RUN BY THE USER ONLY" header and sends nothing without `SMOKE_SEND=yes`.
- The tx hash is persisted before the receipt is awaited, and a recorded hash is always resolved before a step can be sent again (see "Pending transactions and resume safety").
- Before each send the script re-checks the chain id against the whitelist, simulates the call where possible, enforces the 0.05 per-transaction value cap and runs the balance preflight.
- Output contains only public addresses, amounts, tx hashes and explorer links. Error text is stripped of URLs.
- The state file contains only public data. Delete or keep it as you like; it is safe to commit but there is no need to.
