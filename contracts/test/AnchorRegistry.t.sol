// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

import {AnchorRegistry} from "../src/AnchorRegistry.sol";

/// @notice 刻印のコントラクトの振る舞いを、仕様のシナリオ単位で検証する。
contract AnchorRegistryTest is Test {
    AnchorRegistry private registry;

    address private immutable WRITER = makeAddr("writer");
    address private immutable OTHER = makeAddr("other");

    bytes32 private constant HASH_A = keccak256("a");
    bytes32 private constant HASH_B = keccak256("b");

    uint32 private constant DATE = 20260913;

    function setUp() public {
        vm.prank(WRITER);
        registry = new AnchorRegistry(WRITER);
    }

    /// 対象日とリビジョンを 1 件だけ持つ刻印の配列を作る。
    function _one(uint32 date, uint32 revision, bytes32 recordHash)
        private
        pure
        returns (AnchorRegistry.Anchor[] memory items)
    {
        items = new AnchorRegistry.Anchor[](1);
        items[0] = AnchorRegistry.Anchor({date: date, revision: revision, recordHash: recordHash});
    }

    /// 刻印を 1 件、書き込み主体として送る。
    function _anchorOne(uint32 date, uint32 revision, bytes32 recordHash) private {
        vm.prank(WRITER);
        registry.anchor(_one(date, revision, recordHash));
    }

    // --- 刻印の単位と対象日の表現 ---

    /// シナリオ: 対象日の表現
    function test_storesHashUnderCalendarDateAsInteger() public {
        _anchorOne(DATE, 2, HASH_A);

        assertEq(registry.hashOf(20260913, 2), HASH_A);
        assertEq(registry.latestRevisionOf(20260913), 2);
    }

    // --- 書き込み主体の限定 ---

    /// シナリオ: 書き込み主体による刻印
    function test_writerCanAnchor() public {
        _anchorOne(DATE, 1, HASH_A);

        assertEq(registry.hashOf(DATE, 1), HASH_A);
    }

    /// シナリオ: 書き込み主体以外による刻印
    function test_nonWriterCannotAnchor() public {
        vm.prank(OTHER);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, OTHER));
        registry.anchor(_one(DATE, 1, HASH_A));

        assertEq(registry.hashOf(DATE, 1), bytes32(0));
        assertEq(registry.latestRevisionOf(DATE), 0);
    }

    // --- 書き込み主体の変更 ---

    /// シナリオ: 書き込み主体の変更
    function test_writerCanTransferWriteAuthority() public {
        _anchorOne(DATE, 1, HASH_A);

        vm.prank(WRITER);
        registry.transferOwnership(OTHER);

        vm.prank(OTHER);
        registry.anchor(_one(DATE, 2, HASH_B));
        assertEq(registry.hashOf(DATE, 2), HASH_B);

        // 変更前の刻印はそのまま照会できる。
        assertEq(registry.hashOf(DATE, 1), HASH_A);

        // 以前の書き込み主体は刻印できない。
        vm.prank(WRITER);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, WRITER));
        registry.anchor(_one(DATE, 3, HASH_A));
    }

    /// シナリオ: 書き込み主体以外による変更の要求
    function test_nonWriterCannotTransferWriteAuthority() public {
        vm.prank(OTHER);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, OTHER));
        registry.transferOwnership(OTHER);

        assertEq(registry.owner(), WRITER);
    }

    // --- リビジョンの単調増加 ---

    /// シナリオ: より大きいリビジョンの刻印
    function test_acceptsGreaterRevision() public {
        _anchorOne(DATE, 1, HASH_A);
        _anchorOne(DATE, 2, HASH_B);

        assertEq(registry.latestRevisionOf(DATE), 2);
        assertEq(registry.hashOf(DATE, 2), HASH_B);
    }

    /// シナリオ: 飛び番のリビジョンの刻印
    function test_acceptsSkippedRevision() public {
        _anchorOne(DATE, 1, HASH_A);
        _anchorOne(DATE, 3, HASH_B);

        assertEq(registry.latestRevisionOf(DATE), 3);
        assertEq(registry.hashOf(DATE, 3), HASH_B);
        assertEq(registry.hashOf(DATE, 2), bytes32(0));
    }

    /// シナリオ: 既存以下のリビジョンの刻印
    function test_rejectsRevisionNotGreaterThanLatest() public {
        _anchorOne(DATE, 3, HASH_A);

        vm.prank(WRITER);
        vm.expectRevert(
            abi.encodeWithSelector(AnchorRegistry.RevisionNotIncreasing.selector, DATE, 2, 3)
        );
        registry.anchor(_one(DATE, 2, HASH_B));

        vm.prank(WRITER);
        vm.expectRevert(
            abi.encodeWithSelector(AnchorRegistry.RevisionNotIncreasing.selector, DATE, 3, 3)
        );
        registry.anchor(_one(DATE, 3, HASH_B));

        assertEq(registry.latestRevisionOf(DATE), 3);
        assertEq(registry.hashOf(DATE, 3), HASH_A);
    }

    // --- 刻印の上書きと削除の禁止 ---

    /// シナリオ: 刻印済みのリビジョンへの別のハッシュの書き込み
    function test_cannotOverwriteAnchoredRevision() public {
        _anchorOne(DATE, 1, HASH_A);

        vm.prank(WRITER);
        vm.expectRevert(
            abi.encodeWithSelector(AnchorRegistry.RevisionNotIncreasing.selector, DATE, 1, 1)
        );
        registry.anchor(_one(DATE, 1, HASH_B));

        assertEq(registry.hashOf(DATE, 1), HASH_A);
    }

    // --- 空のハッシュの拒否 ---

    /// シナリオ: 空のハッシュの刻印
    function test_rejectsEmptyHash() public {
        vm.prank(WRITER);
        vm.expectRevert(abi.encodeWithSelector(AnchorRegistry.EmptyHash.selector, DATE, 1));
        registry.anchor(_one(DATE, 1, bytes32(0)));

        assertEq(registry.latestRevisionOf(DATE), 0);
    }

    // --- 複数件の一括刻印 ---

    /// シナリオ: すべて条件を満たす一括刻印
    function test_anchorsMultipleItemsInOneCall() public {
        AnchorRegistry.Anchor[] memory items = new AnchorRegistry.Anchor[](3);
        items[0] = AnchorRegistry.Anchor({date: 20260913, revision: 1, recordHash: HASH_A});
        items[1] = AnchorRegistry.Anchor({date: 20260914, revision: 1, recordHash: HASH_B});
        items[2] = AnchorRegistry.Anchor({date: 20260915, revision: 2, recordHash: HASH_A});

        vm.prank(WRITER);
        registry.anchor(items);

        assertEq(registry.hashOf(20260913, 1), HASH_A);
        assertEq(registry.hashOf(20260914, 1), HASH_B);
        assertEq(registry.hashOf(20260915, 2), HASH_A);
    }

    /// シナリオ: 条件を満たさない刻印を含む一括刻印
    function test_rejectsWholeBatchWhenOneItemFails() public {
        _anchorOne(20260914, 5, HASH_A);

        AnchorRegistry.Anchor[] memory items = new AnchorRegistry.Anchor[](3);
        items[0] = AnchorRegistry.Anchor({date: 20260913, revision: 1, recordHash: HASH_A});
        items[1] = AnchorRegistry.Anchor({date: 20260914, revision: 4, recordHash: HASH_B});
        items[2] = AnchorRegistry.Anchor({date: 20260915, revision: 1, recordHash: HASH_B});

        vm.prank(WRITER);
        vm.expectRevert(
            abi.encodeWithSelector(AnchorRegistry.RevisionNotIncreasing.selector, 20260914, 4, 5)
        );
        registry.anchor(items);

        assertEq(registry.hashOf(20260913, 1), bytes32(0));
        assertEq(registry.hashOf(20260915, 1), bytes32(0));
        assertEq(registry.hashOf(20260914, 5), HASH_A);
    }

    /// 1 回の送信に含める上限の件数（design 決定 5）でも、ブロックのガス上限に収まることを確かめる。
    /// `arc-forge test --gas-report` の anchor の値を、上限の妥当性の判断に用いる。
    function test_anchorsBatchAtSizeLimit() public {
        uint32 batchSize = 30;
        AnchorRegistry.Anchor[] memory items = new AnchorRegistry.Anchor[](batchSize);
        for (uint32 index = 0; index < batchSize; ++index) {
            items[index] =
                AnchorRegistry.Anchor({date: 20260901 + index, revision: 1, recordHash: HASH_A});
        }

        vm.prank(WRITER);
        registry.anchor(items);

        assertEq(registry.latestRevisionOf(20260901), 1);
        assertEq(registry.latestRevisionOf(20260901 + batchSize - 1), 1);
    }

    // --- チェーン上での照会 ---

    /// シナリオ: 刻印済みのリビジョンの照会
    function test_readsAnchoredHash() public {
        _anchorOne(DATE, 2, HASH_B);

        assertEq(registry.hashOf(DATE, 2), HASH_B);
    }

    /// シナリオ: 未刻印のリビジョンの照会
    function test_readsZeroForUnanchoredRevision() public {
        _anchorOne(DATE, 2, HASH_B);

        assertEq(registry.hashOf(DATE, 1), bytes32(0));
        assertEq(registry.hashOf(20260101, 2), bytes32(0));
    }

    /// シナリオ: 刻印のない対象日の最大のリビジョン
    function test_readsZeroLatestRevisionForUnanchoredDate() public view {
        assertEq(registry.latestRevisionOf(20260101), 0);
    }

    // --- 刻印ごとの記録の発行 ---

    /// シナリオ: 一括刻印での記録の発行
    function test_emitsOneEventPerAnchor() public {
        AnchorRegistry.Anchor[] memory items = new AnchorRegistry.Anchor[](2);
        items[0] = AnchorRegistry.Anchor({date: 20260913, revision: 1, recordHash: HASH_A});
        items[1] = AnchorRegistry.Anchor({date: 20260914, revision: 3, recordHash: HASH_B});

        vm.expectEmit(true, false, false, true, address(registry));
        emit AnchorRegistry.Anchored(20260913, 1, HASH_A);
        vm.expectEmit(true, false, false, true, address(registry));
        emit AnchorRegistry.Anchored(20260914, 3, HASH_B);

        vm.prank(WRITER);
        registry.anchor(items);
    }
}
