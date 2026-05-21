export class MockAgent {
  constructor(market, eventQueue) {
    this.market = market;
    this.eventQueue = eventQueue;
    this.lastSeedTime = 0;
  }

  seedInitialEvents(masterTime) {
    this.lastSeedTime = masterTime;
    this.generateBatch(masterTime);
  }

  update(masterTime) {
    // マスタータイムが未来のバッチ限界に近づいたら補充
    // 5分前 (300秒) を閾値とする
    if (masterTime > this.lastSeedTime - 300) {
      this.generateBatch(this.lastSeedTime);
    }
  }

  generateBatch(startTime) {
    // 1時間分(3600秒)のトランザクションを生成
    const duration = 3600;
    const coins = this.market.getAllCoins();
    
    // 1時間あたり1銘柄につき平均300件のTxn (合計3000件)
    const totalTxns = 3000;
    
    for (let i = 0; i < totalTxns; i++) {
      const delay = Math.random() * duration;
      const scheduleAt = startTime + delay;
      
      const coin = coins[Math.floor(Math.random() * coins.length)];
      const isBuy = Math.random() > 0.5;
      
      // impact: -1% ~ +1% per txn
      const impact = (Math.random() * 0.02) - (isBuy ? 0 : 0.01); 
      const volume = Math.random() * 10; // 0~10 SOL

      this.eventQueue.schedule(scheduleAt, () => {
        const newPrice = Math.max(0.000000001, coin.price * (1 + impact));
        this.market.updatePrice(coin.id, newPrice, volume, scheduleAt);
      });
    }
    
    this.lastSeedTime = startTime + duration;
  }
}
