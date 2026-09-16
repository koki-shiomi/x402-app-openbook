/**
 * 刻印のコントラクト `AnchorRegistry` の ABI。
 *
 * `contracts/` のビルド結果（`arc-forge inspect src/AnchorRegistry.sol:AnchorRegistry abi --json`）
 * をそのまま写したもの。刻印と検証の双方がこの定数を参照する。コントラクトを変更したときは
 * 同時に更新する。一致は abi.test.ts で確認する。
 */
export const ANCHOR_REGISTRY_ABI = [
  {
    "type": "constructor",
    "inputs": [
      {
        "name": "initialWriter",
        "type": "address",
        "internalType": "address"
      }
    ],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "anchor",
    "inputs": [
      {
        "name": "items",
        "type": "tuple[]",
        "internalType": "struct AnchorRegistry.Anchor[]",
        "components": [
          {
            "name": "date",
            "type": "uint32",
            "internalType": "uint32"
          },
          {
            "name": "revision",
            "type": "uint32",
            "internalType": "uint32"
          },
          {
            "name": "recordHash",
            "type": "bytes32",
            "internalType": "bytes32"
          }
        ]
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "hashOf",
    "inputs": [
      {
        "name": "date",
        "type": "uint32",
        "internalType": "uint32"
      },
      {
        "name": "revision",
        "type": "uint32",
        "internalType": "uint32"
      }
    ],
    "outputs": [
      {
        "name": "recordHash",
        "type": "bytes32",
        "internalType": "bytes32"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "latestRevisionOf",
    "inputs": [
      {
        "name": "date",
        "type": "uint32",
        "internalType": "uint32"
      }
    ],
    "outputs": [
      {
        "name": "revision",
        "type": "uint32",
        "internalType": "uint32"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "owner",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "address",
        "internalType": "address"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "renounceOwnership",
    "inputs": [],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "transferOwnership",
    "inputs": [
      {
        "name": "newOwner",
        "type": "address",
        "internalType": "address"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "event",
    "name": "Anchored",
    "inputs": [
      {
        "name": "date",
        "type": "uint32",
        "indexed": true,
        "internalType": "uint32"
      },
      {
        "name": "revision",
        "type": "uint32",
        "indexed": false,
        "internalType": "uint32"
      },
      {
        "name": "recordHash",
        "type": "bytes32",
        "indexed": false,
        "internalType": "bytes32"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "OwnershipTransferred",
    "inputs": [
      {
        "name": "previousOwner",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "newOwner",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      }
    ],
    "anonymous": false
  },
  {
    "type": "error",
    "name": "EmptyHash",
    "inputs": [
      {
        "name": "date",
        "type": "uint32",
        "internalType": "uint32"
      },
      {
        "name": "revision",
        "type": "uint32",
        "internalType": "uint32"
      }
    ]
  },
  {
    "type": "error",
    "name": "OwnableInvalidOwner",
    "inputs": [
      {
        "name": "owner",
        "type": "address",
        "internalType": "address"
      }
    ]
  },
  {
    "type": "error",
    "name": "OwnableUnauthorizedAccount",
    "inputs": [
      {
        "name": "account",
        "type": "address",
        "internalType": "address"
      }
    ]
  },
  {
    "type": "error",
    "name": "RevisionNotIncreasing",
    "inputs": [
      {
        "name": "date",
        "type": "uint32",
        "internalType": "uint32"
      },
      {
        "name": "revision",
        "type": "uint32",
        "internalType": "uint32"
      },
      {
        "name": "latestRevision",
        "type": "uint32",
        "internalType": "uint32"
      }
    ]
  }
] as const;
