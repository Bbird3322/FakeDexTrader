import './style.css';
import { GameEngine } from './game/GameEngine.js';
import { ChartManager } from './ui/ChartManager.js';

class UIManager {
  constructor() {
    this.chartManager = new ChartManager('chart-container');
    this.selectedCoinId = null;
    this.market = null;
    
    // Elements
    this.masterTimeDisplay = document.getElementById('master-time-display');
    this.coinListContainer = document.getElementById('coin-list');
    this.selectedCoinName = document.getElementById('selected-coin-name');
    this.selectedCoinPrice = document.getElementById('selected-coin-price');
    this.selectedCoinChange = document.getElementById('selected-coin-change');
    this.speedSelect = document.getElementById('speed-select');
    
    this.loadingScreen = document.getElementById('loading-screen');
    this.progressBarFill = document.getElementById('progress-bar-fill');
    this.loadingStatus = document.getElementById('loading-status');
    this.loadingSubStatus = document.getElementById('loading-sub-status');
    
    // New UI elements
    this.txnHeaderToken = document.getElementById('txn-header-token');
    this.tokenMcap = document.getElementById('token-mcap');
    this.tokenLiquidity = document.getElementById('token-liquidity');
    this.tradeReceiveCurrency = document.getElementById('trade-receive-currency');
    
    this.txnFilter = 'ALL';
    this.tradeAction = 'BUY';
    this.gameEngine = null;
    this.playerWallet = null;
    this.lastUiUpdate = 0;
  }

  init(market) {
    this.market = market;
    this.chartManager.init();
  }

  initEvents(gameEngine) {
    this.gameEngine = gameEngine;
    this.playerWallet = gameEngine.player.wallet;

    if (this.speedSelect) {
      gameEngine.setTimeScale(this.speedSelect.value);
      this.speedSelect.addEventListener('change', () => {
        gameEngine.setTimeScale(this.speedSelect.value);
      });
    }

    // TXN Tabs
    const tabs = ['all', 'you', 'dev'];
    tabs.forEach(tab => {
      const el = document.getElementById(`txn-tab-${tab}`);
      if (el) {
        el.addEventListener('click', () => {
          tabs.forEach(t => document.getElementById(`txn-tab-${t}`).classList.remove('active'));
          el.classList.add('active');
          this.txnFilter = tab.toUpperCase();
          if (this.selectedCoinId) {
            const coin = this.market.getCoin(this.selectedCoinId);
            this.renderTxnTable(coin, this.gameEngine.masterTime);
          }
        });
      }
    });

    // Trade Panel
    const btnBuy = document.getElementById('btn-buy');
    const btnSell = document.getElementById('btn-sell');
    const payInput = document.getElementById('trade-pay-input');
    const btnTrade = document.getElementById('btn-trade');

    if (btnBuy && btnSell) {
      btnBuy.addEventListener('click', () => {
        btnBuy.classList.add('active');
        btnSell.classList.remove('active');
        this.tradeAction = 'BUY';
        this.updateTradePreview();
      });
      btnSell.addEventListener('click', () => {
        btnSell.classList.add('active');
        btnBuy.classList.remove('active');
        this.tradeAction = 'SELL';
        this.updateTradePreview();
      });
    }

    if (payInput) {
      payInput.addEventListener('input', () => this.updateTradePreview());
    }

    if (btnTrade) {
      btnTrade.addEventListener('click', () => {
        if (!this.selectedCoinId) return;
        const amount = parseFloat(payInput.value);
        if (isNaN(amount) || amount <= 0) return;
        
        const success = this.gameEngine.executePlayerTrade(this.selectedCoinId, this.tradeAction, amount);
        if (success) {
           // Provide feedback, e.g., flash button
           const originalText = btnTrade.textContent;
           btnTrade.textContent = 'Success!';
           btnTrade.style.background = '#fff';
           setTimeout(() => {
             btnTrade.textContent = originalText;
             btnTrade.style.background = '';
           }, 500);
           this.updateTradePreview();
        } else {
           const originalText = btnTrade.textContent;
           btnTrade.textContent = 'Failed';
           btnTrade.style.background = '#ff3366';
           setTimeout(() => {
             btnTrade.textContent = originalText;
             btnTrade.style.background = '';
           }, 500);
        }
      });
    }
  }

