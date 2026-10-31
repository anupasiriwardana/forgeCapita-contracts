# Deployments v2 (testnet)

Deployed by the user with `scripts/deploy.ts` on 2026-10-31. Deployer, treasury and Guardian are the same wallet at launch:
`0x08D3B18508ca976fECc7291c06c30ae15133eB4F`. The relayer is a separate wallet (set in CON-04.3).

The same addresses appear on both chains because the same deployer wallet sent the same transactions in the same order from the same nonce.

| Contract | Arbitrum Sepolia (421614) | BSC Testnet (97) |
|---|---|---|
| ForgeCapitaRegistry | `0x2e6A22fd249930b9F2905D1bD66443CbE366AacB` | `0x2e6A22fd249930b9F2905D1bD66443CbE366AacB` |
| Master ProjectToken | `0x09A7681d88480e9A9A77DF73487d4DCF2647C1F9` | `0x09A7681d88480e9A9A77DF73487d4DCF2647C1F9` |
| Master MilestoneEscrow | `0x68D18916A192ad520a60099Ba07d450aF0c48AD3` | `0x68D18916A192ad520a60099Ba07d450aF0c48AD3` |
| Master DividendDistributor | `0x68AAc848852c127137EEd01Db7950FbFc4d3526b` | `0x68AAc848852c127137EEd01Db7950FbFc4d3526b` |
| Master RevenueRouter | `0x646860b7F7d31F6e2779c35576724EDdB47bCdD9` | `0x646860b7F7d31F6e2779c35576724EDdB47bCdD9` |
| ForgeCapitaFactory | `0x246Ffa3Bf583a15e92e17FAa32d3663C17204d52` | `0x246Ffa3Bf583a15e92e17FAa32d3663C17204d52` |
| P2PExchange (created by the factory) | `0xd2540297eB8FC0985b5fa26cba2358db0a0AE914` | `0xd2540297eB8FC0985b5fa26cba2358db0a0AE914` |

## Indexer start blocks (block of the ForgeCapitaFactory creation transaction)

- Arbitrum Sepolia: `324727776`
- BSC Testnet: `140034644`

## Constructor arguments (for explorer verification)

- ForgeCapitaRegistry: `admin = 0x08D3B18508ca976fECc7291c06c30ae15133eB4F`
- Master ProjectToken, MilestoneEscrow, DividendDistributor, RevenueRouter: none
- ForgeCapitaFactory: `masterToken, masterEscrow, masterDistributor, masterRouter, registry` (the addresses above, in that order)
- P2PExchange: `registry = 0x2e6A22fd249930b9F2905D1bD66443CbE366AacB`

## Status

All items below are user-reported (2026-11-01); the registry reads on both explorers were checked by the user.

- [x] Verified on Arbiscan (CON-04.2)
- [x] Verified on BscScan (CON-04.2)
- [x] Registry cost settings applied on both chains (CON-04.3a): Arbitrum Sepolia 2e14 / BSC 3.5e14, surcharges per `scripts/postDeployConfig.ts`
- [x] Relayer address allow-listed on both chains (CON-04.3). Relayer: `0x8a1Be9d8fd97658b6b0B8b537374FF6c3E41815b`
  - `setRelayer` tx, Arbitrum Sepolia: `0x73a1615d7d0dd992e9e23b0311d6adca8c1c23a367edfee1db38b5b7ec06759d`
  - `setRelayer` tx, BSC Testnet: `0x1825ef8dbe33d7c559453b492820f0892e5ba7be0149e656f801394ca71d2f72`

Project clones created by the factory are EIP-1167 proxies and are not verified separately.
