-- Migration: add_mercenary_module_tables
-- Created (UTC): 2026-04-03T00:00:00.000Z

-- Core mercenary contracts currently in force.
CREATE TABLE IF NOT EXISTS sentinel_mercenary_contracts (
    id TEXT PRIMARY KEY,
    client_discord_id TEXT,
    client_torn_id TEXT,
    client_name TEXT,
    title TEXT NOT NULL,
    description TEXT,
    contract_type TEXT NOT NULL, -- e.g. "hit", "mug", "defend", "mixed"
    status TEXT NOT NULL DEFAULT 'active', -- active, paused, completed, cancelled
    pay_amount INTEGER NOT NULL DEFAULT 0,
    pay_currency TEXT NOT NULL DEFAULT 'cash', -- cash, points, item, mixed
    pay_terms TEXT,
    start_at DATETIME,
    ends_at DATETIME,
    closed_at DATETIME,
    created_by TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Targets attached to a mercenary contract.
CREATE TABLE IF NOT EXISTS sentinel_mercenary_targets (
    id TEXT PRIMARY KEY,
    contract_id TEXT NOT NULL,
    target_torn_id TEXT,
    target_name TEXT NOT NULL,
    faction_id TEXT,
    target_type TEXT NOT NULL DEFAULT 'user', -- user, faction, list, tag
    status TEXT NOT NULL DEFAULT 'active', -- active, completed, removed
    is_valid INTEGER NOT NULL DEFAULT 1,
    priority INTEGER NOT NULL DEFAULT 0,
    notes TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (contract_id) REFERENCES sentinel_mercenary_contracts(id) ON DELETE CASCADE
);

-- Stores every verified hit or related combat event so payouts can be generated later.
CREATE TABLE IF NOT EXISTS sentinel_mercenary_verification_vault (
    id TEXT PRIMARY KEY,
    contract_id TEXT NOT NULL,
    target_id TEXT,
    merc_discord_id TEXT,
    merc_torn_id TEXT,
    merc_name TEXT,
    attacker_torn_id TEXT,
    attacker_name TEXT,
    defender_torn_id TEXT,
    defender_name TEXT,
    attack_id TEXT,
    attack_type TEXT, -- hit, mug, assist, revive, defense, other
    result TEXT, -- verified, rejected, pending, disputed
    payout_status TEXT NOT NULL DEFAULT 'pending', -- pending, queued, paid, void
    payout_amount INTEGER DEFAULT 0,
    occurred_at DATETIME,
    verified_at DATETIME,
    verified_by TEXT,
    evidence TEXT,
    metadata_json TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (contract_id) REFERENCES sentinel_mercenary_contracts(id) ON DELETE CASCADE,
    FOREIGN KEY (target_id) REFERENCES sentinel_mercenary_targets(id) ON DELETE SET NULL
);

-- Tracks payout runs created from the verification vault.
CREATE TABLE IF NOT EXISTS sentinel_mercenary_payout_batches (
    id TEXT PRIMARY KEY,
    contract_id TEXT NOT NULL,
    created_by TEXT,
    status TEXT NOT NULL DEFAULT 'draft', -- draft, queued, sent, completed, cancelled
    total_entries INTEGER NOT NULL DEFAULT 0,
    total_amount INTEGER NOT NULL DEFAULT 0,
    currency TEXT NOT NULL DEFAULT 'cash',
    notes TEXT,
    generated_at DATETIME,
    sent_at DATETIME,
    completed_at DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (contract_id) REFERENCES sentinel_mercenary_contracts(id) ON DELETE CASCADE
);

-- Individual payout line items, linked to the verified events that earned them.
CREATE TABLE IF NOT EXISTS sentinel_mercenary_payout_items (
    id TEXT PRIMARY KEY,
    batch_id TEXT NOT NULL,
    vault_id TEXT,
    merc_discord_id TEXT NOT NULL,
    merc_torn_id TEXT,
    merc_name TEXT,
    amount INTEGER NOT NULL DEFAULT 0,
    currency TEXT NOT NULL DEFAULT 'cash',
    status TEXT NOT NULL DEFAULT 'pending', -- pending, paid, failed, reversed
    payout_reference TEXT,
    paid_at DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (batch_id) REFERENCES sentinel_mercenary_payout_batches(id) ON DELETE CASCADE,
    FOREIGN KEY (vault_id) REFERENCES sentinel_mercenary_verification_vault(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_merc_contracts_status ON sentinel_mercenary_contracts(status);
CREATE INDEX IF NOT EXISTS idx_merc_contracts_client_discord_id ON sentinel_mercenary_contracts(client_discord_id);
CREATE INDEX IF NOT EXISTS idx_merc_contracts_ends_at ON sentinel_mercenary_contracts(ends_at);
CREATE INDEX IF NOT EXISTS idx_merc_targets_contract_id ON sentinel_mercenary_targets(contract_id);
CREATE INDEX IF NOT EXISTS idx_merc_targets_target_torn_id ON sentinel_mercenary_targets(target_torn_id);
CREATE INDEX IF NOT EXISTS idx_merc_targets_status ON sentinel_mercenary_targets(status);
CREATE INDEX IF NOT EXISTS idx_merc_vault_contract_id ON sentinel_mercenary_verification_vault(contract_id);
CREATE INDEX IF NOT EXISTS idx_merc_vault_target_id ON sentinel_mercenary_verification_vault(target_id);
CREATE INDEX IF NOT EXISTS idx_merc_vault_merc_discord_id ON sentinel_mercenary_verification_vault(merc_discord_id);
CREATE INDEX IF NOT EXISTS idx_merc_vault_result ON sentinel_mercenary_verification_vault(result);
CREATE INDEX IF NOT EXISTS idx_merc_vault_payout_status ON sentinel_mercenary_verification_vault(payout_status);
CREATE INDEX IF NOT EXISTS idx_merc_payout_batches_contract_id ON sentinel_mercenary_payout_batches(contract_id);
CREATE INDEX IF NOT EXISTS idx_merc_payout_batches_status ON sentinel_mercenary_payout_batches(status);
CREATE INDEX IF NOT EXISTS idx_merc_payout_items_batch_id ON sentinel_mercenary_payout_items(batch_id);
CREATE INDEX IF NOT EXISTS idx_merc_payout_items_vault_id ON sentinel_mercenary_payout_items(vault_id);
CREATE INDEX IF NOT EXISTS idx_merc_payout_items_merc_discord_id ON sentinel_mercenary_payout_items(merc_discord_id);
CREATE INDEX IF NOT EXISTS idx_merc_payout_items_status ON sentinel_mercenary_payout_items(status);

CREATE UNIQUE INDEX IF NOT EXISTS ux_merc_vault_attack_id
    ON sentinel_mercenary_verification_vault(attack_id)
    WHERE attack_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS ux_merc_payout_items_vault_id
    ON sentinel_mercenary_payout_items(vault_id)
    WHERE vault_id IS NOT NULL;
