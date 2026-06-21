module sui402_sessions::sessions;

use std::vector;
use sui::balance::{Self, Balance};
use sui::clock::{Self, Clock};
use sui::coin::{Self, Coin};
use sui::event;
use sui::object::{Self, ID, UID};
use sui::transfer;
use sui::tx_context::{Self, TxContext};

const E_EXPIRED: u64 = 1;
const E_REVOKED: u64 = 2;
const E_AMOUNT_TOO_HIGH: u64 = 3;
const E_SCOPE_MISMATCH: u64 = 4;
const E_EMPTY_CHALLENGE: u64 = 5;
const E_NOT_PAYER: u64 = 6;

public struct AgentPaymentSession<phantom T> has key, store {
    id: UID,
    payer: address,
    merchant: address,
    balance: Balance<T>,
    spent: u64,
    max_per_request: u64,
    expires_ms: u64,
    resource_scope_hash: vector<u8>,
    revoked: bool,
}

public struct SessionSpent<phantom T> has copy, drop {
    session_id: ID,
    payer: address,
    merchant: address,
    amount: u64,
    spent_total: u64,
    challenge_id: vector<u8>,
    resource_scope_hash: vector<u8>,
}

#[allow(lint(self_transfer))]
public fun open_session<T>(
    merchant: address,
    max_per_request: u64,
    expires_ms: u64,
    resource_scope_hash: vector<u8>,
    funding: Coin<T>,
    ctx: &mut TxContext,
) {
    let payer = tx_context::sender(ctx);
    let session = AgentPaymentSession<T> {
        id: object::new(ctx),
        payer,
        merchant,
        balance: coin::into_balance(funding),
        spent: 0,
        max_per_request,
        expires_ms,
        resource_scope_hash,
        revoked: false,
    };

    transfer::transfer(session, payer);
}

public fun fund_session<T>(session: &mut AgentPaymentSession<T>, funding: Coin<T>) {
    balance::join(&mut session.balance, coin::into_balance(funding));
}

public fun spend<T>(
    session: &mut AgentPaymentSession<T>,
    amount: u64,
    challenge_id: vector<u8>,
    resource_scope_hash: vector<u8>,
    clock: &Clock,
    ctx: &mut TxContext,
) {
    let sender = tx_context::sender(ctx);
    assert!(sender == session.payer, E_NOT_PAYER);
    assert!(!session.revoked, E_REVOKED);
    assert!(clock::timestamp_ms(clock) < session.expires_ms, E_EXPIRED);
    assert!(amount <= session.max_per_request, E_AMOUNT_TOO_HIGH);
    assert!(resource_scope_hash == session.resource_scope_hash, E_SCOPE_MISMATCH);
    assert!(vector::length(&challenge_id) > 0, E_EMPTY_CHALLENGE);

    let payment_balance = balance::split(&mut session.balance, amount);
    let payment_coin = coin::from_balance(payment_balance, ctx);
    transfer::public_transfer(payment_coin, session.merchant);

    session.spent = session.spent + amount;

    event::emit(SessionSpent<T> {
        session_id: object::id(session),
        payer: session.payer,
        merchant: session.merchant,
        amount,
        spent_total: session.spent,
        challenge_id,
        resource_scope_hash,
    });
}

public fun revoke_session<T>(session: &mut AgentPaymentSession<T>, ctx: &TxContext) {
    let sender = tx_context::sender(ctx);
    assert!(sender == session.payer, E_NOT_PAYER);
    session.revoked = true;
}

public fun close_session<T>(session: AgentPaymentSession<T>, ctx: &mut TxContext) {
    let sender = tx_context::sender(ctx);
    let AgentPaymentSession {
        id,
        payer,
        merchant: _,
        balance,
        spent: _,
        max_per_request: _,
        expires_ms: _,
        resource_scope_hash: _,
        revoked: _,
    } = session;

    assert!(sender == payer, E_NOT_PAYER);

    if (balance::value(&balance) == 0) {
        balance::destroy_zero(balance);
    } else {
        transfer::public_transfer(coin::from_balance(balance, ctx), payer);
    };

    object::delete(id);
}

public fun payer<T>(session: &AgentPaymentSession<T>): address {
    session.payer
}

public fun merchant<T>(session: &AgentPaymentSession<T>): address {
    session.merchant
}

public fun available<T>(session: &AgentPaymentSession<T>): u64 {
    balance::value(&session.balance)
}

public fun spent<T>(session: &AgentPaymentSession<T>): u64 {
    session.spent
}

public fun max_per_request<T>(session: &AgentPaymentSession<T>): u64 {
    session.max_per_request
}

public fun expires_ms<T>(session: &AgentPaymentSession<T>): u64 {
    session.expires_ms
}

public fun resource_scope_hash<T>(session: &AgentPaymentSession<T>): &vector<u8> {
    &session.resource_scope_hash
}

public fun revoked<T>(session: &AgentPaymentSession<T>): bool {
    session.revoked
}
