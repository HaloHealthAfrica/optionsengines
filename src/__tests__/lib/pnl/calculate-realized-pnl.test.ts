/**
 * Unit tests: Deterministic, direction-aware P&L calculation
 * Covers: long/short profit/loss, multi-contract, multiplier, invalid input
 */

import {
  calculateRealizedPnL,
  calculateUnrealizedPnL,
  costBasis,
} from '../../../lib/pnl/calculate-realized-pnl.js';

describe('calculateRealizedPnL', () => {
  const multiplier = 100;

  describe('LONG positions', () => {
    it('long call profit: exit > entry', () => {
      const pnl = calculateRealizedPnL({
        entry_price: 2,
        exit_price: 3,
        quantity: 1,
        multiplier,
        position_side: 'LONG',
      });
      expect(pnl).toBe(100); // (3-2)*1*100
    });

    it('long call loss: exit < entry', () => {
      const pnl = calculateRealizedPnL({
        entry_price: 3,
        exit_price: 2,
        quantity: 1,
        multiplier,
        position_side: 'LONG',
      });
      expect(pnl).toBe(-100);
    });

    it('long put profit: exit > entry', () => {
      const pnl = calculateRealizedPnL({
        entry_price: 1.5,
        exit_price: 2.5,
        quantity: 1,
        multiplier,
        position_side: 'LONG',
      });
      expect(pnl).toBe(100);
    });

    it('long put loss: exit < entry', () => {
      const pnl = calculateRealizedPnL({
        entry_price: 2.5,
        exit_price: 1.5,
        quantity: 1,
        multiplier,
        position_side: 'LONG',
      });
      expect(pnl).toBe(-100);
    });
  });

  describe('SHORT positions', () => {
    it('short put profit: sold high, bought back low', () => {
      const pnl = calculateRealizedPnL({
        entry_price: 2.15,
        exit_price: 1.7,
        quantity: 1,
        multiplier,
        position_side: 'SHORT',
      });
      expect(pnl).toBe(45); // (2.15-1.7)*1*100
    });

    it('short put loss: sold low, bought back high', () => {
      const pnl = calculateRealizedPnL({
        entry_price: 1.7,
        exit_price: 2.15,
        quantity: 1,
        multiplier,
        position_side: 'SHORT',
      });
      expect(pnl).toBe(-45);
    });

    it('short call profit: sold high, bought back low', () => {
      const pnl = calculateRealizedPnL({
        entry_price: 3,
        exit_price: 2,
        quantity: 1,
        multiplier,
        position_side: 'SHORT',
      });
      expect(pnl).toBe(100);
    });

    it('short call loss: sold low, bought back high', () => {
      const pnl = calculateRealizedPnL({
        entry_price: 2,
        exit_price: 3,
        quantity: 1,
        multiplier,
        position_side: 'SHORT',
      });
      expect(pnl).toBe(-100);
    });
  });

  describe('multi-contract scaling', () => {
    it('scales by quantity', () => {
      const pnl = calculateRealizedPnL({
        entry_price: 2,
        exit_price: 2.5,
        quantity: 5,
        multiplier,
        position_side: 'LONG',
      });
      expect(pnl).toBe(250); // 0.5*5*100
    });
  });

  describe('default multiplier', () => {
    it('defaults to 100 when omitted', () => {
      const pnl = calculateRealizedPnL({
        entry_price: 2,
        exit_price: 3,
        quantity: 1,
        position_side: 'LONG',
      });
      expect(pnl).toBe(100);
    });
  });

  describe('invalid input', () => {
    it('throws on invalid position_side', () => {
      expect(() =>
        calculateRealizedPnL({
          entry_price: 2,
          exit_price: 3,
          quantity: 1,
          position_side: 'INVALID',
        })
      ).toThrow('Invalid position_side');
    });
  });
});

describe('calculateUnrealizedPnL', () => {
  const multiplier = 100;

  it('long profit when current > entry', () => {
    const pnl = calculateUnrealizedPnL({
      entry_price: 2,
      current_price: 2.5,
      quantity: 1,
      multiplier,
      position_side: 'LONG',
    });
    expect(pnl).toBe(50);
  });

  it('short profit when current < entry', () => {
    const pnl = calculateUnrealizedPnL({
      entry_price: 2.15,
      current_price: 1.7,
      quantity: 1,
      multiplier,
      position_side: 'SHORT',
    });
    expect(pnl).toBe(45);
  });
});

describe('costBasis', () => {
  it('computes cost basis', () => {
    expect(costBasis(2, 5, 100)).toBe(1000);
  });
});
