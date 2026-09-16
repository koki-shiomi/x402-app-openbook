// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title AnchorRegistry
 * @notice 日次財務レコードのハッシュを、対象日とリビジョンごとに保持する。
 * @dev 刻印は追加のみで、上書きと削除の手段を持たない。同じ対象日には、既に刻印済みの
 *      最大のリビジョンより大きいリビジョンしか受け付けない。これにより「最大のリビジョンの
 *      刻印が現行の値」という検証の規則をコントラクト自身が保証する。
 *      検証者がイベントを走査せずに照会できるよう、ハッシュと最大のリビジョンを
 *      ストレージに保持する。仕様は openspec の anchor-registry を参照。
 */
contract AnchorRegistry is Ownable {
    /// @notice 1 件の刻印。
    /// @param date 対象日（UTC の暦日を YYYYMMDD 形式の整数で表す）
    /// @param revision 同一の対象日に対する通し番号（1 始まり）
    /// @param recordHash レコードのバイト列の SHA-256
    struct Anchor {
        uint32 date;
        uint32 revision;
        bytes32 recordHash;
    }

    /// @notice 刻印を反映したときに発行する。
    /// @param date 対象日（YYYYMMDD）
    /// @param revision リビジョン番号
    /// @param recordHash 刻印したハッシュ
    event Anchored(uint32 indexed date, uint32 revision, bytes32 recordHash);

    /// @notice すべてのバイトが 0 のハッシュは、未刻印を表す値と区別できないため受け付けない。
    error EmptyHash(uint32 date, uint32 revision);

    /// @notice 既に刻印済みの最大のリビジョン以下は受け付けない。
    error RevisionNotIncreasing(uint32 date, uint32 revision, uint32 latestRevision);

    /// 対象日とリビジョンごとの刻印されたハッシュ。未刻印は 0。
    mapping(uint32 date => mapping(uint32 revision => bytes32 recordHash)) private _hashes;

    /// 対象日ごとの刻印済みの最大のリビジョン。刻印がなければ 0。
    mapping(uint32 date => uint32 revision) private _latestRevisions;

    /// @param initialWriter 刻印を書き込める最初のアドレス。
    constructor(address initialWriter) Ownable(initialWriter) {}

    /**
     * @notice 複数の刻印をまとめて反映する。
     * @dev 1 件でも条件を満たさない場合は、全体を差し戻していずれの刻印も反映しない。
     *      一部だけ反映されると、送信側が成立した刻印を判定する処理を持つ必要が生じる。
     * @param items 反映する刻印。同じ対象日を複数含む場合もリビジョンは増加していること
     */
    function anchor(Anchor[] calldata items) external onlyOwner {
        for (uint256 index = 0; index < items.length; ++index) {
            Anchor calldata item = items[index];

            if (item.recordHash == bytes32(0)) {
                revert EmptyHash(item.date, item.revision);
            }

            uint32 latestRevision = _latestRevisions[item.date];
            if (item.revision <= latestRevision) {
                revert RevisionNotIncreasing(item.date, item.revision, latestRevision);
            }

            _hashes[item.date][item.revision] = item.recordHash;
            _latestRevisions[item.date] = item.revision;

            emit Anchored(item.date, item.revision, item.recordHash);
        }
    }

    /**
     * @notice 指定した対象日とリビジョンに刻印されたハッシュを返す。
     * @param date 対象日（YYYYMMDD）
     * @param revision リビジョン番号
     * @return recordHash 刻印されたハッシュ。未刻印の場合はすべてのバイトが 0
     */
    function hashOf(uint32 date, uint32 revision) external view returns (bytes32 recordHash) {
        return _hashes[date][revision];
    }

    /**
     * @notice 指定した対象日に刻印された最大のリビジョン番号を返す。
     * @param date 対象日（YYYYMMDD）
     * @return revision 最大のリビジョン番号。刻印がなければ 0
     */
    function latestRevisionOf(uint32 date) external view returns (uint32 revision) {
        return _latestRevisions[date];
    }
}
