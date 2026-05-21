export const COIN_NAMES = [
  'YANHONU', 'AWABI', 'KRRUA', 'Gunosy', 'F.C.O.H.',
  '364364', '889464', 'Sensenshal', 'KO↑KO↓', 'NANAJI'
];

export class Market {
  constructor() {
    this.coins = new Map();
    this.unlaunchedNames = [...COIN_NAMES];
  }

  launchNextCoin(time) {
    if (this.unlaunchedNames.length === 0) return null;
    const name = this.unlaunchedNames.shift();
    const initialPrice = Math.max(0.000000001, Math.random() * 0.001);
    const coin = {
      id: name,
      price: initialPrice,
      history: [{ time, price: initialPrice, vol: 0 }],
      txns: [],
      volume24h: 0,
      change24h: 0,
      launchedAt: time
    };
    this.coins.set(name, coin);
    return coin;
  }

  addTrade(coinId, newPrice, txn) {
    const coin = this.coins.get(coinId);
    if (!coin) return;

    const oldPrice = coin.price;
    coin.price = newPrice;
    coin.volume24h += txn.sizeSol;
    coin.history.push({ time: txn.scheduledAt, price: newPrice, vol: txn.sizeSol });

    // Mock SOL price $150
    const solPrice = 150;
    const usdValue = txn.sizeSol * solPrice;
    const tokenAmount = txn.sizeSol / newPrice;

    const tradeRecord = {
      time: txn.scheduledAt,
      type: txn.action,
      usd: usdValue,
      tokenAmount: tokenAmount,
      sol: txn.sizeSol,
      price: newPrice,
      wallet: txn.wallet
    };

    coin.txns.unshift(tradeRecord);
    if (coin.txns.length > 100) coin.txns.pop(); // Keep only latest 100

    const firstPrice = coin.history[0]?.price || oldPrice;
    coin.change24h = ((newPrice - firstPrice) / firstPrice) * 100;
  }

  getCoin(coinId) {
    return this.coins.get(coinId);
  }

  getAllCoins() {
    return Array.from(this.coins.values());
  }
}
