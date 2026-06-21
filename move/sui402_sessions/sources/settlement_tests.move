#[test_only]
module sui402_sessions::settlement_tests;

use std::unit_test::assert_eq;
use sui::sui::SUI;
use sui::tx_context;
use sui402_sessions::settlement;

const E_RECEIPT_ALREADY_SETTLED: u64 = 4;

#[test]
fun single_receipt_updates_totals() {
    let ctx = &mut tx_context::dummy();
    let owner = @0xA;
    let payer = @0xB;
    let merchant = @0xC;
    let signer = @0xD;
    let receipt_id = b"receipt-1";
    let mut ledger = settlement::new_ledger_for_testing(owner, ctx);

    settlement::settle_receipt<SUI>(
        &mut ledger,
        receipt_id,
        payer,
        merchant,
        signer,
        100,
        1,
        b"scope-hash",
        ctx,
    );

    assert_eq!(settlement::owner(&ledger), owner);
    assert_eq!(settlement::receipt_count(&ledger), 1);
    assert_eq!(settlement::total_amount(&ledger), 100);
    assert!(settlement::is_settled(&ledger, receipt_id));

    settlement::destroy_for_testing(ledger);
}

#[test]
fun batch_receipts_update_totals() {
    let ctx = &mut tx_context::dummy();
    let owner = @0xA;
    let merchant = @0xC;
    let signer = @0xD;
    let mut ledger = settlement::new_ledger_for_testing(owner, ctx);

    settlement::settle_batch<SUI>(
        &mut ledger,
        vector[b"receipt-1", b"receipt-2"],
        vector[@0xB, @0xE],
        merchant,
        signer,
        vector[100, 250],
        vector[1, 2],
        vector[b"scope-1", b"scope-2"],
        ctx,
    );

    assert_eq!(settlement::receipt_count(&ledger), 2);
    assert_eq!(settlement::total_amount(&ledger), 350);
    assert!(settlement::is_settled(&ledger, b"receipt-1"));
    assert!(settlement::is_settled(&ledger, b"receipt-2"));

    settlement::destroy_for_testing(ledger);
}

#[test, expected_failure(abort_code = E_RECEIPT_ALREADY_SETTLED, location = settlement)]
fun duplicate_receipt_aborts() {
    let ctx = &mut tx_context::dummy();
    let mut ledger = settlement::new_ledger_for_testing(@0xA, ctx);

    settlement::settle_receipt<SUI>(
        &mut ledger,
        b"receipt-1",
        @0xB,
        @0xC,
        @0xD,
        100,
        1,
        b"scope-hash",
        ctx,
    );
    settlement::settle_receipt<SUI>(
        &mut ledger,
        b"receipt-1",
        @0xB,
        @0xC,
        @0xD,
        100,
        1,
        b"scope-hash",
        ctx,
    );
    settlement::destroy_for_testing(ledger);
}
