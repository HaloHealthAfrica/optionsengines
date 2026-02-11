/**
 * Position Generator for Validation Framework
 * 
 * Generates synthetic option position data with realistic Greeks and P&L
 * for validation testing.
 */

import crypto from 'crypto';
import {
  Position,
  PositionParams,
  Greeks,
  Direction,
} from '../types/index.js';

/**
 * Position Generator
 * 
 * Creates realistic option position data for validation testing.
 */
export class PositionGenerator {
  /**
   * Generate a position
   * 
   * @param params - Position generation parameters
   * @returns Generated position
   */
  generatePosition(params: PositionParams): Position {
    const positionId = this.generatePositionId();
    const strike = this.calculateStrike(params);
    const expiration = this.calculateExpiration(params.daysToExpiration);
    const entryPrice = this.randomPrice(1, 10);
    const currentPrice = this.calculateCurrentPrice(entryPrice);
    const quantity = this.randomQuantity();
    const greeks = this.generateGreeks(params);
    const pnl = this.calculatePnL(entryPrice, currentPrice, quantity, params.direction);

    return {
      positionId,
      symbol: params.symbol,
      strike,
      expiration,
      direction: params.direction,
      entryPrice,
      currentPrice,
      quantity,
      greeks,
      pnl,
    };
  }

  /**
   * Generate a batch of positions
   * 
   * @param paramsList - Array of position parameters
   * @returns Array of generated positions
   */
  generateBatch(paramsList: PositionParams[]): Position[] {
    return paramsList.map(params => this.generatePosition(params));
  }

  /**
   * Generate a winning position
   * 
   * @param params - Position generation parameters
   * @returns Position with positive P&L
   */
  generateWinningPosition(params: PositionParams): Position {
    const position = this.generatePosition(params);
    
    // Adjust current price to ensure profit
    if (params.direction === 'LONG') {
      position.currentPrice = position.entryPrice * (1 + Math.random() * 0.5 + 0.1); // 10-60% gain
    } else {
      position.currentPrice = position.entryPrice * (1 - Math.random() * 0.5 - 0.1); // 10-60% gain
    }
    
    position.pnl = this.calculatePnL(
      position.entryPrice,
      position.currentPrice,
      position.quantity,
      params.direction
    );
    
    return position;
  }

  /**
   * Generate a losing position
   * 
   * @param params - Position generation parameters
   * @returns Position with negative P&L
   */
  generateLosingPosition(params: PositionParams): Position {
    const position = this.generatePosition(params);
    
    // Adjust current price to ensure loss
    if (params.direction === 'LONG') {
      position.currentPrice = position.entryPrice * (1 - Math.random() * 0.5 - 0.1); // 10-60% loss
    } else {
      position.currentPrice = position.entryPrice * (1 + Math.random() * 0.5 + 0.1); // 10-60% loss
    }
    
    position.pnl = this.calculatePnL(
      position.entryPrice,
      position.currentPrice,
      position.quantity,
      params.direction
    );
    
    return position;
  }

  /**
   * Generate Greeks for a position
   * 
   * @param params - Position parameters
   * @returns Generated Greeks
   */
  private generateGreeks(params: PositionParams): Greeks {
    // Greeks vary based on DTE and direction
    const dteRatio = params.daysToExpiration / 365;
    
    return {
      delta: this.generateDelta(params.direction, dteRatio),
      gamma: this.generateGamma(dteRatio),
      theta: this.generateTheta(dteRatio),
      vega: this.generateVega(dteRatio),
      rho: this.generateRho(params.direction, dteRatio),
    };
  }

  /**
   * Generate delta value
   */
  private generateDelta(direction: Direction, dteRatio: number): number {
    // Delta ranges from -1 to 1
    // Longer DTE = lower absolute delta
    const baseDelta = 0.3 + Math.random() * 0.4; // 0.3 to 0.7
    const adjustedDelta = baseDelta * (1 - dteRatio * 0.3);
    return direction === 'LONG' ? adjustedDelta : -adjustedDelta;
  }

  /**
   * Generate gamma value
   */
  private generateGamma(dteRatio: number): number {
    // Gamma is highest near expiration
    const baseGamma = 0.01 + Math.random() * 0.05;
    return baseGamma * (1 + (1 - dteRatio) * 2);
  }

  /**
   * Generate theta value
   */
  private generateTheta(dteRatio: number): number {
    // Theta (time decay) is negative and accelerates near expiration
    const baseTheta = -(0.01 + Math.random() * 0.05);
    return baseTheta * (1 + (1 - dteRatio) * 3);
  }

  /**
   * Generate vega value
   */
  private generateVega(dteRatio: number): number {
    // Vega is higher for longer-dated options
    const baseVega = 0.05 + Math.random() * 0.15;
    return baseVega * (1 + dteRatio);
  }

  /**
   * Generate rho value
   */
  private generateRho(direction: Direction, dteRatio: number): number {
    // Rho is higher for longer-dated options
    const baseRho = 0.01 + Math.random() * 0.03;
    const adjustedRho = baseRho * (1 + dteRatio);
    return direction === 'LONG' ? adjustedRho : -adjustedRho;
  }

  /**
   * Calculate strike price based on symbol
   */
  private calculateStrike(_params: PositionParams): number {
    // Simplified strike calculation
    const basePrice = 400; // Assume SPY-like pricing
    const offset = (Math.random() - 0.5) * 100;
    return Math.round(basePrice + offset);
  }

  /**
   * Calculate expiration date
   */
  private calculateExpiration(daysToExpiration: number): Date {
    const expiration = new Date();
    expiration.setDate(expiration.getDate() + daysToExpiration);
    return expiration;
  }

  /**
   * Calculate current price with some variation from entry
   */
  private calculateCurrentPrice(entryPrice: number): number {
    const variation = (Math.random() - 0.5) * 0.4; // -20% to +20%
    return entryPrice * (1 + variation);
  }

  /**
   * Calculate P&L
   */
  private calculatePnL(
    entryPrice: number,
    currentPrice: number,
    quantity: number,
    direction: Direction
  ): number {
    const priceDiff = currentPrice - entryPrice;
    const multiplier = direction === 'LONG' ? 1 : -1;
    return priceDiff * quantity * multiplier * 100; // Options multiplier
  }

  /**
   * Generate random price
   */
  private randomPrice(min: number, max: number): number {
    return Math.random() * (max - min) + min;
  }

  /**
   * Generate random quantity
   */
  private randomQuantity(): number {
    return Math.floor(Math.random() * 10) + 1; // 1-10 contracts
  }

  /**
   * Generate unique position ID
   */
  private generatePositionId(): string {
    return `pos_${crypto.randomUUID()}`;
  }
}

/**
 * Default position generator instance
 */
export const positionGenerator = new PositionGenerator();
