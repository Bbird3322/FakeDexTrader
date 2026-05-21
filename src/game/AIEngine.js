export class AIEngine {
  constructor(market, eventQueue) {
    this.market = market;
    this.eventQueue = eventQueue;
    
    this.session = null;
    this.vocab = [];
    this.stoi = new Map();
    this.isReady = false;
    this.useMock = false;
    
    this.coinStates = new Map();

    // mock parameters
    this.mockActions = ['BUY', 'SELL'];
    this.mockWallets = ['NORMAL', 'SNIPER', 'WHALE', 'DEV'];
    this.mockTimes = ['<0.1s', '1-10s', '10-60s', '1-10m'];
  }

  async init() {
    try {
      const res = await fetch('/master_vocab.json');
      if (!res.ok) throw new Error('master_vocab.json not found');
      this.vocab = await res.json();
      this.vocab.forEach((token, index) => this.stoi.set(token, index));

      console.log('%c[AIEngine] Initializing ONNX Runtime...', 'color: #00aaff;');
      this.configureOnnxRuntime();
      if (navigator.gpu) {
        console.log('%c[AIEngine] 🎮 WebGPU (GPU Acceleration) is SUPPORTED by your browser.', 'color: #00ff66; font-weight: bold;');
      } else {
        console.log('%c[AIEngine] ⚠️ WebGPU is NOT supported. Using WASM (CPU) fallback.', 'color: #ffaa00; font-weight: bold;');
      }

      const loadStart = performance.now();
      // WebGPU優先、WASMフォールバック
      this.session = await ort.InferenceSession.create('/meme_ai_kv_quantized_int8.onnx', {
        executionProviders: ['webgpu', 'wasm'],
        logSeverityLevel: 3, // エラーのみ表示（Warningを非表示にしてコンソールを綺麗に保つ）
      });
      const loadTime = (performance.now() - loadStart).toFixed(1);

      this.isReady = true;
      console.log(`%c[AIEngine] ✅ Model loaded successfully in ${loadTime}ms.`, 'color: #00ff66; font-weight: bold;');
    } catch (err) {
      console.error('AIEngine: Failed to load ONNX model, falling back to mock mode.', err);
      this.useMock = true;
      this.isReady = true;
    }
  }

  configureOnnxRuntime() {
    if (ort.env) {
      ort.env.logLevel = 'error';
    }

    if (ort.env?.wasm) {
      const canUseThreads = window.crossOriginIsolated === true;
      ort.env.wasm.numThreads = canUseThreads
        ? Math.max(1, Math.min(4, navigator.hardwareConcurrency || 1))
        : 1;
      ort.env.wasm.simd = true;
    }
  }

  initCoinAI(coinId, isDeterministic) {
    if (this.coinStates.has(coinId)) return;
    
    let temp, topK;
    if (isDeterministic) {
      temp = 0.1;
      topK = 1;
    } else {
      temp = 0.1 + Math.random() * 0.4;
      topK = 1 + Math.floor(Math.random() * 3);
    }

    const seedToken1 = '[SCENARIO_NORMAL]'; // ID4
    
    // ガウス分布（正規分布）で1.0SOLをピーク（平均）とする購入額を生成
    let u1 = Math.random();
    let u2 = Math.random();
    // Box-Muller変換で標準正規分布を作り、平均1.0、標準偏差0.4にスケール
    let z0 = Math.sqrt(-2.0 * Math.log(u1)) * Math.cos(2.0 * Math.PI * u2);
    let devBuyAmount = z0 * 0.4 + 1.0; 
    devBuyAmount = Math.max(0.01, Math.min(devBuyAmount, 4.9)); // 極端な値を丸める
    
    let seedToken2;
    if (devBuyAmount < 0.1) {
      seedToken2 = 'BUY_SIZE_<0.1_WALLET_DEV_TIME_<0.1s';
    } else {
      const sizeStr = devBuyAmount.toFixed(1);
      seedToken2 = `BUY_SIZE_${sizeStr}SOL_WALLET_DEV_TIME_<0.1s`;
    }
    
    const seedId1 = this.stoi.get(seedToken1) || 4;
    const seedId2 = this.stoi.get(seedToken2) || 250; // fallback: 1.0SOL
    
    this.coinStates.set(coinId, {
      context: [
        { id: seedId1, scheduledAt: 0 },
        { id: seedId2, scheduledAt: 0.1 }
      ],
      contextIds: [seedId1, seedId2],
      temp,
      topK,
      nextGenTokens: 2024,
      volEmaFast: 0,
      volEmaSlow: 0,
      kvCache: null
    });
  }

  trimContext(state, currentTime) {
    const timeCutoff = currentTime - 3600;
    let cutoffIndex = 0;
    
    while (cutoffIndex < state.context.length && state.context[cutoffIndex].scheduledAt < timeCutoff) {
      cutoffIndex++;
    }
    
    let remainingLength = state.context.length - cutoffIndex;
    
    if (remainingLength < 256) {
      cutoffIndex = Math.max(0, state.context.length - 256);
      remainingLength = state.context.length - cutoffIndex;
    }

    if (remainingLength > 2048) {
      cutoffIndex = state.context.length - 2048;
    }

    if (cutoffIndex > 0) {
      state.context = state.context.slice(cutoffIndex);
      state.contextIds = state.context.map(c => c.id);
      state.kvCache = null; // トリミング時はキャッシュを破棄し再構築（Prefill）させる
    }
  }

  async predictNextToken(state) {
    if (this.useMock || !this.session) {
      return this.mockPredictNextToken();
    }

    try {
      const contextIds = state.contextIds;
      const pastLayerIndexes = this.getPastLayerIndexes();
      const hasCompleteKvCache = pastLayerIndexes.length > 0 && pastLayerIndexes.every(index =>
        state.kvCache?.[`past_key_${index}`] && state.kvCache?.[`past_value_${index}`]
      );
      const isPrefill = !hasCompleteKvCache;
      
      let inputIdsArray, positionIdsArray;
      
      if (isPrefill) {
        inputIdsArray = contextIds;
        positionIdsArray = contextIds.map((_, i) => i);
      } else {
        inputIdsArray = [contextIds[contextIds.length - 1]];
        positionIdsArray = [contextIds.length - 1];
      }
      
      const input = BigInt64Array.from(inputIdsArray.map(BigInt));
      const pos = BigInt64Array.from(positionIdsArray.map(BigInt));
      
      const feeds = {
        input_ids: new ort.Tensor('int64', input, [1, inputIdsArray.length]),
        position_ids: new ort.Tensor('int64', pos, [1, inputIdsArray.length]),
      };

      // Add attention_mask to fix missing input error if the model expects it
      if (this.session.inputNames.includes('attention_mask')) {
        const mask = BigInt64Array.from(inputIdsArray.map(() => 1n));
        feeds['attention_mask'] = new ort.Tensor('int64', mask, [1, inputIdsArray.length]);
      }

      // Dimensions expected by the ONNX model (from error: Expected 8 heads, 32 head_dim)
      const nHead = 8;
      const headDim = 32;

      for (const i of pastLayerIndexes) {
        if (isPrefill) {
          // 初回は空のキャッシュ（長さ0）を渡す
          feeds[`past_key_${i}`] = new ort.Tensor('float32', new Float32Array(0), [1, nHead, 0, headDim]);
          feeds[`past_value_${i}`] = new ort.Tensor('float32', new Float32Array(0), [1, nHead, 0, headDim]);
        } else {
          // 2回目以降は前回の計算結果（present）をそのまま渡す
          feeds[`past_key_${i}`] = state.kvCache[`past_key_${i}`];
          feeds[`past_value_${i}`] = state.kvCache[`past_value_${i}`];
        }
      }

      const result = await this.session.run(feeds);
      
      // キャッシュを保存（presentをpastとして次へ引き継ぐ）
      state.kvCache = {};
      let savedKvEntries = 0;
      for (const i of pastLayerIndexes) {
        const presentKey = result[`present_key_${i}`];
        const presentValue = result[`present_value_${i}`];
        if (presentKey && presentValue) {
          state.kvCache[`past_key_${i}`] = presentKey;
          state.kvCache[`past_value_${i}`] = presentValue;
          savedKvEntries++;
        }
      }
      if (savedKvEntries !== pastLayerIndexes.length) {
        state.kvCache = null;
      }
      
      const outputTensorName = result.logits ? 'logits' : Object.keys(result)[0];
      const outputTensor = result[outputTensorName];
      const data = outputTensor.data;
      const dims = outputTensor.dims || [];
      
      let nextLogits;
      if (dims.length === 3) {
        const seqLength = Number(dims[1]);
        const outputVocabSize = Number(dims[2]);
        const offset = Math.max(0, seqLength - 1) * outputVocabSize;
        nextLogits = data.slice(offset, offset + outputVocabSize);
      } else if (dims.length === 2) {
        const outputVocabSize = Number(dims[1]);
        nextLogits = data.slice(0, outputVocabSize);
      } else {
        const fallbackVocabSize = Math.min(this.vocab.length, data.length);
        nextLogits = data.slice(data.length - fallbackVocabSize);
      }

      const nextId = this.sampleTopK(nextLogits, state.topK, state.temp);
      return this.vocab[nextId] || '<UNK>';
      
    } catch (err) {
      console.error('AIEngine inference error:', err);
      return this.mockPredictNextToken();
    }
  }

  getPastLayerIndexes() {
    const inputs = new Set(this.session?.inputNames || []);
    return [...inputs]
      .map(name => {
        const match = name.match(/^past_key_(\d+)$/);
        return match ? Number(match[1]) : null;
      })
      .filter(index => index !== null && inputs.has(`past_value_${index}`))
      .sort((a, b) => a - b);
  }

  sampleTopK(logits, topK, temperature) {
    const pairs = [];
    for (let i = 0; i < logits.length; i++) {
      const value = logits[i];
      if (Number.isFinite(value)) pairs.push([i, value / temperature]);
    }
    pairs.sort((a, b) => b[1] - a[1]);
    const top = pairs.slice(0, Math.max(1, Math.min(topK, pairs.length)));
    
    const max = top[0][1];
    let total = 0;
    const weighted = top.map(([id, logit]) => {
      const weight = Math.exp(logit - max);
      total += weight;
      return [id, weight];
    });
    
    let roll = Math.random() * total;
    for (const [id, weight] of weighted) {
      roll -= weight;
      if (roll <= 0) return id;
    }
    return weighted[0][0];
  }

  mockPredictNextToken() {
    if (Math.random() < 0.02) return '[DEAD]';
    if (Math.random() < 0.02) return '[REALIVE]';

    const action = this.mockActions[Math.floor(Math.random() * this.mockActions.length)];
    const wallet = this.mockWallets[Math.floor(Math.random() * this.mockWallets.length)];
    const time = this.mockTimes[Math.floor(Math.random() * this.mockTimes.length)];
    
    let sizeStr;
    if (Math.random() < 0.2) {
      sizeStr = '<0.1';
    } else {
      sizeStr = (Math.random() * 5).toFixed(1);
    }
    
    return `${action}_SIZE_${sizeStr}SOL_WALLET_${wallet}_TIME_${time}`;
  }

  parseTokenToTxn(tokenStr, state) {
    if (tokenStr === '[DEAD]' || tokenStr === '[REALIVE]' || tokenStr.startsWith('[SCENARIO_')) {
      return { kind: 'marker', token: tokenStr };
    }

    const actionMatch = tokenStr.match(/^(BUY|SELL)/);
    const sizeMatch = tokenStr.match(/SIZE_([\d\.]+|<0\.1)SOL/);
    const walletMatch = tokenStr.match(/WALLET_([A-Z]+)/);
    const timeMatch = tokenStr.match(/TIME_(.+)$/);

    if (!actionMatch || !sizeMatch || !walletMatch || !timeMatch) {
      return null;
    }

    const action = actionMatch[1];
    
    let sizeSol = 0;
    if (sizeMatch[1] === '<0.1') {
      sizeSol = this.randomBetween(0.01, 0.09);
    } else {
      const center = parseFloat(sizeMatch[1]);
      sizeSol = this.randomBetween(Math.max(0.01, center - 0.05), center + 0.05);
    }

    const wallet = walletMatch[1];
    
    let delaySec = 0;
    const t = timeMatch[1];
    if (t === '<0.1s') {
      // 出来高の傾きによる合算ロジック
      let volSlope = 0;
      if (state && state.volEmaFast !== undefined && state.volEmaSlow !== undefined) {
         volSlope = Math.max(0, state.volEmaFast - state.volEmaSlow);
      }
      let mean = 5 + volSlope * 2.0; // 傾きに係数をかけてピークをずらす
      
      // ガウス分布で合算する個数(N)を決定
      let u1 = Math.random(), u2 = Math.random();
      let z0 = Math.sqrt(-2.0 * Math.log(u1)) * Math.cos(2.0 * Math.PI * u2);
      let N = Math.max(1, Math.round(z0 * (mean * 0.3) + mean)); // 分散を持たせる
      
      sizeSol = sizeSol * N;
      delaySec = this.randomBetween(1.0, 1.5); // 1秒枠にまとめる
    } else if (t === '1-10s') {
      delaySec = this.randomBetween(1.0, 9.9);
    } else if (t === '10-60s') {
      delaySec = this.randomBetween(10.0, 59.9);
    } else if (t === '1-10m') {
      delaySec = this.randomBetween(60, 600);
    } else {
      delaySec = this.randomBetween(1, 5);
    }

    return {
      kind: 'trade',
      action,
      sizeSol,
      wallet,
      delaySec,
      sourceToken: tokenStr
    };
  }

  randomBetween(min, max) {
    return Math.random() * (max - min) + min;
  }

  async generateTxnsForCoin(coinId, startTime, duration, onProgress, executeImmediate = false) {
    const state = this.coinStates.get(coinId);
    if (!state) return startTime;

    console.log(`%c[AIEngine] ➡️ Starting generation for ${coinId}... (Target limit: ${state.nextGenTokens} tokens)`, 'color: #00aaff;');

    let accumulatedTime = 0;
    const futureTxnQueue = [];

    let iterations = 0;
    let lastTokenStr = '';
    
    // 生成前にコンテキストをトリミング
    this.trimContext(state, startTime);

    let cutOccurred = false;
    const realStartTimeMs = performance.now();
    
    while (iterations < state.nextGenTokens) {
      iterations++;
      
      const currentElapsedMs = performance.now() - realStartTimeMs;
      const currentAvg = (currentElapsedMs / iterations).toFixed(1);
      const p = Math.min(1.0, accumulatedTime / duration);
      
      if (onProgress) onProgress(p, accumulatedTime, iterations, state.nextGenTokens, currentAvg);

      // UIの描画更新（Paint）を許可するために10回に1回だけスレッドを譲る
      if (iterations % 10 === 0) {
        await new Promise(resolve => setTimeout(resolve, 0));
      }
      
      const tokenStr = await this.predictNextToken(state);
      lastTokenStr = tokenStr;
      
      const tokenId = this.stoi.get(tokenStr) || this.stoi.get('<UNK>') || 0;
      
      // コンテキストに追加
      state.context.push({ id: tokenId, scheduledAt: startTime + accumulatedTime });
      state.contextIds.push(tokenId);

      // 安全対策: ループ内でも絶対にモデルの上限(2048)を超えないようにする
      if (state.context.length > 2048) {
        state.context.shift();
        state.contextIds.shift();
      }
      
      const txn = this.parseTokenToTxn(tokenStr, state);
      if (txn && txn.kind === 'trade') {
        // 出来高EMAの更新 (SOL / 秒)
        let rate = txn.sizeSol / Math.max(0.1, txn.delaySec);
        state.volEmaFast = state.volEmaFast + (rate - state.volEmaFast) * (2 / 11);
        state.volEmaSlow = state.volEmaSlow + (rate - state.volEmaSlow) * (2 / 61);

        accumulatedTime += txn.delaySec;
        txn.scheduledAt = startTime + accumulatedTime;
        txn.coinId = coinId;
        
        if (accumulatedTime > duration) {
           cutOccurred = true;
           break; // 1時間を超えたのでその先をカット
        }

        if (executeImmediate) {
          const coin = this.market.getCoin(coinId);
          if (coin) {
            const isBuy = txn.action === 'BUY';
            let multiplier = 1;
            if (txn.wallet === 'WHALE') multiplier = 1.45;
            if (txn.wallet === 'SNIPER') multiplier = 1.25;
            if (txn.wallet === 'DEV') multiplier = 1.15;
            const impact = Math.log1p(txn.sizeSol) * multiplier * (isBuy ? 0.9 : -0.82) / 100;
            const newPrice = Math.max(0.000000001, coin.price * (1 + impact));
            this.market.addTrade(coin.id, newPrice, txn);
          }
        } else {
          futureTxnQueue.push(txn);
        }
      } else if (txn && txn.kind === 'marker') {
        txn.scheduledAt = startTime + accumulatedTime;
        if (!executeImmediate) futureTxnQueue.push(txn);
      } else {
        accumulatedTime += 0.5;
        if (accumulatedTime > duration) { cutOccurred = true; break; }
      }
    }

    const realEndTimeMs = performance.now();
    const elapsedMs = realEndTimeMs - realStartTimeMs;
    const avgMsPerToken = iterations > 0 ? (elapsedMs / iterations).toFixed(1) : 0;

    if (cutOccurred) {
      // 1時間超えでカットされたので、次回は生成トークン数を半分にする（最低256）
      state.nextGenTokens = Math.max(256, Math.floor(state.nextGenTokens / 2));
    } else {
      // 1時間未満で生成トークン数を使い切った場合は、次回倍増させる（最大2024）
      state.nextGenTokens = Math.min(2024, state.nextGenTokens * 2);
    }

    console.log(`%c[AIEngine] ✅ ${coinId} finished! | Generated: ${iterations} tokens (${avgMsPerToken}ms/token) | Time: ${Math.floor(accumulatedTime)}s | Cut: ${cutOccurred ? 'Yes' : 'No'} | Next Target: ${state.nextGenTokens}`, 'color: #00ff66; font-weight: bold;');

    if (!executeImmediate) {
      futureTxnQueue.forEach(txn => {
        this.eventQueue.schedule(txn.scheduledAt, () => {
          if (txn.kind === 'trade') {
            const coin = this.market.getCoin(txn.coinId);
            if (coin) {
               const isBuy = txn.action === 'BUY';
               let multiplier = 1;
               if (txn.wallet === 'WHALE') multiplier = 1.45;
               if (txn.wallet === 'SNIPER') multiplier = 1.25;
               if (txn.wallet === 'DEV') multiplier = 1.15;
               const impact = Math.log1p(txn.sizeSol) * multiplier * (isBuy ? 0.9 : -0.82) / 100;
               const newPrice = Math.max(0.000000001, coin.price * (1 + impact));
               this.market.addTrade(coin.id, newPrice, txn);
            }
          }
        });
      });
    }
    
    if (onProgress) onProgress(1.0, accumulatedTime, lastTokenStr);
    return startTime + accumulatedTime;
  }

  async generateFutureTxnsForAll(startTime, duration) {
    const coins = this.market.getAllCoins();
    let minGeneratedTime = duration;

    for (const coin of coins) {
      const generatedUntil = await this.generateTxnsForCoin(coin.id, startTime, duration, null, false);
      const generatedDuration = generatedUntil - startTime;
      if (generatedDuration < minGeneratedTime) {
        minGeneratedTime = generatedDuration;
      }
    }
    return startTime + minGeneratedTime;
  }
}
