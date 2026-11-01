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
- **Status**: *Pending execution*

*(To be filled during BSC Testnet run)*

