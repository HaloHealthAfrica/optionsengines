export interface SlippageEstimate {
  estimatedSlippagePct: number;
  adjustedQuantity: number;
  originalQuantity: number;
  liquidityScore: number;
}

export function estimateSlippage(params: {
  bidAskSpreadPct: number;
  volume: number;
  openInterest: number;
  quantity: number;
  entryPrice: number;
}): SlippageEstimate {
  const { bidAskSpreadPct, volume, openInterest, quantity } = params;

  const halfSpread = bidAskSpreadPct / 2;

  let impactPct = 0;
  if (volume > 0) {
    const participationRate = quantity / volume;
    impactPct = participationRate * 0.5 * bidAskSpreadPct;
  }

  const oiRatio = openInterest > 0 ? quantity / openInterest : 1;
  const oiPenalty = oiRatio > 0.05 ? oiRatio * 2 : 0;

  const estimatedSlippagePct = Math.min(20, halfSpread + impactPct + oiPenalty);

  const liquidityScore = computeLiquidityScore(bidAskSpreadPct, volume, openInterest);

  let adjustedQuantity = quantity;
  if (estimatedSlippagePct > 3) {
    const reduction = Math.min(0.5, (estimatedSlippagePct - 3) / 10);
    adjustedQuantity = Math.max(1, Math.floor(quantity * (1 - reduction)));
  }

  return {
    estimatedSlippagePct: Math.round(estimatedSlippagePct * 100) / 100,
    adjustedQuantity,
    originalQuantity: quantity,
    liquidityScore,
  };
}

function computeLiquidityScore(spreadPct: number, volume: number, oi: number): number {
  let score = 50;

  if (spreadPct < 2) score += 20;
  else if (spreadPct < 5) score += 10;
  else if (spreadPct > 10) score -= 20;
  else if (spreadPct > 5) score -= 10;

  if (volume > 500) score += 15;
  else if (volume > 100) score += 10;
  else if (volume < 10) score -= 15;

  if (oi > 1000) score += 15;
  else if (oi > 200) score += 10;
  else if (oi < 50) score -= 15;

  return Math.max(0, Math.min(100, score));
}

export function shouldReduceSize(slippage: SlippageEstimate): boolean {
  return slippage.adjustedQuantity < slippage.originalQuantity;
}

export function shouldBlockTrade(slippage: SlippageEstimate): boolean {
  return slippage.estimatedSlippagePct > 10 || slippage.liquidityScore < 15;
}
