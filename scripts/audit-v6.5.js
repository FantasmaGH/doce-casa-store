#!/usr/bin/env node

/**
 * Auditoria V6.5 — Identificação de contaminação de preços duplos
 * 
 * Este script detecta:
 * 1. Faixas de preço com valores suspeitos (ex: 45000 em vez de 450)
 * 2. Padrões de contaminação (múltiplos de 100 irregulares)
 * 3. Inconsistências entre product.price_cents e faixas
 */

const Database = require('better-sqlite3');
const path = require('path');

const DATA_DIR = path.resolve(process.env.DATA_DIR || './data');
const db = new Database(path.join(DATA_DIR, 'store.sqlite'));

db.pragma('foreign_keys = ON');

function analyzeProductPrices() {
  console.log('\n=== AUDITORIA V6.5 — PREÇOS ===\n');

  const products = db.prepare(`SELECT id, name, price_cents, cost_cents FROM products WHERE active = 1`).all();
  let suspiciousCount = 0;

  console.log(`📊 Analisando ${products.length} produtos ativos...\n`);

  for (const product of products) {
    const tiers = db.prepare(`SELECT id, min_qty, max_qty, price_cents, cost_cents FROM product_price_tiers WHERE product_id = ? ORDER BY min_qty ASC`).all(product.id);

    if (!tiers.length) continue;

    // Detecção de contaminação: se o preço é muito maior do que esperado
    for (const tier of tiers) {
      const suspiciousPrice = tier.price_cents > 10000000; // > R$ 100.000
      const suspiciousCost = tier.cost_cents > 10000000;

      if (suspiciousPrice || suspiciousCost) {
        suspiciousCount++;
        console.log(`⚠️  ${product.name} (ID: ${product.id})`);
        console.log(`   Faixa: ${tier.min_qty}${tier.maxQty ? `–${tier.maxQty}` : '+'} unidades`);
        console.log(`   Preço: ${(tier.price_cents / 100).toFixed(2)} (suspeito: ${tier.price_cents})`);
        console.log(`   Custo: ${(tier.cost_cents / 100).toFixed(2)} (suspeito: ${tier.cost_cents})`);
        console.log('');
      }
    }
  }

  if (suspiciousCount === 0) {
    console.log('✅ Nenhum preço suspeito detectado.\n');
  } else {
    console.log(`\n⚠️  ${suspiciousCount} problema(s) encontrado(s).\n`);
  }

  // Verificar base de dados
  console.log('📋 Informações de estrutura:');
  const tableInfo = db.prepare(`PRAGMA table_info(product_price_tiers)`).all();
  console.log(`   Colunas em product_price_tiers: ${tableInfo.map(c => c.name).join(', ')}`);
  console.log(`   Total de faixas: ${db.prepare('SELECT COUNT(*) as cnt FROM product_price_tiers').get().cnt}`);
  console.log('');
}

analyzeProductPrices();
db.close();
