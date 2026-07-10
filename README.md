# ChicagoStaking — Audit Repository

## Overview

ChicagoStaking is a token locking contract for the Chicago social platform. Users stake CLT tokens for fixed durations (90 / 180 / 360 / 540 days) to earn CIS (Chicago Influence Score) points computed off-chain. There are no on-chain token rewards the  contract holds principal only.

---

## Audit Scope

File | Status |

`contracts/ChicagoStaking.sol` | In scope
`contracts/MockERC20.sol` | Test helper only — not in scope
`scripts/` | Out of scope
`test/ChicagoStaking.test.js` | Reference only

---

## Deployments

Network | Contract | Address |
Ethereum Sepolia (testnet) | ChicagoStaking | `0x473352Fa4A3A579A21e921d12736AeC5d239C315`
Ethereum Sepolia (testnet) | MockCLT (test only) | `0x9b88bDF66905298B367D74Fa55A6A42CfC6bc82a`
Ethereum Mainnet | CLT Token (existing) | `0xAE1e1b4D8f590371b77bEe27257ef038D4B835A1`

Testnet verified on Etherscan Sepolia:
https://sepolia.etherscan.io/address/0x473352Fa4A3A579A21e921d12736AeC5d239C315#code

> Previous testnet deployment (`0x43436BA34Bab0040717A0b5698182e0C5019fc9c`) is retired — it had no way to
> enumerate stakers on-chain, which meant the leaderboard could only be built by replaying event logs from
> whatever block the backend last booted at, silently losing any stake made before a restart. See
> "Staker Enumeration" below.

---

## Contract Architecture

### Key Design Decisions

- **No early withdrawal.** Stakes are fully locked until expiry and only the owner can emergency-release funds for genuine migration scenarios.
- **No token rewards.** The contract holds principal only no reward tokens are distributed on-chain.
- **Immutable.** No proxy pattern. The contract is deployed once and is not upgradeable.
- **Multisig owner.** Before mainnet launch, ownership is transferred to a Gnosis Safe via `scripts/transfer-ownership.js`.

### User Roles

Role | Capabilities |
User | `stake()`, `withdraw()`, `withdrawAllMatured()` |
Owner (Gnosis Safe) | `setMinStakeAmount()`, `pause()`, `unpause()`, `emergencyWithdrawFor()` |

### Staker Enumeration

Added `_stakers` (address array) + `stakersCount()` / `getStakers(offset, limit)`. Before this, there was
no on-chain way to list "everyone who has staked" — only `totalStaked[address]`, a per-address lookup. The
backend leaderboard needs the full set of stakers, not just one address at a time.

The backend now syncs `user_stakes` by polling this directly (`stakersCount` → page through `getStakers` →
`getStakes(address)` per staker) every 15s, instead of reconstructing state from `Staked` event logs. This
is simpler and self-correcting: every poll reflects exactly what's on-chain right now, including
withdrawals, with no block-range tracking or backfill step needed.

### Lock Durations

| Duration | Seconds |

| 90 days | 7,776,000 |
| 180 days | 15,552,000 |
| 360 days | 31,104,000 |
| 540 days | 46,656,000 |

### Minimum Stake
3,000 CLT (`3_000 * 1e18`)

---

## CIS Scoring (Off-chain — context only)

The contract exposes `totalStaked[user]` and `getActiveStakes(user)`. The backend reads these and computes Staking Power (max 20,000 pts):

```
amountScore = min(15000, floor(15000 × log(1 + stakedCLT) / log(1 + MAX_SUPPLY)))
durationScore = floor(5000 × longestRemainingDays / 540)
stakingPower = amountScore + durationScore
```

No CIS logic exists on-chain.

---

## Setup & Running Tests

### Prerequisites
- Node.js >= 18
- npm

### Install
```bash
npm install
```

### Compile
```bash
npx hardhat compile
```

### Run Tests
```bash
npx hardhat test
```

---

## Known Limitations

- `uint128` amount: max ~3.4 × 10³⁸ wei — exceeds any realistic CLT supply.
- `uint64` timestamp: overflows year 2554 — not a practical concern.
- No reentrancy test with malicious ERC20 — recommended as part of audit scope.
- CIS scoring is fully off-chain; contract is intentionally minimal.

---

## Contact

- Developer: @0xEtherFren
- Project: Chicago (chicagonews.io)