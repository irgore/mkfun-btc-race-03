/**
 * btc-race-24h: 95% entry on first bar, 6% trailing stop, 15% take-profit.
 * Enters full position on first tradeable bar.
 * Exits on 6% trailing stop from peak or 15% take-profit.
 * Long only, single asset (CBBTC/USDC), 1 position max.
 */
import { runBars, type BarsState, type OrderInput } from './vendor/makefun-bars.ts';

const TRAIL_STOP_PCT = 0.06;  // 6% trailing stop from peak
const TAKE_PROFIT_PCT = 0.15; // 15% take-profit
const ENTRY_ALLOC = 0.95;     // 95% of equity
const MAX_SLIP = 50;

let entered = false, exited = false;
let peak = 0;
let entryPrice = 0;
let scale = 0;

await runBars({
  onHello() { /* seed unused — deterministic entry */ },

  onBatch(state: BarsState): OrderInput[] {
    if (exited || state.warmingUp) return [];

    const raw = state.close('CBBTC');
    if (raw === null) return [];

    if (scale === 0) {
      const s = state.hello.symbols.find(x => x.symbol === 'CBBTC');
      scale = s?.price_scale ?? 0;
    }

    const price = Number(raw) / (10 ** scale);
    const orders: OrderInput[] = [];

    if (!entered) {
      // Enter on first bar with full allocation
      const spend = (state.cash * BigInt(Math.floor(ENTRY_ALLOC * 100)) / 100n);
      if (spend >= BigInt(state.hello.fees.min_notional_quote_units)) {
        orders.push({
          side: 'buy', symbol: 'CBBTC',
          notional_quote_units: spend, max_slippage_bps: MAX_SLIP,
        });
        entered = true;
        peak = price;
        entryPrice = price;
      }
      return orders;
    }

    // In position — update peak and check exit conditions
    if (price > peak) peak = price;

    const inPos = state.positions.has('CBBTC');
    if (!inPos) return []; // position not filled yet
    const curQty = state.positions.get('CBBTC')?.qty ?? 0n;
    if (curQty <= 0n) return []; // zero qty edge case

    const trailStop = peak * (1 - TRAIL_STOP_PCT);
    const takeProfit = entryPrice * (1 + TAKE_PROFIT_PCT);
    const shouldExit = price <= trailStop || price >= takeProfit;

    if (shouldExit) {
      const pos = state.positions.get('CBBTC');
      if (pos && pos.qty > 0n) {
        orders.push({
          side: 'sell', symbol: 'CBBTC',
          qty: pos.qty, max_slippage_bps: MAX_SLIP,
        });
        exited = true;
      }
    }

    return orders;
  },
});