// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";

/**
 * @title ChicagoStaking
 * @notice Stake CLT tokens for fixed durations to earn CIS (Chicago Influence Score) points.
 *         Supported lock durations: 90 days, 180 days, 360 days, 540 days.
 *         Users may hold multiple concurrent stakes.
 *         Stakes are fully locked — no early withdrawal under any circumstances.
 *         Owner retains emergency withdrawal capability for stuck funds only.
 */
contract ChicagoStaking is Ownable, ReentrancyGuard, Pausable {
    using SafeERC20 for IERC20;

    struct Stake {
        uint128 amount;
        uint64 startTime;
        uint64 endTime;
        bool withdrawn;
    }

    uint256 public constant DAY = 1 days;

    /// @dev Allowed lock durations in seconds
    uint256[4] public LOCK_DURATIONS = [
        90  * DAY,
        180 * DAY,
        360 * DAY,
        540 * DAY
    ];

    uint256 public minStakeAmount = 3_000 * 1e18;

    IERC20 public immutable clt;

    mapping(address => Stake[]) private _stakes;
    mapping(address => uint256) public totalStaked;

    uint256 public globalTotalStaked;

    /// @dev Enumerable list of every address that has ever staked, so
    ///      off-chain consumers (e.g. a leaderboard) can read the full set
    ///      of stakers directly from the contract instead of replaying logs.
    address[] private _stakers;
    mapping(address => bool) private _hasStaked;

    event Staked(
        address indexed staker,
        uint256 indexed stakeIndex,
        uint256 amount,
        uint256 duration,
        uint256 endTime
    );

    event Withdrawn(
        address indexed staker,
        uint256 indexed stakeIndex,
        uint256 amount
    );

    event MinStakeAmountUpdated(uint256 oldMin, uint256 newMin);
    event EmergencyWithdraw(address indexed staker, uint256 totalReturned);

    /**
     * @param _clt CLT token address (0xAE1e1b4D8f590371b77bEe27257ef038D4B835A1)
     */
    constructor(address _clt) Ownable(msg.sender) {
        require(_clt != address(0), "CLT address zero");
        clt = IERC20(_clt);
    }

    function stake(uint256 amount, uint256 duration)
        external
        nonReentrant
        whenNotPaused
    {
        require(amount >= minStakeAmount, "Below minimum stake of 3,000 CLT");
        require(_isValidDuration(duration), "Invalid lock duration");

        clt.safeTransferFrom(msg.sender, address(this), amount);

        if (!_hasStaked[msg.sender]) {
            _hasStaked[msg.sender] = true;
            _stakers.push(msg.sender);
        }

        uint64 start = uint64(block.timestamp);
        uint64 end = uint64(block.timestamp + duration);

        _stakes[msg.sender].push(Stake({
            amount: uint128(amount),
            startTime: start,
            endTime: end,
            withdrawn: false
        }));

        totalStaked[msg.sender] += amount;
        globalTotalStaked += amount;

        emit Staked(
            msg.sender,
            _stakes[msg.sender].length - 1,
            amount,
            duration,
            end
        );
    }

    /**
     * @notice Withdraw a single matured stake.
     * @param stakeIndex Index in the caller's stakes array.
     * @dev Reverts if the lock period has not yet expired.
     */
    function withdraw(uint256 stakeIndex)
        external
        nonReentrant
    {
        Stake storage s = _getActiveStake(msg.sender, stakeIndex);
        require(block.timestamp >= s.endTime, "Lock period not expired");

        uint256 amount = s.amount;

        //CEI: mark withdrawn before transfer
        s.withdrawn = true;
        totalStaked[msg.sender] -= amount;
        globalTotalStaked -= amount;

        clt.safeTransfer(msg.sender, amount);

        emit Withdrawn(msg.sender, stakeIndex, amount);
    }

    function withdrawAllMatured()
        external
        nonReentrant
        returns (uint256 totalReturned)
    {
        Stake[] storage userStakes = _stakes[msg.sender];
        for (uint256 i = 0; i < userStakes.length; i++) {
            Stake storage s = userStakes[i];
            if (s.withdrawn) continue;
            if (block.timestamp < s.endTime) continue;

            uint256 amount = s.amount;
            s.withdrawn = true;
            totalStaked[msg.sender] -= amount;
            globalTotalStaked -= amount;
            totalReturned += amount;

            emit Withdrawn(msg.sender, i, amount);
        }

        require(totalReturned > 0, "No matured stakes");
        clt.safeTransfer(msg.sender, totalReturned);
    }


    function getStakes(address staker)
        external
        view
        returns (Stake[] memory)
    {
        return _stakes[staker];
    }

    function getStake(address staker, uint256 index)
        external
        view
        returns (Stake memory)
    {
        require(index < _stakes[staker].length, "Index out of bounds");
        return _stakes[staker][index];
    }

    function stakeCount(address staker) external view returns (uint256) {
        return _stakes[staker].length;
    }

    /// @notice Total number of unique addresses that have ever staked.
    function stakersCount() external view returns (uint256) {
        return _stakers.length;
    }

    /// @notice Paginated list of every staker address, for building a
    ///         leaderboard directly from contract state (no log scanning).
    function getStakers(uint256 offset, uint256 limit)
        external
        view
        returns (address[] memory page)
    {
        uint256 total = _stakers.length;
        if (offset >= total) return new address[](0);
        uint256 end = offset + limit;
        if (end > total) end = total;
        page = new address[](end - offset);
        for (uint256 i = offset; i < end; i++) {
            page[i - offset] = _stakers[i];
        }
    }

    function getActiveStakes(address staker)
        external
        view
        returns (Stake[] memory active, uint256[] memory indices)
    {
        Stake[] storage all = _stakes[staker];
        uint256 count = 0;
        for (uint256 i = 0; i < all.length; i++) {
            if (!all[i].withdrawn) count++;
        }
        active  = new Stake[](count);
        indices = new uint256[](count);
        uint256 j = 0;
        for (uint256 i = 0; i < all.length; i++) {
            if (!all[i].withdrawn) {
                active[j]  = all[i];
                indices[j] = i;
                j++;
            }
        }
    }

    function timeRemaining(address staker, uint256 index)
        external
        view
        returns (uint256)
    {
        require(index < _stakes[staker].length, "Index out of bounds");
        Stake storage s = _stakes[staker][index];
        if (s.withdrawn || block.timestamp >= s.endTime) return 0;
        return s.endTime - block.timestamp;
    }

    function validDurations() external view returns (uint256[4] memory) {
        return LOCK_DURATIONS;
    }

    function setMinStakeAmount(uint256 newMin) external onlyOwner {
        require(newMin > 0, "Min must be > 0");
        emit MinStakeAmountUpdated(minStakeAmount, newMin);
        minStakeAmount = newMin;
    }

    /// @notice Pause staking (does not affect withdrawals).
    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    /**
     * @notice Emergency: return all CLT to a staker regardless of lock period.
     * @dev    Only callable by owner for genuine emergencies (e.g. contract migration) Does NOT penalise — returns full amount.
     */
    function emergencyWithdrawFor(address staker)
        external
        onlyOwner
        nonReentrant
    {
        Stake[] storage userStakes = _stakes[staker];
        uint256 total = 0;
        for (uint256 i = 0; i < userStakes.length; i++) {
            Stake storage s = userStakes[i];
            if (s.withdrawn) continue;
            uint256 amount = s.amount;
            s.withdrawn = true;
            totalStaked[staker] -= amount;
            globalTotalStaked   -= amount;
            total += amount;
        }
        require(total > 0, "Nothing to withdraw");
        clt.safeTransfer(staker, total);
        emit EmergencyWithdraw(staker, total);
    }

    function _isValidDuration(uint256 duration) internal view returns (bool) {
        for (uint256 i = 0; i < LOCK_DURATIONS.length; i++) {
            if (LOCK_DURATIONS[i] == duration) return true;
        }
        return false;
    }

    function _getActiveStake(address staker, uint256 index)
        internal
        view
        returns (Stake storage)
    {
        require(index < _stakes[staker].length, "Index out of bounds");
        Stake storage s = _stakes[staker][index];
        require(!s.withdrawn, "Already withdrawn");
        return s;
    }
}