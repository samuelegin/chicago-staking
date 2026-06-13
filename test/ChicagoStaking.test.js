const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

const anyValue = () => true;

const DAY = 24 * 60 * 60;
const D90 = 90  * DAY;
const D180 = 180 * DAY;
const D360 = 360 * DAY;
const D540 = 540 * DAY;

const MIN_STAKE = ethers.parseEther("3000");
const TEN_K = ethers.parseEther("10000");
const FIVE_K = ethers.parseEther("5000");

describe("ChicagoStaking", function () {
  let staking, clt, owner, user1, user2;

  beforeEach(async () => {
    [owner, user1, user2] = await ethers.getSigners();

    const ERC20 = await ethers.getContractFactory("MockERC20");
    clt = await ERC20.deploy("Chicago Loyalty Token", "CLT", ethers.parseEther("10000000"));

    const Factory = await ethers.getContractFactory("ChicagoStaking");
    staking = await Factory.deploy(await clt.getAddress());

    await clt.transfer(user1.address, ethers.parseEther("100000"));
    await clt.transfer(user2.address, ethers.parseEther("100000"));

    await clt.connect(user1).approve(await staking.getAddress(), ethers.MaxUint256);
    await clt.connect(user2).approve(await staking.getAddress(), ethers.MaxUint256);
  });

  describe("Deployment", () => {
    it("sets CLT token address", async () => {
      expect(await staking.clt()).to.equal(await clt.getAddress());
    });

    it("sets owner correctly", async () => {
      expect(await staking.owner()).to.equal(owner.address);
    });

    it("sets default minStakeAmount to 3,000 CLT", async () => {
      expect(await staking.minStakeAmount()).to.equal(MIN_STAKE);
    });

    it("initialises globalTotalStaked to 0", async () => {
      expect(await staking.globalTotalStaked()).to.equal(0);
    });

    it("reverts if CLT address is zero", async () => {
      const Factory = await ethers.getContractFactory("ChicagoStaking");
      await expect(Factory.deploy(ethers.ZeroAddress))
        .to.be.revertedWith("CLT address zero");
    });

    it("exposes the 4 valid lock durations", async () => {
      const durations = await staking.validDurations();
      expect(durations.map(d => Number(d))).to.deep.equal([D90, D180, D360, D540]);
    });
  });

  describe("stake()", () => {
    it("emits Staked with correct args", async () => {
      const tx = staking.connect(user1).stake(MIN_STAKE, D90);
      await expect(tx)
        .to.emit(staking, "Staked")
        .withArgs(user1.address, 0, MIN_STAKE, D90, anyValue);
    });

    it("transfers CLT from staker to contract", async () => {
      const before = await clt.balanceOf(user1.address);
      await staking.connect(user1).stake(TEN_K, D90);
      expect(await clt.balanceOf(user1.address)).to.equal(before - TEN_K);
      expect(await clt.balanceOf(await staking.getAddress())).to.equal(TEN_K);
    });

    it("updates totalStaked and globalTotalStaked", async () => {
      await staking.connect(user1).stake(TEN_K, D90);
      expect(await staking.totalStaked(user1.address)).to.equal(TEN_K);
      expect(await staking.globalTotalStaked()).to.equal(TEN_K);
    });

    it("allows multiple concurrent stakes", async () => {
      await staking.connect(user1).stake(TEN_K,  D90);
      await staking.connect(user1).stake(FIVE_K, D180);
      expect(await staking.stakeCount(user1.address)).to.equal(2);
      expect(await staking.totalStaked(user1.address)).to.equal(TEN_K + FIVE_K);
    });

    it("accepts all 4 valid durations", async () => {
      for (const d of [D90, D180, D360, D540]) {
        await staking.connect(user1).stake(MIN_STAKE, d);
      }
      expect(await staking.stakeCount(user1.address)).to.equal(4);
    });

    it("reverts for invalid duration", async () => {
      await expect(staking.connect(user1).stake(TEN_K, 7 * DAY))
        .to.be.revertedWith("Invalid lock duration");
    });

    it("reverts below minimum stake (3,000 CLT)", async () => {
      const tooLow = ethers.parseEther("2999");
      await expect(staking.connect(user1).stake(tooLow, D90))
        .to.be.revertedWith("Below minimum stake of 3,000 CLT");
    });

    it("accepts exactly the minimum stake", async () => {
      await expect(staking.connect(user1).stake(MIN_STAKE, D90)).to.not.be.reverted;
    });

    it("reverts when paused", async () => {
      await staking.pause();
      await expect(staking.connect(user1).stake(TEN_K, D90))
        .to.be.revertedWithCustomError(staking, "EnforcedPause");
    });
  });

  describe("withdraw() — after lock expires", () => {
    beforeEach(async () => {
      await staking.connect(user1).stake(TEN_K, D90);
      await time.increase(D90 + 1);
    });

    it("returns full amount — no penalty", async () => {
      const before = await clt.balanceOf(user1.address);
      await staking.connect(user1).withdraw(0);
      expect(await clt.balanceOf(user1.address)).to.equal(before + TEN_K);
    });

    it("emits Withdrawn with correct args", async () => {
      await expect(staking.connect(user1).withdraw(0))
        .to.emit(staking, "Withdrawn")
        .withArgs(user1.address, 0, TEN_K);
    });

    it("decrements totalStaked and globalTotalStaked", async () => {
      await staking.connect(user1).withdraw(0);
      expect(await staking.totalStaked(user1.address)).to.equal(0);
      expect(await staking.globalTotalStaked()).to.equal(0);
    });

    it("marks stake as withdrawn", async () => {
      await staking.connect(user1).withdraw(0);
      const s = await staking.getStake(user1.address, 0);
      expect(s.withdrawn).to.be.true;
    });

    it("reverts on double withdraw", async () => {
      await staking.connect(user1).withdraw(0);
      await expect(staking.connect(user1).withdraw(0))
        .to.be.revertedWith("Already withdrawn");
    });
  });

  describe("withdraw() — before lock expires", () => {
    beforeEach(async () => {
      await staking.connect(user1).stake(TEN_K, D90);
      // do NOT advance time
    });

    it("reverts — lock period not expired", async () => {
      await expect(staking.connect(user1).withdraw(0))
        .to.be.revertedWith("Lock period not expired");
    });

    it("reverts for out-of-bounds index", async () => {
      await expect(staking.connect(user1).withdraw(99))
        .to.be.revertedWith("Index out of bounds");
    });
  });

  describe("withdrawAllMatured()", () => {
    it("withdraws all matured stakes in one tx", async () => {
      await staking.connect(user1).stake(TEN_K,  D90);
      await staking.connect(user1).stake(FIVE_K, D180);
      await time.increase(D180 + 1);

      const before = await clt.balanceOf(user1.address);
      await staking.connect(user1).withdrawAllMatured();
      expect(await clt.balanceOf(user1.address)).to.equal(before + TEN_K + FIVE_K);
      expect(await staking.totalStaked(user1.address)).to.equal(0);
    });

    it("skips still-locked stakes", async () => {
      await staking.connect(user1).stake(TEN_K,  D90);
      await staking.connect(user1).stake(FIVE_K, D540);
      await time.increase(D90 + 1);

      const before = await clt.balanceOf(user1.address);
      await staking.connect(user1).withdrawAllMatured();
      expect(await clt.balanceOf(user1.address)).to.equal(before + TEN_K);
      // D540 stake still locked
      expect(await staking.totalStaked(user1.address)).to.equal(FIVE_K);
    });

    it("reverts if no matured stakes", async () => {
      await staking.connect(user1).stake(TEN_K, D540);
      await expect(staking.connect(user1).withdrawAllMatured())
        .to.be.revertedWith("No matured stakes");
    });

    it("emits Withdrawn for each matured stake", async () => {
      await staking.connect(user1).stake(TEN_K,  D90);
      await staking.connect(user1).stake(FIVE_K, D90);
      await time.increase(D90 + 1);

      const tx = await staking.connect(user1).withdrawAllMatured();
      await expect(tx).to.emit(staking, "Withdrawn").withArgs(user1.address, 0, TEN_K);
      await expect(tx).to.emit(staking, "Withdrawn").withArgs(user1.address, 1, FIVE_K);
    });
  });

  describe("View functions", () => {
    beforeEach(async () => {
      await staking.connect(user1).stake(TEN_K,  D90);
      await staking.connect(user1).stake(FIVE_K, D180);
    });

    it("getStakes returns all stakes including withdrawn", async () => {
      const stakes = await staking.getStakes(user1.address);
      expect(stakes.length).to.equal(2);
    });

    it("getStake returns correct stake by index", async () => {
      const s = await staking.getStake(user1.address, 0);
      expect(s.amount).to.equal(TEN_K);
      expect(s.withdrawn).to.be.false;
    });

    it("getStake reverts on out-of-bounds", async () => {
      await expect(staking.getStake(user1.address, 99))
        .to.be.revertedWith("Index out of bounds");
    });

    it("stakeCount returns correct count", async () => {
      expect(await staking.stakeCount(user1.address)).to.equal(2);
    });

    it("stakeCount returns 0 for fresh address", async () => {
      expect(await staking.stakeCount(owner.address)).to.equal(0);
    });

    it("getActiveStakes returns only non-withdrawn", async () => {
      await time.increase(D90 + 1);
      await staking.connect(user1).withdraw(0);
      const { active, indices } = await staking.getActiveStakes(user1.address);
      expect(active.length).to.equal(1);
      expect(Number(indices[0])).to.equal(1);
    });

    it("timeRemaining returns > 0 before maturity", async () => {
      expect(await staking.timeRemaining(user1.address, 0)).to.be.gt(0);
    });

    it("timeRemaining returns 0 after maturity", async () => {
      await time.increase(D90 + 1);
      expect(await staking.timeRemaining(user1.address, 0)).to.equal(0);
    });

    it("timeRemaining returns 0 after withdrawal", async () => {
      await time.increase(D90 + 1);
      await staking.connect(user1).withdraw(0);
      expect(await staking.timeRemaining(user1.address, 0)).to.equal(0);
    });

    it("timeRemaining reverts on out-of-bounds", async () => {
      await expect(staking.timeRemaining(user1.address, 99))
        .to.be.revertedWith("Index out of bounds");
    });
  });

  describe("Owner functions", () => {
    it("owner can update minStakeAmount", async () => {
      await staking.setMinStakeAmount(ethers.parseEther("5000"));
      expect(await staking.minStakeAmount()).to.equal(ethers.parseEther("5000"));
    });

    it("emits MinStakeAmountUpdated", async () => {
      const newMin = ethers.parseEther("5000");
      await expect(staking.setMinStakeAmount(newMin))
        .to.emit(staking, "MinStakeAmountUpdated")
        .withArgs(MIN_STAKE, newMin);
    });

    it("reverts setMinStakeAmount(0)", async () => {
      await expect(staking.setMinStakeAmount(0))
        .to.be.revertedWith("Min must be > 0");
    });

    it("non-owner cannot call setMinStakeAmount", async () => {
      await expect(staking.connect(user1).setMinStakeAmount(ethers.parseEther("1")))
        .to.be.revertedWithCustomError(staking, "OwnableUnauthorizedAccount");
    });

    it("owner can pause and unpause", async () => {
      await staking.pause();
      await expect(staking.connect(user1).stake(TEN_K, D90))
        .to.be.revertedWithCustomError(staking, "EnforcedPause");
      await staking.unpause();
      await expect(staking.connect(user1).stake(TEN_K, D90)).to.not.be.reverted;
    });

    it("non-owner cannot pause", async () => {
      await expect(staking.connect(user1).pause())
        .to.be.revertedWithCustomError(staking, "OwnableUnauthorizedAccount");
    });

    it("owner can emergency withdraw for a user", async () => {
      await staking.connect(user1).stake(TEN_K, D540);
      const before = await clt.balanceOf(user1.address);
      await staking.emergencyWithdrawFor(user1.address);
      expect(await clt.balanceOf(user1.address)).to.equal(before + TEN_K);
    });

    it("emergencyWithdrawFor emits EmergencyWithdraw", async () => {
      await staking.connect(user1).stake(TEN_K, D540);
      await expect(staking.emergencyWithdrawFor(user1.address))
        .to.emit(staking, "EmergencyWithdraw")
        .withArgs(user1.address, TEN_K);
    });

    it("emergencyWithdrawFor reverts if nothing to withdraw", async () => {
      await expect(staking.emergencyWithdrawFor(user1.address))
        .to.be.revertedWith("Nothing to withdraw");
    });

    it("non-owner cannot call emergencyWithdrawFor", async () => {
      await staking.connect(user1).stake(TEN_K, D540);
      await expect(staking.connect(user1).emergencyWithdrawFor(user1.address))
        .to.be.revertedWithCustomError(staking, "OwnableUnauthorizedAccount");
    });
  });

  describe("Edge cases", () => {
    it("two users staking independently don't affect each other", async () => {
      await staking.connect(user1).stake(TEN_K,  D90);
      await staking.connect(user2).stake(FIVE_K, D180);

      expect(await staking.totalStaked(user1.address)).to.equal(TEN_K);
      expect(await staking.totalStaked(user2.address)).to.equal(FIVE_K);
      expect(await staking.globalTotalStaked()).to.equal(TEN_K + FIVE_K);
    });

    it("user2 cannot withdraw user1's stake (index OOB)", async () => {
      await staking.connect(user1).stake(TEN_K, D90);
      await time.increase(D90 + 1);
      await expect(staking.connect(user2).withdraw(0))
        .to.be.revertedWith("Index out of bounds");
    });

    it("globalTotalStaked stays consistent across stake/withdraw", async () => {
      await staking.connect(user1).stake(TEN_K,  D90);
      await staking.connect(user2).stake(FIVE_K, D90);
      await time.increase(D90 + 1);
      await staking.connect(user1).withdraw(0);
      expect(await staking.globalTotalStaked()).to.equal(FIVE_K);
      await staking.connect(user2).withdraw(0);
      expect(await staking.globalTotalStaked()).to.equal(0);
    });

    it("withdrawn stakes stay in getStakes with withdrawn=true", async () => {
      await staking.connect(user1).stake(TEN_K, D90);
      await time.increase(D90 + 1);
      await staking.connect(user1).withdraw(0);
      const stakes = await staking.getStakes(user1.address);
      expect(stakes[0].withdrawn).to.be.true;
      expect(stakes[0].amount).to.equal(TEN_K);
    });

    it("minStakeAmount enforced after owner update", async () => {
      await staking.setMinStakeAmount(ethers.parseEther("5000"));
      await expect(staking.connect(user1).stake(MIN_STAKE, D90))
        .to.be.revertedWith("Below minimum stake of 3,000 CLT");
      await expect(staking.connect(user1).stake(ethers.parseEther("5000"), D90))
        .to.not.be.reverted;
    });

    it("pause does not block withdrawals", async () => {
      await staking.connect(user1).stake(TEN_K, D90);
      await time.increase(D90 + 1);
      await staking.pause();
      // withdraw should still work while paused
      await expect(staking.connect(user1).withdraw(0)).to.not.be.reverted;
    });
  }); 

  describe("Reentrancy guard", () => {
    it("stake() is protected against reentrancy", async () => {
      expect(await staking.totalStaked(user1.address)).to.equal(0n);
      await staking.connect(user1).stake(TEN_K, D90);
      expect(await staking.totalStaked(user1.address)).to.equal(TEN_K);
    });
  });

  describe("withdrawAllMatured() — additional edge cases", () => {
    it("reverts if user has never staked", async () => {
      await expect(staking.connect(user2).withdrawAllMatured())
        .to.be.revertedWith("No matured stakes");
    });

    it("reverts if all stakes are still locked", async () => {
      await staking.connect(user1).stake(TEN_K, D540);
      await expect(staking.connect(user1).withdrawAllMatured())
        .to.be.revertedWith("No matured stakes");
    });

    it("is NOT blocked by pause", async () => {
      await staking.connect(user1).stake(TEN_K, D90);
      await time.increase(D90 + 1);
      await staking.pause();
      await expect(staking.connect(user1).withdrawAllMatured()).to.not.be.reverted;
    });
  });

  describe("Exact boundary: lock expiry at endTime", () => {
    it("withdraw reverts at exactly one second before endTime", async () => {
      await staking.connect(user1).stake(TEN_K, D90);
      const s = await staking.getStake(user1.address, 0);
      await time.setNextBlockTimestamp(Number(s.endTime) - 1);
      await expect(staking.connect(user1).withdraw(0))
        .to.be.revertedWith("Lock period not expired");
    });

    it("withdraw succeeds at exactly endTime (block.timestamp == endTime)", async () => {
      await staking.connect(user1).stake(TEN_K, D90);
      const s = await staking.getStake(user1.address, 0);
      await time.setNextBlockTimestamp(Number(s.endTime));
      await expect(staking.connect(user1).withdraw(0)).to.not.be.reverted;
    });
  });

  describe("emergencyWithdrawFor — multi-stake scenarios", () => {
    it("returns all stakes across different lock durations", async () => {
      await staking.connect(user1).stake(TEN_K, D90);
      await staking.connect(user1).stake(FIVE_K, D180);
      await staking.connect(user1).stake(MIN_STAKE, D360);

      const before = await clt.balanceOf(user1.address);
      const expected = TEN_K + FIVE_K + MIN_STAKE;

      await staking.emergencyWithdrawFor(user1.address);

      expect(await clt.balanceOf(user1.address)).to.equal(before + expected);
      expect(await staking.totalStaked(user1.address)).to.equal(0n);
      expect(await staking.globalTotalStaked()).to.equal(0n);
    });

    it("skips already-withdrawn stakes", async () => {
      await staking.connect(user1).stake(TEN_K, D90);
      await staking.connect(user1).stake(FIVE_K, D540);

      await time.increase(D90 + 1);
      await staking.connect(user1).withdraw(0);

      const before = await clt.balanceOf(user1.address);
      await staking.emergencyWithdrawFor(user1.address);
      expect(await clt.balanceOf(user1.address)).to.equal(before + FIVE_K);
    });
  });

  describe("setMinStakeAmount — does not affect existing stakes", () => {
    it("existing stake below new minimum can still be withdrawn", async () => {
      await staking.connect(user1).stake(MIN_STAKE, D90);
      await staking.setMinStakeAmount(ethers.parseEther("5000"));
      await time.increase(D90 + 1);
      await expect(staking.connect(user1).withdraw(0)).to.not.be.reverted;
    });

    it("new stake below raised minimum is rejected", async () => {
      await staking.setMinStakeAmount(ethers.parseEther("5000"));
      await expect(staking.connect(user1).stake(MIN_STAKE, D90))
        .to.be.revertedWith("Below minimum stake of 3,000 CLT");
    });
  });

  describe("getActiveStakes — edge cases", () => {
    it("returns empty arrays for address with no stakes", async () => {
      const [active, indices] = await staking.getActiveStakes(user2.address);
      expect(active.length).to.equal(0);
      expect(indices.length).to.equal(0);
    });

    it("returns empty arrays after all stakes withdrawn", async () => {
      await staking.connect(user1).stake(TEN_K, D90);
      await time.increase(D90 + 1);
      await staking.connect(user1).withdraw(0);
      const [active] = await staking.getActiveStakes(user1.address);
      expect(active.length).to.equal(0);
    });
  });

  describe("Zero-balance stake attempt", () => {
    it("reverts when user has no CLT balance", async () => {
      const [, , , broke] = await ethers.getSigners();
      await clt.connect(broke).approve(await staking.getAddress(), ethers.MaxUint256);
      await expect(staking.connect(broke).stake(MIN_STAKE, D90))
        .to.be.reverted;
    });
  });

});