  updateTradePreview() {
    if (!this.selectedCoinId) return;
    const coin = this.market.getCoin(this.selectedCoinId);
    if (!coin) return;
    
    const payInput = document.getElementById('trade-pay-input');
    const receiveInput = document.getElementById('trade-receive-input');
    if (!payInput || !receiveInput) return;

    const amountSol = parseFloat(payInput.value);
    if (isNaN(amountSol) || amountSol <= 0) {
      receiveInput.value = '0';
      return;
    }

    if (this.tradeAction === 'BUY') {
      const tokens = amountSol / coin.price;
      receiveInput.value = formatNumber(tokens);
    } else {
      const tokens = amountSol / coin.price;
      receiveInput.value = formatNumber(tokens); // In a real app this would reflect tokens you pay to get SOL
    }
  }

  setLoadingStatus(text) {
    if (this.loadingStatus) this.loadingStatus.textContent = text;
  }

  setLoadingSubStatus(text) {
    if (this.loadingSubStatus) this.loadingSubStatus.textContent = text;
  }

  updateProgress(percent) {
    if (this.progressBarFill) {
      this.progressBarFill.style.width = `${Math.min(100, Math.max(0, percent))}%`;
    }
  }

  hideLoading() {
    if (this.loadingScreen) {
      this.loadingScreen.classList.add('hidden');
    }
    const coins = this.market.getAllCoins();
    if (coins.length > 0) {
      this.selectedCoinId = coins[0].id;
      this.selectedCoinName.textContent = this.selectedCoinId;
    }
    this.renderCoinList(coins);
    
    if (this.selectedCoinId) {
       const coin = this.market.getCoin(this.selectedCoinId);
       if (coin) this.chartManager.setHistoricalData(coin.history);
    }
  }

  renderCoinList(coins) {
    this.coinListContainer.innerHTML = '';
    coins.forEach(coin => {
      const el = document.createElement('div');
      el.className = `coin-item ${coin.id === this.selectedCoinId ? 'active' : ''}`;
      
      const priceHTML = formatPriceHTML(coin.price);
      const volStr = formatNumber(coin.volume24h);
      const changeStr = coin.change24h.toFixed(2);
      const changeClass = coin.change24h >= 0 ? 'up' : 'down';
      const changeSign = coin.change24h > 0 ? '+' : '';

      el.innerHTML = `
        <div class="coin-info">
          <span class="coin-symbol">${coin.id}</span>
          <span class="coin-vol">Vol: ${volStr} SOL</span>
        </div>
        <div class="coin-price-data">
          <span class="price">$${priceHTML}</span>
          <span class="change ${changeClass}">${changeSign}${changeStr}%</span>
        </div>
      `;
      el.addEventListener('click', () => this.selectCoin(coin.id));
      this.coinListContainer.appendChild(el);
    });
  }

  selectCoin(coinId) {
    this.selectedCoinId = coinId;
    this.selectedCoinName.textContent = coinId;
    this.chartManager.clear();
    
    if (this.market) {
      const coin = this.market.getCoin(coinId);
      if (coin) {
        this.chartManager.setHistoricalData(coin.history);
        if (this.txnHeaderToken) this.txnHeaderToken.textContent = coinId;
        if (this.tradeReceiveCurrency) this.tradeReceiveCurrency.textContent = coinId;
      }
    }
    
    // Update active class
    Array.from(this.coinListContainer.children).forEach(child => {
      const symbol = child.querySelector('.coin-symbol').textContent;
      if (symbol === coinId) {
        child.classList.add('active');
      } else {
        child.classList.remove('active');
      }
    });
  }

