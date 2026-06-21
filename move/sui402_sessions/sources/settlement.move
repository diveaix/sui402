module sui402_sessions::settlement;

use sui::event;
use sui::object::{Self, ID, UID};
use sui::table::{Self, Table};
use sui::transfer;
use sui::tx_context::{Self, TxContext};

const E_EMPTY_BATCH: u64 = 1;
const E_EMPTY_RECEIPT_ID: u64 = 2;
const E_ZERO_AMOUNT: u64 = 3;
const E_RECEIPT_ALREADY_SETTLED: u64 = 4;
const E_BATCH_LENGTH_MISMATCH: u64 = 5;

public struct SettlementLedger has key, store {
    id: UID,
    owner: address,
    settled_receipts: Table<vector<u8>, ConsumedReceipt>,
    receipt_count: u64,
    total_amount: u64,
}

public struct ConsumedReceipt has copy, drop, store {
    payer: address,
    merchant: address,
    signer: address,
    amount: u64,
    sequence: u64,
    resource_scope_hash: vector<u8>,
}

public struct ReceiptSettled<phantom T> has copy, drop {
    ledger_id: ID,
    receipt_id: vector<u8>,
    payer: address,
    merchant: address,
    signer: address,
    amount: u64,
    sequence: u64,
    resource_scope_hash: vector<u8>,
    submitter: address,
}

public struct BatchSettled<phantom T> has copy, drop {
    ledger_id: ID,
    merchant: address,
    receipt_count: u64,
    total_amount: u64,
    submitter: address,
}

public fun create_ledger(ctx: &mut TxContext) {
    let sender = ctx.sender();
    let ledger = new_ledger(sender, ctx);
    transfer::transfer(ledger, sender);
}

public fun settle_receipt<T>(
    ledger: &mut SettlementLedger,
    receipt_id: vector<u8>,
    payer: address,
    merchant: address,
    signer: address,
    amount: u64,
    sequence: u64,
    resource_scope_hash: vector<u8>,
    ctx: &TxContext,
) {
    settle_one<T>(ledger, receipt_id, payer, merchant, signer, amount, sequence, resource_scope_hash, ctx);
}

public fun settle_batch<T>(
    ledger: &mut SettlementLedger,
    receipt_ids: vector<vector<u8>>,
    payers: vector<address>,
    merchant: address,
    signer: address,
    amounts: vector<u64>,
    sequences: vector<u64>,
    resource_scope_hashes: vector<vector<u8>>,
    ctx: &TxContext,
) {
    let batch_len = receipt_ids.length();
    assert!(batch_len > 0, E_EMPTY_BATCH);
    assert!(payers.length() == batch_len, E_BATCH_LENGTH_MISMATCH);
    assert!(amounts.length() == batch_len, E_BATCH_LENGTH_MISMATCH);
    assert!(sequences.length() == batch_len, E_BATCH_LENGTH_MISMATCH);
    assert!(resource_scope_hashes.length() == batch_len, E_BATCH_LENGTH_MISMATCH);

    let mut batch_total = 0;
    let mut i = 0;
    while (i < batch_len) {
        let amount = amounts[i];
        settle_one<T>(
            ledger,
            receipt_ids[i],
            payers[i],
            merchant,
            signer,
            amount,
            sequences[i],
            resource_scope_hashes[i],
            ctx,
        );
        batch_total = batch_total + amount;
        i = i + 1;
    };

    event::emit(BatchSettled<T> {
        ledger_id: object::id(ledger),
        merchant,
        receipt_count: batch_len,
        total_amount: batch_total,
        submitter: ctx.sender(),
    });
}

public fun is_settled(ledger: &SettlementLedger, receipt_id: vector<u8>): bool {
    ledger.settled_receipts.contains(receipt_id)
}

public fun receipt_count(ledger: &SettlementLedger): u64 {
    ledger.receipt_count
}

public fun total_amount(ledger: &SettlementLedger): u64 {
    ledger.total_amount
}

public fun owner(ledger: &SettlementLedger): address {
    ledger.owner
}

fun new_ledger(owner: address, ctx: &mut TxContext): SettlementLedger {
    SettlementLedger {
        id: object::new(ctx),
        owner,
        settled_receipts: table::new(ctx),
        receipt_count: 0,
        total_amount: 0,
    }
}

fun settle_one<T>(
    ledger: &mut SettlementLedger,
    receipt_id: vector<u8>,
    payer: address,
    merchant: address,
    signer: address,
    amount: u64,
    sequence: u64,
    resource_scope_hash: vector<u8>,
    ctx: &TxContext,
) {
    assert!(receipt_id.length() > 0, E_EMPTY_RECEIPT_ID);
    assert!(amount > 0, E_ZERO_AMOUNT);
    assert!(!ledger.settled_receipts.contains(copy receipt_id), E_RECEIPT_ALREADY_SETTLED);

    ledger.settled_receipts.add(
        copy receipt_id,
        ConsumedReceipt {
            payer,
            merchant,
            signer,
            amount,
            sequence,
            resource_scope_hash: copy resource_scope_hash,
        },
    );
    ledger.receipt_count = ledger.receipt_count + 1;
    ledger.total_amount = ledger.total_amount + amount;

    event::emit(ReceiptSettled<T> {
        ledger_id: object::id(ledger),
        receipt_id,
        payer,
        merchant,
        signer,
        amount,
        sequence,
        resource_scope_hash,
        submitter: ctx.sender(),
    });
}

#[test_only]
public fun new_ledger_for_testing(owner: address, ctx: &mut TxContext): SettlementLedger {
    new_ledger(owner, ctx)
}

#[test_only]
public fun destroy_for_testing(ledger: SettlementLedger) {
    let SettlementLedger {
        id,
        owner: _,
        settled_receipts,
        receipt_count: _,
        total_amount: _,
    } = ledger;
    settled_receipts.drop();
    id.delete();
}
