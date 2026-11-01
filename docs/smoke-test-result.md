# Smoke Test Results (v2 Testnet)

This document records the execution results, on-chain transaction hashes, and status of the v2 testnet smoke tests across target networks.

---

## 1. Codebase Fix: `scripts/smoke/lib.ts`

### Issue Encountered
During Phase 1 (`01-launch.ts`) execution in live mode on Arbitrum Sepolia, the script failed immediately after the preflight balance check with:
```
ERROR: execution reverted
```

### Root Cause
Before launching projects, `launchStep` checks if the developer wallet has already launched any projects on-chain using `developerTokens(ctx)`. This function queries `factory.developerProjects(developerAddress, index)`. 

For a brand-new developer wallet with 0 projects, Solidity reverts with `panic 0x32` (array out of bounds). The script expected Ethers to throw an error with code `"CALL_EXCEPTION"`. However, Arbitrum Sepolia's RPC returned a generic `execution reverted` error message without that specific error code flag. As a result, `if (isError(error, "CALL_EXCEPTION"))` returned `false`, and the script re-threw the error, crashing before launching P1.

### Fix Applied
In [`scripts/smoke/lib.ts`](file:///d:/GitHub/forgeCapita/forgecapita-contracts/scripts/smoke/lib.ts#L737), the catch block was updated to also check for `revert` in the sanitized error message:

```typescript
// scripts/smoke/lib.ts line 736-740
        try {
            tokens.push(await factory.developerProjects(ctx.addresses.developer, index));
        } catch (error) {
            if (isError(error, "CALL_EXCEPTION") || sanitizeError(error).includes("revert")) return tokens;
            throw error;
        }
```
This enables fresh developer wallets with 0 prior deployments to return an empty array and proceed directly to launching new projects.

### Issue 2: BSC Testnet Gas Tip Floor Enforcement
During Phase 6 (`06-vote-execute.ts`) on BSC Testnet, `m1.start` succeeded, but `m1.voteB` (relayed `voteBySig`) failed with:
```
ERROR: transaction gas price below minimum: gas tip cap 50424438, minimum needed 100000000
```
#### Root Cause
BSC testnet RPC node's `eth_maxPriorityFeePerGas` returned `50424438` wei (~0.05 Gwei), but BSC validator nodes enforce a minimum gas tip cap (`maxPriorityFeePerGas`) of `100000000` wei (0.1 Gwei).

#### Fix Applied
In [`scripts/smoke/lib.ts`](file:///d:/GitHub/forgeCapita/forgecapita-contracts/scripts/smoke/lib.ts#L182-L197), `ethers.provider.getFeeData` was wrapped for chain ID `97` to clamp `maxPriorityFeePerGas` to at least `100_000_000n` (0.1 Gwei), preventing RPC gas price rejection.


---

## 2. Arbitrum Sepolia (Chain ID: `421614`)

- **Explorer**: [https://sepolia.arbiscan.io](https://sepolia.arbiscan.io)
- **Execution Date**: 2026-11-01

### Test Wallets & Roles

| Role | Signer Index | Public Address |
| :--- | :---: | :--- |
| **Guardian / Treasury / Deployer** | 0 | `0x08D3B18508ca976fECc7291c06c30ae15133eB4F` |
| **Developer** | 1 | `0xDB9C736d60e1773037d6c2232C73FC9f39d3d467` |
| **Investor A** | 2 | `0x968Ee2C766252a096e6b50eCA69b7d658d5E66DE` |
| **Investor B** | 3 | `0xB3feCEEDB8BEe98F5ee16189A670F1dd23E753D5` |
| **Buyer** | 4 | `0x6CA6098Fc69A9d44Cfa79ad6BBa033F5B61a1219` |
| **Relayer** | 5 | `0x8a1Be9d8fd97658b6b0B8b537374FF6c3E41815b` |

### Overall Status Summary

| Phase | Script | Target | Status | Notes |
| :---: | :--- | :---: | :---: | :--- |
| **00** | `00-check.ts` | All | ✅ **PASSED** | Roles, contracts, allowlists, and funding preflights verified. |
| **01** | `01-launch.ts` | P1, P2, P3 | ✅ **PASSED** | 3 projects cloned and initialized via `ForgeCapitaFactory`. |
| **02** | `02-fund.ts` | P1, P2, P3 | ✅ **PASSED** | Deposits received, funding goals met, platform fees transferred. |
| **03** | `03-claim-stake.ts` | P1, P2 | ✅ **PASSED** | Direct claims, relayer claims, and ERC-2612 gasless permit staking. |
| **04** | `04-p2p.ts` | P1 | ✅ **PASSED** | Secondary listings, trade execution (1% fee), and cancellation. |
| **05** | `05-revenue.ts` | P1, P2 | ✅ **PASSED** | Product sales split (1% fee, 24% dev, 75% stakers) and 0-staker fallback. |
| **06** | `06-vote-execute.ts` | P1 | ✅ **PASSED** | EIP-712 `voteBySig`, guardian freeze/unfreeze, completion & vesting. |
| **07** | `07-cancel-refund.ts` | P2 | ✅ **PASSED** | Dev role handover, cancellation, dead refund, and emergency shutdown. |
| **08** | `08-failed-crowdfund.ts` | P3 | ⏳ **WAITING** | Funding deadline passes in ~23h (expected protocol delay). |
| **09** | `09-gasdebt.ts` | P4 | ✅ **PASSED** | Tight gas budget overflow; `GasDebtRecovered` event confirmed. |

---

### Deployed Project Contracts (Arbitrum Sepolia)

| Project | Key Purpose | Token Address | MilestoneEscrow | DividendDistributor | RevenueRouter |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **P1** | Happy Path Lifecycle | [`0x231Ac...099C`](https://sepolia.arbiscan.io/address/0x231Ac434a472869a949e87f60AcF73b174cD099C) | [`0xd2eeC...6346`](https://sepolia.arbiscan.io/address/0xd2eeC04FEBbA72507Db202dff5a269f26fc56346) | [`0xc2975...23Ad`](https://sepolia.arbiscan.io/address/0xc29753BfE842BAC649D9e5c997397F6b51d623Ad) | [`0x8d18D...0766`](https://sepolia.arbiscan.io/address/0x8d18DD4d36b7f25e9A53ae7F5020C4FbF6F80766) |
| **P2** | Failure & Shutdown | [`0xb5B4d...0a1e`](https://sepolia.arbiscan.io/address/0xb5B4d00944fd9A8c78B9f30a69574fC04A900a1e) | [`0xBF75e...7744`](https://sepolia.arbiscan.io/address/0xBF75ecAAee69C542FE1109bF4E5e25F2EAd87744) | [`0x6aEb5...A192`](https://sepolia.arbiscan.io/address/0x6aEb57acEb2284419F49188022383781d00fA192) | [`0xedD8c...76DB`](https://sepolia.arbiscan.io/address/0xedD8c3Ea9cc1f3e58D14d7B5AbEd3CEe509076DB) |
| **P3** | Failed Crowdfund | [`0x1B9bB...1DC2`](https://sepolia.arbiscan.io/address/0x1B9bBf0676769319032EE915D80ECedf1f5A1DC2) | [`0xB3249...d63F`](https://sepolia.arbiscan.io/address/0xB324900b7C3dE4B3bA98e37a60B6554f864Dd63F) | [`0x396d2...0276`](https://sepolia.arbiscan.io/address/0x396d25707B873546B695d394e8F3A05B96ac0276) | [`0xe9c61...dbcD`](https://sepolia.arbiscan.io/address/0xe9c6113879512978E357e08d5365a4957F3EdbcD) |
| **P4** | Gas Debt Recovery | [`0xE2b7d...8A0d`](https://sepolia.arbiscan.io/address/0xE2b7d1dc959937C7c5524A01be07906eB3518A0d) | [`0x5745A...c815`](https://sepolia.arbiscan.io/address/0x5745A30aFd6ebac1D68258eA5477C7E36486c815) | [`0x6EA0F...f8aF`](https://sepolia.arbiscan.io/address/0x6EA0F97718CbaE28d5eC5988Dab22D1DE057f8aF) | [`0x2F5A4...8140`](https://sepolia.arbiscan.io/address/0x2F5A4e77Ac2892C2dc9e587bF577AC35027a8140) |

---

### Detailed Execution Steps & Transaction Records

#### Phase 1: Launch (`01-launch.ts`)
- **P1 Launch**: [Tx `0x2dc95...a088`](https://sepolia.arbiscan.io/tx/0x2dc950c162e543537d73c8f4666a4036780ec48e36a73df4ff5ed4431792a088) (Block `325053149`)
- **P2 Launch**: [Tx `0xaa3d7...09fc`](https://sepolia.arbiscan.io/tx/0xaa3d75fa5d6f33ffd951fa0bf40026b7b70704477ba5063da20a0263736d09fc) (Block `325053158`)
- **P3 Launch**: [Tx `0xabf62...2023`](https://sepolia.arbiscan.io/tx/0xabf62b1bbb8e75964b0661bd91b321aef3a2ec7ae89d101115ba1ff057432023) (Block `325053167`)

#### Phase 2: Funding & Close (`02-fund.ts`)
- **P1 Investor A Deposit (0.03 ETH)**: [Tx `0x68be6...4d2e`](https://sepolia.arbiscan.io/tx/0x68be6a447029b4a5fb809486c58d10610f9883714af6e2fad0c17cea471a4d2e) (Block `325053725`)
- **P1 Investor B Deposit (0.02 ETH)**: [Tx `0x866e7...d593`](https://sepolia.arbiscan.io/tx/0x866e729898b259f016f7f5a9d0f23bb98504565a8af38087e254f7a23443d593) (Block `325053732`)
- **P1 Close Funding (Developer)**: [Tx `0xe1f78...a27e`](https://sepolia.arbiscan.io/tx/0xe1f787d25770a4ad7520376db541f843fb326c64c2e46306a98b04e6ff41a27e) (Block `325053739`)
- **P2 Investor B Deposit (0.004 ETH)**: [Tx `0x3c9b6...8be3`](https://sepolia.arbiscan.io/tx/0x3c9b68635b3c8436bd52a5a428d24060a33cc61abbb83fc99804d13579e78be3) (Block `325053746`)
- **P2 Close Funding (Developer)**: [Tx `0x2c2cb...06d9`](https://sepolia.arbiscan.io/tx/0x2c2cb0eaf6fe5df55a06315d32a414eb652fd689d4b4e610354c99bdb24406d9) (Block `325053754`)
- **P3 Investor B Deposit (0.002 ETH)**: [Tx `0x06264...2802`](https://sepolia.arbiscan.io/tx/0x062643273fd68c759be81564b245156198d27d3d850d50e52c770854422e2802) (Block `325053762`)

#### Phase 3: Claim & Stake (`03-claim-stake.ts`)
- **P1 Claim Tokens (Investor A, direct)**: [Tx `0x325c6...eba8`](https://sepolia.arbiscan.io/tx/0x325c6f439200abb298855b7757c05a03733479a20d0f69cf57c5de5bd6b6eba8) (Block `325054640`)
- **P1 Claim Tokens (Investor B, sponsored relayer)**: [Tx `0x226fc...98ea`](https://sepolia.arbiscan.io/tx/0x226fcf918099517879f0f89800482d26c7b40120e00411beddc49859791598ea) (Block `325054648`)
- **P1 Gasless Stake With Permit (Investor A, sponsored)**: [Tx `0x13b30...6850`](https://sepolia.arbiscan.io/tx/0x13b308aa2bce185cb7b125b4514e433ff6d4fa5977ee9b767f3cbdb3e0df6850) (Block `325054660`)
- **P1 Approve Distributor (Investor B)**: [Tx `0xc1725...fed8`](https://sepolia.arbiscan.io/tx/0xc172556c8f266d97d9c8775e87c362bf831ddf890114be304273e005a3ebfed8) (Block `325054670`)
- **P1 Stake Direct (Investor B)**: [Tx `0x60f11...1b11`](https://sepolia.arbiscan.io/tx/0x60f11efaa986e11571c91cd9964fe18905b5ee29aad18578c8c1429476f41b11) (Block `325054679`)
- **P2 Claim Tokens (Investor B)**: [Tx `0x1f663...dd70`](https://sepolia.arbiscan.io/tx/0x1f663a59ef35f126797babb031fdee30d42dbd2c70700bc41213f2142176dd70) (Block `325054688`)

#### Phase 4: P2P Trading (`04-p2p.ts`)
- **Approve P2PExchange (Investor B)**: [Tx `0x061ae...3666`](https://sepolia.arbiscan.io/tx/0x061aee22b6e8c79e2896374cc893123467b8ff51b7bdb9b6bad46a97483e3666) (Block `325055288`)
- **Create Listing 0 (10,000 tokens for 0.005 ETH)**: [Tx `0xcf1b6...84a0`](https://sepolia.arbiscan.io/tx/0xcf1b655b9d702715041b3501f2eebb6f03b8acf6cfaa8c7aaa119a24479084a0) (Block `325055296`)
- **Create Listing 1 (5,000 tokens for 0.004 ETH)**: [Tx `0xf3dcf...a9f1`](https://sepolia.arbiscan.io/tx/0xf3dcf481322089cb39c09e52aa47aeaadef817d022380ac0d6ad4bd7c581a9f1) (Block `325055304`)
- **Fill Listing 0 (Buyer)**: [Tx `0xc95ee...3fca`](https://sepolia.arbiscan.io/tx/0xc95ee96e505cba2376cea995fed0d65991a67a37f2e23966eb66763846363fca) (Block `325055311`)
- **Cancel Listing 1 (Investor B)**: [Tx `0x9624c...5cd`](https://sepolia.arbiscan.io/tx/0x9624c6e97f47972b400702e991e4ae82de1827e1cc21fe4c6cd06ec2f02d85cd) (Block `325055319`)

#### Phase 5: Revenue Routing & Claims (`05-revenue.ts`)
- **P1 Customer Payment (0.01 ETH)**: [Tx `0xde2af...3543`](https://sepolia.arbiscan.io/tx/0xde2af5473af9e38d06e04e8bee331435cdbfd2d7890b98cf52ff3606836a3543) (Block `325055831`)
- **P1 Investor A Yield Claim**: [Tx `0xf82dd...d5ec`](https://sepolia.arbiscan.io/tx/0xf82dd577881e5fd16356295d5f66d9423f771016a70a5d493ed1b4354b4ad5ec) (Block `325055838`)
- **P1 Developer Creator Funds Claim**: [Tx `0xdace7...b407`](https://sepolia.arbiscan.io/tx/0xdace70ec5dc2bd731040a6229d25a35a28436b8afb9eb6ac6fbad9d4c20ab407) (Block `325055845`)
- **P1 Treasury Fees Claim**: [Tx `0x873e3...8147`](https://sepolia.arbiscan.io/tx/0x873e30fb13142bd3ca40a3ccda60033120a4661aca08150b143a5c0b8be28147) (Block `325055853`)
- **P2 Customer Payment with Zero Stakers (0.002 ETH)**: [Tx `0x93d67...82ff`](https://sepolia.arbiscan.io/tx/0x93d67fda1f155267632ffac1ade75a52c96560786631fba2693888ca4e4f82ff) (Block `325055861`)

#### Phase 6: Governance, Freeze, Completion (`06-vote-execute.ts`)
- **P1 Start Milestone 0**: [Tx `0xe8ed1...8125`](https://sepolia.arbiscan.io/tx/0xe8ed1d411f0b9356be0f991f29eab16b485c806f215743c9552cbc3fbc8c8125) (Block `325057167`)
- **P1 Gasless EIP-712 Vote (Investor B via relayer)**: [Tx `0x3733a...f6c3`](https://sepolia.arbiscan.io/tx/0x3733a0f886e94ccbce468c4b093231055dd2b74d81efb9ed951b514a387bf6c3) (Block `325057176`)
- **P1 Direct Vote (Investor A)**: [Tx `0xabb06...af56`](https://sepolia.arbiscan.io/tx/0xabb064b1e2496ad2718fb5011c1e76e6ba6502ab26f7367ebdb202583222af56) (Block `325057183`)
- **P1 Execute Milestone 0 (Relayer)**: [Tx `0xd7da6...e8b6`](https://sepolia.arbiscan.io/tx/0xd7da6564f274de2ad2c56f41d9d452b218e87ba96344d4c4b271916e667de8b6) (Block `325057191`)
- **P1 Start Milestone 1**: [Tx `0x6cafe...faee`](https://sepolia.arbiscan.io/tx/0x6cafe778fcd6e2feb829b91e5e35b440f756e067f9368cb52b89fb76f749faee) (Block `325057197`)
- **P1 Vote NO (Investor B)**: [Tx `0xe8191...f612`](https://sepolia.arbiscan.io/tx/0xe81914f78a53226e0dc354decf8334d3250441f3500f96fb6834cf61de01f612) (Block `325057203`)
- **P1 Vote YES (Investor A)**: [Tx `0x39226...279b`](https://sepolia.arbiscan.io/tx/0x3922656377491ca5e56d3c88d446d99ad92eeae4a4d7bbf4a8539f7ea051279b) (Block `325057210`)
- **P1 Freeze Milestones (Guardian)**: [Tx `0xafd7d...f9d6`](https://sepolia.arbiscan.io/tx/0xafd7d2a46277acf61a26bcd6094b311b0031139342702bad0aa472a64758f9d6) (Block `325057217`)
- **P1 Read-only Freeze Check**: Reverted with `"Milestones frozen"` as expected.
- **P1 Unfreeze Milestones (Guardian)**: [Tx `0x6b8e1...5c94`](https://sepolia.arbiscan.io/tx/0x6b8e1a5717fad5be8ab1315e0d39dc7940b53376da1a0ef14be378612b745c94) (Block `325057225`)
- **P1 Execute Final Milestone (Relayer) & Complete Project**: [Tx `0x78151...81c5`](https://sepolia.arbiscan.io/tx/0x78151a32d2a9ff01733de8cb1e859cf37fb8551d86dabd4aac80f250d77281c5) (Block `325057233`)
- **P1 Unstake (Investor B)**: [Tx `0xc2c5f...42eb`](https://sepolia.arbiscan.io/tx/0xc2c5fd3f6abd166ed2fbb4f5fb7c33665c8986b278e55449eabf3e84476142eb) (Block `325057242`)

#### Phase 7: Dev Handover, Cancellation, Dead Refund & Shutdown (`07-cancel-refund.ts`)
- **P2 Propose Developer (Buyer)**: [Tx `0x04e1c...7d46`](https://sepolia.arbiscan.io/tx/0x04e1c498769dcc2d739095f0aa79de11b28b6f1975bfb6732ef084482f0a7d46) (Block `325058289`)
- **P2 Accept Developer (Buyer)**: [Tx `0xf6a9d...9aad`](https://sepolia.arbiscan.io/tx/0xf6a9dd1ff500e0a07d9f279412a77fcfd4c747ead7d789120c252fd6c6b99aad) (Block `325058297`)
- **P2 Claim Creator Funds (Buyer as new developer)**: [Tx `0x6866f...67ca`](https://sepolia.arbiscan.io/tx/0x6866f90eac978453d5ae50b3b7c22c87adf87ae01c298abcd5afc4b35a9867ca) (Block `325058305`)
- **P2 Claim Treasury Funds**: [Tx `0xbc251...4fc9`](https://sepolia.arbiscan.io/tx/0xbc2517f6d303e91d73c6957c7cbca9c8a88a97830efdc906f6956795ee6c4fc9) (Block `325058313`)
- **P2 Cancel Project (Buyer)**: [Tx `0x9d5f5...04aa`](https://sepolia.arbiscan.io/tx/0x9d5f5cd42230b75d5e8f5f99bd3758e4e484a0c9dd4b9c73e24f21aec60304aa) (Block `325058321`)
- **P2 Approve Escrow (Investor B)**: [Tx `0xa814e...d581`](https://sepolia.arbiscan.io/tx/0xa814e9223be2f8cf3c33176e92c0208ce61f641691458a4b7676d5b65b5fd581) (Block `325058330`)
- **P2 Dead Project Refund (Investor B)**: [Tx `0xe944c...f6a3`](https://sepolia.arbiscan.io/tx/0xe944cecad88b2fd3e438d4b178c3b9a12335c5b1f9470da0ccaeec7d1526f6a3) (Block `325058337`)
- **P2 Emergency Shutdown (Guardian)**: [Tx `0xfcded...bebb`](https://sepolia.arbiscan.io/tx/0xfcded98f159d387e1e4450b5c511d5ccd7308c60c255342c1b74b5cffe8dbebb) (Block `325058344`)

#### Phase 8: Failed Crowdfund (`08-failed-crowdfund.ts`)
- **Status**: ⏳ Waiting on on-chain duration. Funding deadline passes ~24 hours after block `325053167`. Execution will be run once deadline timestamp is reached.

#### Phase 9: Gas Debt & Overflow (`09-gasdebt.ts`)
- **P4 Launch**: [Tx `0xddce5...3b1a`](https://sepolia.arbiscan.io/tx/0xddce589b95c57ec335ce41631fd3badb5d24ed5e5d415fb9b72ef7fecb543b1a) (Block `325060241`)
- **P4 Investor A Deposit (0.0044 ETH)**: [Tx `0x4aa7b...3a6a`](https://sepolia.arbiscan.io/tx/0x4aa7b045d885f283368d7f2d861f178d585bf378f5b1478e04228d1a841e3a6a) (Block `325060252`)
- **P4 Close Funding**: [Tx `0x3e2f9...3907`](https://sepolia.arbiscan.io/tx/0x3e2f91b43184a79c552c02bd1ea31b42b9ac0342c1a23fa1bc758d38f1013907) (Block `325060260`)
- **P4 Claim Tokens (Sponsored Relayer)**: [Tx `0xf4cd5...6404`](https://sepolia.arbiscan.io/tx/0xf4cd5cf04166124682069bf8fbe77741b3b2ea0b4288ab44eccdda2997586404) (Block `325060268`)
- **P4 Stake With Permit (Sponsored Relayer)**: [Tx `0x5204d...4b68`](https://sepolia.arbiscan.io/tx/0x5204d49c39349ce6f5caa0f0ef8f8d6465985363239868a4aae24e70708c4b68) (Block `325060279`)
- **P4 Start Milestone 0**: [Tx `0x757ef...aa81`](https://sepolia.arbiscan.io/tx/0x757ef752916a85e39ca8e4efad3bc845c0c65a87be409121a467537c669eaa81) (Block `325060287`)
- **P4 VoteBySig (Sponsored Relayer)**: [Tx `0x877c5...63ab`](https://sepolia.arbiscan.io/tx/0x877c5abd27502c334fd5e6c1b2d82797ae262265ea45d0af42970b87dd7063ab) (Block `325060296`)
- **P4 Execute Milestone & Gas Debt Recovery**: [Tx `0x48a3b...490a`](https://sepolia.arbiscan.io/tx/0x48a3bffb04eccde0c0af6e996066243c14543a1081f2a1eb0f6dba8497f6490a) (Block `325060304`)
- **Gas Ledger Verification**:
  - Initial Budget: `0.00022 ETH`
  - Total Gas Spent: `0.000252988481968542 ETH`
  - **Recovered from Developer Payout (`GasDebtRecovered`)**: `0.000032988481968542 ETH`

---

## 3. BSC Testnet (Chain ID: `97`)

- **Explorer**: [https://testnet.bscscan.com](https://testnet.bscscan.com)
- **Execution Date**: 2026-11-01

### Test Wallets & Roles

| Role | Signer Index | Public Address |
| :--- | :---: | :--- |
| **Guardian / Treasury / Deployer** | 0 | `0x08D3B18508ca976fECc7291c06c30ae15133eB4F` |
| **Developer** | 1 | `0xDB9C736d60e1773037d6c2232C73FC9f39d3d467` |
| **Investor A** | 2 | `0x968Ee2C766252a096e6b50eCA69b7d658d5E66DE` |
| **Investor B** | 3 | `0xB3feCEEDB8BEe98F5ee16189A670F1dd23E753D5` |
| **Buyer** | 4 | `0x6CA6098Fc69A9d44Cfa79ad6BBa033F5B61a1219` |
| **Relayer** | 5 | `0x8a1Be9d8fd97658b6b0B8b537374FF6c3E41815b` |

### Overall Status Summary

| Phase | Script | Target | Status | Notes |
| :---: | :--- | :---: | :---: | :--- |
| **00** | `00-check.ts` | All | ✅ **PASSED** | Roles, contracts, allowlists verified. |
| **01** | `01-launch.ts` | P1, P2, P3 | ✅ **PASSED** | 3 projects cloned and initialized via `ForgeCapitaFactory`. |
| **02** | `02-fund.ts` | P1, P2, P3 | ✅ **PASSED** | Deposits received, funding goals met, platform fees transferred. |
| **03** | `03-claim-stake.ts` | P1, P2 | ✅ **PASSED** | Direct claims, relayer claims, and ERC-2612 gasless permit staking. |
| **04** | `04-p2p.ts` | P1 | ✅ **PASSED** | Secondary listings, trade execution (1% fee), and cancellation. |
| **05** | `05-revenue.ts` | P1, P2 | ✅ **PASSED** | Product sales split (1% fee, 24% dev, 75% stakers) and 0-staker fallback. |
| **06** | `06-vote-execute.ts` | P1 | ✅ **PASSED** | EIP-712 `voteBySig`, guardian freeze/unfreeze, completion & vesting. |
| **07** | `07-cancel-refund.ts` | P2 | ✅ **PASSED** | Dev role handover, cancellation, dead refund, and emergency shutdown. |
| **08** | `08-failed-crowdfund.ts` | P3 | ⏳ *Pending* | (Requires 24h wait after Phase 01: ~2026-11-02 22:45 UTC+5:30) |
| **09** | `09-gasdebt.ts` | P4 | ✅ **PASSED** | Relayer-sponsored actions executed; booked gas within budget (no debt). |

---

### Deployed Project Contracts (BSC Testnet)

| Project | Key Purpose | Token Address | MilestoneEscrow | DividendDistributor | RevenueRouter |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **P1** | Happy Path Lifecycle | [`0x231Ac...099C`](https://testnet.bscscan.com/address/0x231Ac434a472869a949e87f60AcF73b174cD099C) | [`0xd2eeC...6346`](https://testnet.bscscan.com/address/0xd2eeC04FEBbA72507Db202dff5a269f26fc56346) | [`0xc2975...23Ad`](https://testnet.bscscan.com/address/0xc29753BfE842BAC649D9e5c997397F6b51d623Ad) | [`0x8d18D...0766`](https://testnet.bscscan.com/address/0x8d18DD4d36b7f25e9A53ae7F5020C4FbF6F80766) |
| **P2** | Failure & Shutdown | [`0xb5B4d...0a1e`](https://testnet.bscscan.com/address/0xb5B4d00944fd9A8c78B9f30a69574fC04A900a1e) | [`0xBF75e...7744`](https://testnet.bscscan.com/address/0xBF75ecAAee69C542FE1109bF4E5e25F2EAd87744) | [`0x6aEb5...A192`](https://testnet.bscscan.com/address/0x6aEb57acEb2284419F49188022383781d00fA192) | [`0xedD8c...76DB`](https://testnet.bscscan.com/address/0xedD8c3Ea9cc1f3e58D14d7B5AbEd3CEe509076DB) |
| **P3** | Failed Crowdfund | [`0x1B9bB...1DC2`](https://testnet.bscscan.com/address/0x1B9bBf0676769319032EE915D80ECedf1f5A1DC2) | [`0xB3249...d63F`](https://testnet.bscscan.com/address/0xB324900b7C3dE4B3bA98e37a60B6554f864Dd63F) | [`0x396d2...0276`](https://testnet.bscscan.com/address/0x396d25707B873546B695d394e8F3A05B96ac0276) | [`0xe9c61...dbcD`](https://testnet.bscscan.com/address/0xe9c6113879512978E357e08d5365a4957F3EdbcD) |
| **P4** | Gas Debt Recovery | [`0xE2b7d...8A0d`](https://testnet.bscscan.com/address/0xE2b7d1dc959937C7c5524A01be07906eB3518A0d) | [`0x5745A...c815`](https://testnet.bscscan.com/address/0x5745A30aFd6ebac1D68258eA5477C7E36486c815) | [`0x6EA0F...f8aF`](https://testnet.bscscan.com/address/0x6EA0F97718CbaE28d5eC5988Dab22D1DE057f8aF) | [`0x2F5A4...8140`](https://testnet.bscscan.com/address/0x2F5A4e77Ac2892C2dc9e587bF577AC35027a8140) |

---

### Execution Steps & Transaction Records (BSC Testnet)

#### Phase 1: Launch (`01-launch.ts`)
- **P1 Launch**: [Tx `0xd86ef...542a`](https://testnet.bscscan.com/tx/0xd86ef26580bc305e8f13fe8276cce7c9d9d12fd9a6f2f5bc66c5081896dd542a) (Block `140234526`)
- **P2 Launch**: [Tx `0x8615b...2705`](https://testnet.bscscan.com/tx/0x8615b8517812aefe18c7c6f6ea50e5d7f44d51b6c8f1958e8bb48e3691902705) (Block `140234532`)
- **P3 Launch**: [Tx `0x1b814...7d00`](https://testnet.bscscan.com/tx/0x1b814a901c6197e4cf0dc288fd9627f7d240b0943239f1c0a402e28e45107d00) (Block `140234544`)

#### Phase 2: Funding & Close (`02-fund.ts`)
- **P1 Investor A Deposit (0.03 tBNB)**: [Tx `0x6f27e...dcab`](https://testnet.bscscan.com/tx/0x6f27ec11bb15e4b8f644496e78c556207e56b838dc5ef1754aaaf9f6f127dcab) (Block `140234953`)
- **P1 Investor B Deposit (0.02 tBNB)**: [Tx `0x8dc9d...f0ed`](https://testnet.bscscan.com/tx/0x8dc9df571313ae113ceb240b7f0da4f0f3c200e630efdc3fbd4ca770e198f0ed) (Block `140234958`)
- **P1 Close Funding (Developer)**: [Tx `0xfe769...1609`](https://testnet.bscscan.com/tx/0xfe7697ff0de36b5dcda6f01f31e3c4eb57a3b029cdc9117870d1d60d17181609) (Block `140234963`)
- **P2 Investor B Deposit (0.004 tBNB)**: [Tx `0x58c8f...94f5`](https://testnet.bscscan.com/tx/0x58c8fe9477ca40f2cff3356cecf0b4523654aec4849e59961dc2f303882b94f5) (Block `140234976`)
- **P2 Close Funding (Developer)**: [Tx `0xeeb5b...3b59`](https://testnet.bscscan.com/tx/0xeeb5b6cf5b171ec0ee13dbacc289017b252703f08f54df65171568380c053b59) (Block `140234980`)
- **P3 Investor B Deposit (0.002 tBNB)**: [Tx `0x834ae...4a04`](https://testnet.bscscan.com/tx/0x834ae3b189747dbdc4259a4eeb84e99b5eda2a551a4f1f0bdec4e2c055f34a04) (Block `140234984`)

#### Phase 3: Claim & Stake (`03-claim-stake.ts`)
- **P1 Claim Tokens (Investor A, direct)**: [Tx `0x977fb...bdb7`](https://testnet.bscscan.com/tx/0x977fb42582ce02e18ad28a1edeba92d299159e4e28d86937906cb886df34bdb7) (Block `140235382`)
- **P1 Claim Tokens (Investor B, sponsored relayer)**: [Tx `0x4e71d...e8cb`](https://testnet.bscscan.com/tx/0x4e71db1a0b36670c778a34f81559fb2b6836165f5c11e09da740c44724d0e8cb) (Block `140235387`)
- **P1 Gasless Stake With Permit (Investor A, sponsored)**: [Tx `0x25f34...1b5b`](https://testnet.bscscan.com/tx/0x25f34aeb76d8f7faba93f0808557b95406889248483abf20c93fd6acf7f61b5b) (Block `140235395`)
- **P1 Approve Distributor (Investor B)**: [Tx `0xcdace...9fcb`](https://testnet.bscscan.com/tx/0xcdace8949148da796d6d68893dfa783ae65c16054b4b386441b4a3e513b09fcb) (Block `140235408`)
- **P1 Stake Direct (Investor B)**: [Tx `0xf992e...f8e0`](https://testnet.bscscan.com/tx/0xf992e2cf53eeaa832e66c1f80b821e4eaaa21085bae396f042a1a8a17ab8f8e0) (Block `140235415`)
- **P2 Claim Tokens (Investor B)**: [Tx `0x26312...8820`](https://testnet.bscscan.com/tx/0x26312be9b8dbb617276270fddd55ca7d8039397ef443ea1e49bcdf8f29a98820) (Block `140235419`)

#### Phase 4: P2P Trading (`04-p2p.ts`)
- **Approve P2PExchange (Investor B)**: [Tx `0xe9415...45ae`](https://testnet.bscscan.com/tx/0xe9415debb56d5fa65647da298c97407813e57352332225783bf67826b76845ae) (Block `140235768`)
- **Create Listing 0 (10,000 tokens for 0.005 tBNB)**: [Tx `0xff499...df60`](https://testnet.bscscan.com/tx/0xff499f58d5c6f6c6e86ce6e0c532f098036e82643056072953db5be1d3f4df60) (Block `140235773`)
- **Create Listing 1 (5,000 tokens for 0.004 tBNB)**: [Tx `0xa74ba...78c5`](https://testnet.bscscan.com/tx/0xa74bae677477e96e3b551ef573de4b8a60d7a5d430dabd129cc252f5417378c5) (Block `140235778`)
- **Fill Listing 0 (Buyer)**: [Tx `0x12953...6961`](https://testnet.bscscan.com/tx/0x12953bc2042b3535766efa6ea8ef40ebecd9cf39e17e92b070c60eb9af896961) (Block `140235782`)
- **Cancel Listing 1 (Investor B)**: [Tx `0x923c0...82a5`](https://testnet.bscscan.com/tx/0x923c0b2641967d7977156bffd6cf73580e005b7bb2ebfc63b63aab47760f82a5) (Block `140235787`)

#### Phase 5: Revenue Routing & Dividends (`05-revenue.ts`)
- **P1 Pay Product (Buyer, 0.01 tBNB)**: [Tx `0xf4172...f014`](https://testnet.bscscan.com/tx/0xf4172ee233f35be07464415b704d0864fe6b0877f2c4106b9119815f0526f014) (Block `140236014`)
- **P1 Claim Yield (Investor A, staker)**: [Tx `0x1662f...eead`](https://testnet.bscscan.com/tx/0x1662f33fac466cf9466d1817d7448f1ce7fe078d47054f4a36d693410a5eeead) (Block `140236018`)
- **P1 Claim Creator Revenue (Developer)**: [Tx `0x52f36...cd99`](https://testnet.bscscan.com/tx/0x52f36807d1e785652cd91b2be6697f730a464992112a7cdfd004eb71b97ecd99) (Block `140236022`)
- **P1 Claim Treasury Fee (Guardian/Treasury)**: [Tx `0xa7ee2...552e`](https://testnet.bscscan.com/tx/0xa7ee2a72a5f7db15c59d50d046ae17ba56978d6b3402ec9783c0dbd910a8552e) (Block `140236029`)
- **P2 Pay Product (Zero-Staker Fallback, Buyer)**: [Tx `0x71afb...6cb6`](https://testnet.bscscan.com/tx/0x71afb055a6a16ccb82023cdbccb6ae90d4796a3d813af90e417bb7ab01846cb6) (Block `140236033`)

#### Phase 6: Milestone Voting & Execution (`06-vote-execute.ts`)
- **P1 Start Milestone 0 (Developer)**: [Tx `0x23283...189c`](https://testnet.bscscan.com/tx/0x23283686fd0308f683d1ab050406e9d2fb0a2575b93abcda408bc8ba9275189c) (Block `140236452`)
- **P1 Sponsored VoteBySig Milestone 0 (Investor B via Relayer)**: [Tx `0x99503...db42`](https://testnet.bscscan.com/tx/0x99503f358b69a3dcc56ba44b62944da07102e177894f68ef5e2cf9250b38db42) (Block `140237304`)
- **P1 Direct Vote Milestone 0 (Investor A)**: [Tx `0xac7e9...c455`](https://testnet.bscscan.com/tx/0xac7e903983bc758cad4b7834fcb9fa48f8c8fbd7a8f8b9431e638298aa14c455) (Block `140237309`)
- **P1 Execute Milestone 0 (Sponsored Relayer)**: [Tx `0x90cfb...b40a`](https://testnet.bscscan.com/tx/0x90cfb318ca360284ce4aff6aec4b56102e3d4e395797aa0792034d02464bb40a) (Block `140237314`)
- **P1 Start Milestone 1 (Developer)**: [Tx `0x8363d...c078`](https://testnet.bscscan.com/tx/0x8363da0ddda56c2aac33a68c8ac62c2aeeda76f50587cc04b40e15572efbc078) (Block `140237319`)
- **P1 Direct Vote Against Milestone 1 (Investor B)**: [Tx `0x26bb7...7e42`](https://testnet.bscscan.com/tx/0x26bb79b8928a52fb564c9e0ae8e49e7d43502d4872e5957b8ad188fde7ad7e42) (Block `140237324`)
- **P1 Direct Vote For Milestone 1 (Investor A)**: [Tx `0x1dc8d...355c`](https://testnet.bscscan.com/tx/0x1dc8d7d5877ffa811fe3ef8d22efcd6377847b3580dedb027550d1afce35355c) (Block `140237328`)
- **P1 Freeze Milestones (Guardian)**: [Tx `0xa0205...e9c4`](https://testnet.bscscan.com/tx/0xa0205dada19fe7eb19d499d9c796a1b4b4fca33c51aa40a976e531a8284be9c4) (Block `140237333`)
- **P1 Check Frozen Execution Revert**: Verified read-only staticCall reverted with `"Milestones frozen"`.
- **P1 Unfreeze Milestones (Guardian)**: [Tx `0x9ab72...a296`](https://testnet.bscscan.com/tx/0x9ab72051b7ea50151220182a077355debbd65f9306ca0d79f37f8c26804da296) (Block `140237340`)
- **P1 Execute Final Milestone 1 (Sponsored Relayer, Completes Project)**: [Tx `0x3fb7c...1a9a`](https://testnet.bscscan.com/tx/0x3fb7c9d9bcea126f426b823b8934e1d29f0680297a4c1165c8643fe8a2cf1a9a) (Block `140237352`)
- **P1 Stake Withdrawal (Investor B)**: [Tx `0xd3315...476c`](https://testnet.bscscan.com/tx/0xd33158f48a7bf2c9f792e495590a472cb0d45ce796a943ed99998f5d30df476c) (Block `140237358`)

#### Phase 7: Project Cancellation & Refunds (`07-cancel-refund.ts`)
- **P2 Propose New Developer (Developer to Buyer)**: [Tx `0x68af4...3488`](https://testnet.bscscan.com/tx/0x68af4a3b70a158c9fda7bfdc354727490f0227e8aab5bd5695f107cb3a383488) (Block `140238169`)
- **P2 Accept Developer Role (Buyer)**: [Tx `0x628bb...9e35`](https://testnet.bscscan.com/tx/0x628bbede0c53780da12dc0adfd5dc5533bfcee6a2c7ae3dfa7aa28fd82ec9e35) (Block `140238175`)
- **P2 Claim Creator Funds (Buyer, as new developer)**: [Tx `0x96ccf...08e7`](https://testnet.bscscan.com/tx/0x96ccf6c47452ff9205223dd4e335e14ed4598a372808f6cafd9a39362bc708e7) (Block `140238181`)
- **P2 Claim Treasury Funds (Guardian/Treasury)**: [Tx `0xc1687...0648`](https://testnet.bscscan.com/tx/0xc16877915e43f6714706d29e47e864177dc5a8659d44be2a9116be9740a30648) (Block `140238188`)
- **P2 Cancel Project (Buyer, as new developer)**: [Tx `0x30c28...823e`](https://testnet.bscscan.com/tx/0x30c2811d66461f09e2d94905cf08dd6b6c9d7a0b46da5aabbe45ecd02a99823e) (Block `140238194`)
- **P2 Approve Escrow for Token Pull (Investor B)**: [Tx `0xbefba...a9ea`](https://testnet.bscscan.com/tx/0xbefba9c22b7785683ed7715ff144c746d12fe8f907ac9b82c43b3bc94244a9ea) (Block `140238201`)
- **P2 Refund Dead Project (Investor B)**: [Tx `0xf3c5d...8e03`](https://testnet.bscscan.com/tx/0xf3c5df77d542542de0aff83d627f5e27cc1685f1f35385fad5cb3911c22f8e03) (Block `140238207`)
- **P2 Emergency Shutdown (Guardian)**: [Tx `0x85182...98d3`](https://testnet.bscscan.com/tx/0x8518252854e14ea093b6df13066b4c5a44f19fc523141da84d96214ed0c398d3) (Block `140238216`)

#### Phase 9: Gas Debt Recovery (`09-gasdebt.ts`)
- **P4 Launch (Developer)**: [Tx `0x98f4d...9dea`](https://testnet.bscscan.com/tx/0x98f4dc1ae38172a28bbc2a5066f7dfda853d83b4dca1b9778f9001e94d649dea) (Block `140238513`)
- **P4 Deposit (Investor A, 0.0077 tBNB)**: [Tx `0xd5641...4a53`](https://testnet.bscscan.com/tx/0xd56417d9455cc8c9a6435f6044013773f4eae4ec87064662e7a361ee45fa4a53) (Block `140238520`)
- **P4 Close Funding (Developer)**: [Tx `0xac9f1...75a9`](https://testnet.bscscan.com/tx/0xac9f1a0933df4e22d2b299ff9eef64b074eb3c978070696116b50a5b8f2a75a9) (Block `140238525`)
- **P4 Claim Tokens (Sponsored Relayer for Investor A)**: [Tx `0x6e6d6...e139`](https://testnet.bscscan.com/tx/0x6e6d6a4bdf3a26749f79dba3c31f8e10c1b3b03e8dc69c8edde8d5040bbae139) (Block `140238531`)
- **P4 Stake With Permit (Sponsored Relayer for Investor A)**: [Tx `0xbc7b8...4b31`](https://testnet.bscscan.com/tx/0xbc7b82d9a659b1999c73ea58b8d765447df12f307b024e67d8fed85dddbf4b31) (Block `140238539`)
- **P4 Start Milestone 0 (Developer)**: [Tx `0xffaa7...1396`](https://testnet.bscscan.com/tx/0xffaa76353be2e7f8fc38bd8a9dff74d0d5265f42efae8bd517618ca852e21396) (Block `140238545`)
- **P4 VoteBySig Milestone 0 (Sponsored Relayer for Investor A)**: [Tx `0x3cd15...40e0`](https://testnet.bscscan.com/tx/0x3cd15bdf91fe3177f1af82548251110fd82f62e0afedf5e96c3aba337bf340e0) (Block `140238552`)
- **P4 Execute Milestone 0 (Sponsored Relayer)**: [Tx `0xee403...34cb`](https://testnet.bscscan.com/tx/0xee403aafa6e121bbc0f3904f9c02aa279a8288b8e073a041122e7d98d27534cb) (Block `140238557`)

**P4 Gas Ledger Outcome (BSC Testnet)**:
- Gas Budget: `0.000385 tBNB`
- Actual Gas Spent: `0.000197329 tBNB`
- Debt Recovered: `0.0 tBNB`
- *Observation*: Real transaction execution costs on BSC Testnet were ~50% below the gas cap, staying within the 5% raise budget. As designed, when costs remain within budget, no debt overflow occurs and the developer receives 100% of their milestone payout.