  renderTxnTable(coin, currentTime) {
    const tbody = document.getElementById('txn-list');
    if (!tbody) return;
    
    let html = '';
    for (const txn of coin.txns) {
      if (this.txnFilter === 'YOU' && txn.wallet !== this.playerWallet) continue;
      if (this.txnFilter === 'DEV' && txn.wallet !== 'DEV') continue;

      const ageSec = Math.max(0, currentTime - txn.time);
      let ageStr = '';
      if (ageSec < 60) {
        ageStr = `${Math.floor(ageSec)}s`;
      } else {
        ageStr = `${Math.floor(ageSec / 60)}m`;
      }
      
      const typeClass = txn.type === 'BUY' ? 'type-buy' : 'type-sell';
      const typeStr = txn.type === 'BUY' ? 'Buy' : 'Sell';
      const usdStr = `$${formatNumber(txn.usd)}`;
      const tokenStr = formatNumber(txn.tokenAmount);
      const solStr = txn.sol.toFixed(3);
      const priceStr = `$${formatPriceHTML(txn.price)}`;
      
      html += `<tr class="${txn.type.toLowerCase()}-row">
        <td>${ageStr}</td>
        <td class="${typeClass}">${typeStr}</td>
        <td>${usdStr}</td>
        <td>${tokenStr}</td>
        <td>${solStr}</td>
        <td>${priceStr}</td>
      </tr>`;
    }
    tbody.innerHTML = html;
  }

  update(masterTimeSec, market) {
    // 60fpsごとのフル更新は重いため、DOMの更新はスロットルする (1秒に1回程度)
    const now = performance.now();
    const shouldUpdateDOM = (now - this.lastUiUpdate > 1000);
    
    if (shouldUpdateDOM) {
      this.lastUiUpdate = now;
      const date = new Date(masterTimeSec * 1000);
      this.masterTimeDisplay.textContent = date.toISOString().replace('T', ' ').slice(0, 19);
      
      const coins = market.getAllCoins();
      this.renderCoinList(coins);
    }

    // Chart update is done every frame for the selected coin
    if (this.selectedCoinId) {
      const coin = market.getCoin(this.selectedCoinId);
      if (coin) {
        if (shouldUpdateDOM) {
          this.selectedCoinPrice.innerHTML = `$${formatPriceHTML(coin.price)}`;
          this.selectedCoinChange.textContent = `${coin.change24h > 0 ? '+' : ''}${coin.change24h.toFixed(2)}%`;
          this.selectedCoinChange.className = `change ${coin.change24h >= 0 ? 'up' : 'down'}`;
          
          if (this.tokenMcap) {
            const mcap = coin.price * 1_000_000_000;
            this.tokenMcap.textContent = `$${formatNumber(mcap)}`;
          }
          if (this.tokenLiquidity) {
            const liquidity = (coin.volume24h * 150) * 0.2 + 10000; // Mock liquidity calc
            this.tokenLiquidity.textContent = `$${formatNumber(liquidity)}`;
          }
          
          this.renderTxnTable(coin, masterTimeSec);
        }
        
        // Push latest history to chart
        if (coin.history.length > 0) {
          const lastTxn = coin.history[coin.history.length - 1];
          // Update candle
          this.chartManager.updateCandle(lastTxn.time, lastTxn.price);
        }
      }
    }
  }
}

function formatNumber(num) {
  if (num >= 1e6) return (num / 1e6).toFixed(2) + 'M';
  if (num >= 1e3) return (num / 1e3).toFixed(2) + 'K';
  return num.toFixed(2);
}

function formatPriceHTML(price) {
  if (price >= 0.01 || price === 0) return price.toFixed(6);
  let str = price.toFixed(20).replace(/0+$/, '');
  const match = str.match(/^0\.0([0]+)(\d+)$/);
  if (match) {
    const zeroCount = match[1].length + 1;
    if (zeroCount >= 3) {
      return `0.0<sub style="font-size: 0.65em; margin: 0 1px;">${zeroCount}</sub>${match[2].substring(0, 4)}`;
    }
  }
  return price.toFixed(9);
}

// Start Application
const uiManager = new UIManager();
const engine = new GameEngine(uiManager);
engine.start();
