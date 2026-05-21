import { EventQueue } from './EventQueue.js';
import { Market } from './Market.js';
import { AIEngine } from './AIEngine.js';

export class GameEngine {
  constructor(uiManager) {
    this.uiManager = uiManager;
    this.market = new Market();
    this.eventQueue = new EventQueue();
    
    // マスタータイム（2026-01-01 00:00:00 UTC を起点）
    this.masterTime = Date.UTC(2026, 0, 1) / 1000; 
    
    // タイムスケール（1秒の実時間でマスタータイムが何秒進むか）
    this.timeScale = 1; // 1倍速 (リアルタイム)
    
    this.lastRealTime = performance.now();
    this.isRunning = false;

    this.aiEngine = new AIEngine(this.market, this.eventQueue);
    this.lastAiSeedTime = 0;
    this.isGenerating = false;

    // Player State
    this.player = {
      wallet: 'YOU_' + Math.random().toString(36).substring(2, 6).toUpperCase(),
      sol: 10,
      tokens: {}
    };
  }

  executePlayerTrade(coinId, action, amountSol) {
    const coin = this.market.getCoin(coinId);
    if (!coin) return false;

    if (action === 'BUY') {
      if (this.player.sol < amountSol) return false;
      this.player.sol -= amountSol;
      
      const impact = Math.log1p(amountSol) * 0.9 / 100;
      const newPrice = Math.max(0.000000001, coin.price * (1 + impact));
      
      const tokenAmount = amountSol / newPrice;
      this.player.tokens[coinId] = (this.player.tokens[coinId] || 0) + tokenAmount;
      
      this.market.addTrade(coinId, newPrice, {
        action: 'BUY',
        sizeSol: amountSol,
        wallet: this.player.wallet,
        scheduledAt: this.masterTime,
        coinId: coinId
      });
      return true;
    } else if (action === 'SELL') {
      const currentTokens = this.player.tokens[coinId] || 0;
      const expectedTokenAmount = amountSol / coin.price;
      
      if (currentTokens < expectedTokenAmount && currentTokens > 0) {
        // Sell all if trying to sell more than owned but has some
        amountSol = currentTokens * coin.price;
        this.player.tokens[coinId] = 0;
      } else if (currentTokens >= expectedTokenAmount) {
        this.player.tokens[coinId] -= expectedTokenAmount;
      } else {
        return false;
      }
      this.player.sol += amountSol;

      const impact = Math.log1p(amountSol) * -0.82 / 100;
      const newPrice = Math.max(0.000000001, coin.price * (1 + impact));
      
      this.market.addTrade(coinId, newPrice, {
        action: 'SELL',
        sizeSol: amountSol,
        wallet: this.player.wallet,
        scheduledAt: this.masterTime,
        coinId: coinId
      });
      return true;
    }
    return false;
  }

  setTimeScale(scale) {
    const nextScale = Math.max(1, Number(scale) || 1);
    this.timeScale = nextScale;
    this.lastRealTime = performance.now();
  }

  async start() {
    this.uiManager.init(this.market);
    this.uiManager.initEvents(this);
    
    // AI初期化
    this.uiManager.setLoadingStatus('Loading AI Model...');
    await this.aiEngine.init();

    const launchedCoins = [];
    let deterministicAssigned = false;

    // 10コインすべてをローンチ
    for (let i = 0; i < 10; i++) {
      const isPast = i < 5;
      const launchTime = isPast ? this.masterTime - 3600 : this.masterTime;
      const coin = this.market.launchNextCoin(launchTime);
      launchedCoins.push(coin);
      
      this.aiEngine.initCoinAI(coin.id, !deterministicAssigned);
      deterministicAssigned = true;
    }

    let completedTasks = 0;
    const totalTasks = 15; // 過去5 + 未来10

    const updateGlobalProgress = (taskFraction) => {
      const overall = ((completedTasks + taskFraction) / totalTasks) * 100;
      this.uiManager.updateProgress(overall);
    };

    // 過去1時間分のデータを生成して即時反映 (最初の5コイン)
    // 過去1時間分のデータを生成して即時反映 (最初の5コイン)
    for (let i = 0; i < 5; i++) {
      const coinId = launchedCoins[i].id;
      this.uiManager.setLoadingStatus(`Simulating Past History... (${i + 1}/5)`);
      await this.aiEngine.generateTxnsForCoin(coinId, this.masterTime - 3600, 3600, (p, accTime, iterations, nextGenTokens, avgMs) => {
        updateGlobalProgress(p);
        let t = Math.floor(accTime !== undefined ? accTime : 3600);
        this.uiManager.setLoadingSubStatus(`[${coinId}] 📈 pumping... | Tokens: ${iterations}/${nextGenTokens} (${avgMs}ms/token) | Time: ${t}/3600s`);
      }, true);
      completedTasks++;
    }

    // 未来1時間分のストック生成 (全10コイン)
    for (let i = 0; i < 10; i++) {
      const coinId = launchedCoins[i].id;
      this.uiManager.setLoadingStatus(`Generating Future Queue... (${i + 1}/10)`);
      await this.aiEngine.generateTxnsForCoin(coinId, this.masterTime, 3600, (p, accTime, iterations, nextGenTokens, avgMs) => {
        updateGlobalProgress(p);
        let t = Math.floor(accTime !== undefined ? accTime : 3600);
        this.uiManager.setLoadingSubStatus(`[${coinId}] 📈 pumping... | Tokens: ${iterations}/${nextGenTokens} (${avgMs}ms/token) | Time: ${t}/3600s`);
      }, false);
      completedTasks++;
    }
    
    this.lastAiSeedTime = this.masterTime + 3600;

    // ロード画面を隠す
    this.uiManager.hideLoading();

    this.isRunning = true;
    this.lastRealTime = performance.now();
    this.loop();
  }

  async loop() {
    if (!this.isRunning) return;

    const now = performance.now();
    const dt = (now - this.lastRealTime) / 1000;
    this.lastRealTime = now;

    // マスタータイムを進行
    this.masterTime += dt * this.timeScale;

    // キューのイベントを発火
    this.eventQueue.process(this.masterTime);

    // AIの投機的実行補充（未来ストックが残り5分を切ったら補充）
    if (!this.isGenerating && this.masterTime > this.lastAiSeedTime - 300) {
      this.isGenerating = true;
      // 全10銘柄の未来Txnを生成する
      this.aiEngine.generateFutureTxnsForAll(this.lastAiSeedTime, 3600).then(nextSeedTime => {
        this.lastAiSeedTime = nextSeedTime;
        this.isGenerating = false;
      });
    }

    // UIを更新
    this.uiManager.update(this.masterTime, this.market);

    requestAnimationFrame(() => this.loop());
  }
}
