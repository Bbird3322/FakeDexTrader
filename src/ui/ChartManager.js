import { createChart } from 'lightweight-charts';

export class ChartManager {
  constructor(containerId) {
    this.container = document.getElementById(containerId);
    this.chart = null;
    this.candlestickSeries = null;
    this.candles = new Map(); // bucketTime -> candle object
    this.bucketSec = 60; // 1分足
    this.lastPrice = 0;
  }

  init() {
    this.chart = createChart(this.container, {
      layout: {
        background: { type: 'solid', color: 'transparent' },
        textColor: '#e2f1e8',
      },
      grid: {
        vertLines: { color: 'rgba(0, 255, 102, 0.05)' },
        horzLines: { color: 'rgba(0, 255, 102, 0.05)' },
      },
      crosshair: {
        mode: 0,
      },
      rightPriceScale: {
        borderColor: 'rgba(0, 255, 102, 0.2)',
      },
      timeScale: {
        borderColor: 'rgba(0, 255, 102, 0.2)',
        timeVisible: true,
        secondsVisible: false,
      },
    });

    this.candlestickSeries = this.chart.addCandlestickSeries({
      upColor: '#00ff66',
      downColor: '#ff3366',
      borderVisible: false,
      wickUpColor: '#00ff66',
      wickDownColor: '#ff3366',
    });
    
    // Resize observer
    new ResizeObserver(entries => {
      if (entries.length === 0 || entries[0].target !== this.container) { return; }
      const newRect = entries[0].contentRect;
      this.chart.applyOptions({ height: newRect.height, width: newRect.width });
    }).observe(this.container);
  }

  updateCandle(timeSec, price) {
    if (!this.candlestickSeries) return;
    
    // round to bucket
    const bucketTime = Math.floor(timeSec / this.bucketSec) * this.bucketSec;
    let candle = this.candles.get(bucketTime);
    
    if (!candle) {
      candle = {
        time: bucketTime, // unix timestamp in seconds
        open: this.lastPrice || price,
        high: Math.max(this.lastPrice || price, price),
        low: Math.min(this.lastPrice || price, price),
        close: price
      };
      this.candles.set(bucketTime, candle);
    } else {
      candle.high = Math.max(candle.high, price);
      candle.low = Math.min(candle.low, price);
      candle.close = price;
    }
    
    this.lastPrice = price;
    this.candlestickSeries.update(candle);
  }

  setHistoricalData(history) {
    if (!this.candlestickSeries) return;
    this.candles.clear();
    this.lastPrice = 0;
    
    for (const txn of history) {
      const bucketTime = Math.floor(txn.time / this.bucketSec) * this.bucketSec;
      let candle = this.candles.get(bucketTime);
      
      if (!candle) {
        candle = {
          time: bucketTime,
          open: this.lastPrice || txn.price,
          high: Math.max(this.lastPrice || txn.price, txn.price),
          low: Math.min(this.lastPrice || txn.price, txn.price),
          close: txn.price
        };
        this.candles.set(bucketTime, candle);
      } else {
        candle.high = Math.max(candle.high, txn.price);
        candle.low = Math.min(candle.low, txn.price);
        candle.close = txn.price;
      }
      this.lastPrice = txn.price;
    }
    
    const data = Array.from(this.candles.values()).sort((a, b) => a.time - b.time);
    this.candlestickSeries.setData(data);
  }

  clear() {
    this.candles.clear();
    this.candlestickSeries?.setData([]);
  }
}
