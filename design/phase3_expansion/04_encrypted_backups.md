# Adding Encrypted State Backups

## Prerequisite

Phase 2 (ZK commitments, private state on device).

## Why It's Needed

In Phase 2, private state exists only on the player's device (browser localStorage). If the device is lost, the state is unrecoverable and the game is forfeited. Encrypted backups fix this.

## What Gets Added

### Backup Flow (After Each Turn)

```
1. Player submits turn on-chain (existing flow)
2. Client serializes full PrivateGameState
3. Client encrypts with a key derived from their StarkNet account:
   key = Poseidon(private_key, game_id, "BACKUP_KEY")
4. Client uploads encrypted blob to IPFS
5. Client stores the IPFS CID on-chain:
   set_backup_ref(game_id, cid_as_felt252)
```

### Recovery Flow (New Device / After Crash)

```
1. Read CID from chain: get_backup_ref(game_id, player_address)
2. Fetch encrypted blob from IPFS
3. Derive decryption key from StarkNet account
4. Decrypt → deserialize → PrivateGameState
5. Verify: compute_commitment(recovered_state) == on_chain_commitment
6. If match: resume. If mismatch: backup is corrupt, game forfeited.
```

### Contract Changes

```cairo
// New storage
backup_refs: LegacyMap<(u64, ContractAddress), felt252>,  // IPFS CID

// New functions
fn set_backup_ref(ref self, game_id: u64, cid: felt252);
fn get_backup_ref(self: @TContractState, game_id: u64, player: ContractAddress) -> felt252;
```

### Security

- Only the player can decrypt (requires their StarkNet private key)
- On-chain commitment serves as checksum (corrupted backup detected)
- IPFS nodes can't read the data (encrypted)
- The backup ref is a single felt252 — negligible storage cost

### Dependencies

- IPFS gateway or pinning service (Pinata, Infura, etc.)
- Client-side encryption library (AES-256-GCM or ChaCha20-Poly1305)
- Symmetric key derivation from StarkNet account
