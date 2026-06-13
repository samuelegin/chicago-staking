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
Ethereum Sepolia (testnet) | ChicagoStaking  `0x43436BA34Bab0040717A0b5698182e0C5019fc9c` 
Ethereum Sepolia (testnet) | MockCLT (test only)`0xb0a75f1211B7e598FE23ce129eA4c010A3821ABb`
Ethereum Mainnet | CLT Token (existing) | `0xAE1e1b4D8f590371b77bEe27257ef038D4B835A1`

Testnet verified on Etherscan Sepolia:
https://sepolia.etherscan.io/address/0x43436BA34Bab0040717A0b5698182e0C5019fc9c#code

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