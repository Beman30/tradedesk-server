// =====================================================
// SIGMA XIII — ENGINE #2
// SPREAD OPENING ENGINE v1.0
// =====================================================

function mulberry32(seed) {
  return function () {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randomNormal(rand) {
  let u = 0, v = 0;
  while (u === 0) u = rand();
  while (v === 0) v = rand();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

function median(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

function monteCarloTouchWithMedianTime({
  currentPrice,
  targetPrice,
  iv,
  daysToExpiration,
  riskFree = 0.043,
  dividend = 0,
  simulations = 100000,
  stepsPerDay = 96,
  seed = 123456
}) {
  const rand = mulberry32(seed);
  const totalSteps = Math.max(1, Math.floor(daysToExpiration * stepsPerDay));
  const dt = 1 / 365 / stepsPerDay;

  const drift = (riskFree - dividend - 0.5 * iv * iv) * dt;
  const diffusion = iv * Math.sqrt(dt);
  const targetAbove = targetPrice > currentPrice;

  let touched = 0;
  const firstTouchDays = [];

  for (let i = 0; i < simulations; i++) {
    let price = currentPrice;

    for (let step = 1; step <= totalSteps; step++) {
      price *= Math.exp(drift + diffusion * randomNormal(rand));

      const hit = targetAbove ? price >= targetPrice : price <= targetPrice;

      if (hit) {
        touched++;
        firstTouchDays.push(step / stepsPerDay);
        break;
      }
    }
  }

  return {
    touchProbability: touched / simulations,
    noTouchProbability: 1 - touched / simulations,
    medianFirstTouchDays: median(firstTouchDays)
  };
}

function analyzeCreditSpread({
  ticker,
  direction,
  currentPrice,
  shortStrike,
  longStrike,
  shortPrice,
  longPrice,
  iv,
  daysToExpiration,
  contracts = 1,
  multiplier = 100,
  riskFree = 0.043,
  dividend = 0,
  simulations = 100000,
  stepsPerDay = 96,
  seed = 123456
}) {
  const credit = shortPrice - longPrice;
  const width = Math.abs(longStrike - shortStrike);

  const maxProfit = credit * multiplier * contracts;
  const maxLoss = (width - credit) * multiplier * contracts;

  let breakEven;
  if (direction === "BEAR_CALL") {
    breakEven = shortStrike + credit;
  } else if (direction === "BULL_PUT") {
    breakEven = shortStrike - credit;
  } else {
    throw new Error("direction deve essere BEAR_CALL oppure BULL_PUT");
  }

  const distance = breakEven - currentPrice;
  const distancePct = distance / currentPrice;

  const mc = monteCarloTouchWithMedianTime({
    currentPrice,
    targetPrice: breakEven,
    iv,
    daysToExpiration,
    riskFree,
    dividend,
    simulations,
    stepsPerDay,
    seed
  });

  return {
    ticker,
    direction,
    spread: `${shortStrike}/${longStrike}`,
    contracts,
    currentPrice: Number(currentPrice.toFixed(2)),
    shortStrike,
    longStrike,
    shortPrice,
    longPrice,
    credit: Number(credit.toFixed(2)),
    maxProfit: Number(maxProfit.toFixed(2)),
    maxLoss: Number(maxLoss.toFixed(2)),
    breakEven: Number(breakEven.toFixed(2)),
    distance: Number(distance.toFixed(2)),
    distancePct: (distancePct * 100).toFixed(2) + "%",
    touchProbability: (mc.touchProbability * 100).toFixed(1) + "%",
    noTouchProbability: (mc.noTouchProbability * 100).toFixed(1) + "%",
    medianFirstTouchDays:
      mc.medianFirstTouchDays === null
        ? "Mai"
        : mc.medianFirstTouchDays.toFixed(1) + " giorni",
    simulations,
    stepsPerDay
  };
}

function rankCreditSpreads(spreads) {
  return spreads
    .map(analyzeCreditSpread)
    .sort((a, b) => {
      const pa = parseFloat(a.touchProbability);
      const pb = parseFloat(b.touchProbability);
      if (pa !== pb) return pa - pb;
      return a.maxLoss - b.maxLoss;
    });
}

module.exports = { analyzeCreditSpread, rankCreditSpreads };
